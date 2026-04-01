/**
 * @module commands/serve
 *
 * Starts the Canton IDE Protocol server — a headless REST + WebSocket API
 * that any IDE client can connect to (VS Code, Neovim, browser playground).
 *
 * This is the generic interface. `cantonctl playground` adds the browser UI
 * on top of this same server.
 *
 * @example
 * ```bash
 * cantonctl serve                     # Start API server at localhost:4000
 * cantonctl serve --port 8080         # Custom port
 * cantonctl serve --no-sandbox        # Connect to existing sandbox
 * ```
 */

import {Command, Flags} from '@oclif/core'
import {watch} from 'chokidar'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

import {createBuilder} from '../lib/builder.js'
import {loadConfig} from '../lib/config.js'
import {createDamlSdk} from '../lib/daml.js'
import {createDevServer} from '../lib/dev-server.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner} from '../lib/process-runner.js'
import {createServeServer} from '../lib/serve.js'
import {createTestRunner} from '../lib/test-runner.js'

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE')
    })
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '127.0.0.1')
  })
}

export default class Serve extends Command {
  static override description = 'Start the Canton IDE Protocol server (REST + WebSocket)'

  static override examples = [
    '<%= config.bin %> serve',
    '<%= config.bin %> serve --port 8080',
    '<%= config.bin %> serve --no-sandbox',
    '<%= config.bin %> serve --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output connection info as JSON',
    }),
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'Canton JSON Ledger API port',
    }),
    'no-sandbox': Flags.boolean({
      default: false,
      description: 'Connect to an existing sandbox instead of starting one',
    }),
    port: Flags.integer({
      char: 'p',
      default: 4000,
      description: 'Server port',
    }),
    'sandbox-port': Flags.integer({
      default: 5001,
      description: 'Canton sandbox port',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Serve)
    const out = createOutput({json: flags.json})
    const projectDir = process.cwd()

    // Verify we're in a cantonctl project
    if (!fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" first to create a project, then run "cantonctl serve" from the project directory.',
      })
    }

    if (await isPortInUse(flags.port)) {
      throw new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
        context: {port: flags.port},
        suggestion: `Port ${flags.port} is in use. Try --port ${flags.port + 1}`,
      })
    }

    const config = await loadConfig()
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const ledgerUrl = `http://localhost:${flags['json-api-port']}`

    // Start sandbox if needed
    let devServer: Awaited<ReturnType<typeof createDevServer>> | null = null
    if (!flags['no-sandbox']) {
      out.info('Starting Canton sandbox...')

      devServer = createDevServer({
        config,
        createClient: createLedgerClient,
        createToken: createSandboxToken,
        findDarFile: async (dir: string) => {
          try {
            const entries = await fs.promises.readdir(dir)
            const dar = entries.find(e => e.endsWith('.dar'))
            return dar ? path.join(dir, dar) : null
          } catch { return null }
        },
        isPortInUse,
        output: out,
        readFile: (p) => fs.promises.readFile(p),
        sdk,
        watch: (paths, opts) => watch(paths, opts),
      })

      await devServer.start({
        jsonApiPort: flags['json-api-port'],
        port: flags['sandbox-port'],
        projectDir,
      })

      out.success('Canton sandbox ready')
    }

    // Create serve dependencies
    const builder = createBuilder({
      findDarFile: async (dir: string) => {
        try {
          const entries = await fs.promises.readdir(dir)
          const dar = entries.find(e => e.endsWith('.dar'))
          return dar ? path.join(dir, dar) : null
        } catch { return null }
      },
      getDamlSourceMtime: async () => 0,
      getFileMtime: async () => null,
      hooks: undefined,
      sdk,
    })

    const testRunner = createTestRunner({sdk})

    const server = createServeServer({
      builder,
      createLedgerClient,
      createToken: createSandboxToken,
      output: out,
      testRunner,
    })

    await server.start({
      ledgerUrl,
      port: flags.port,
      projectDir,
    })

    out.result({
      data: {
        ledgerUrl,
        port: flags.port,
        projectDir,
        protocol: 'canton-ide-protocol/v1',
        websocket: `ws://localhost:${flags.port}`,
      },
      success: true,
    })

    if (!flags.json) {
      out.log('')
      out.log(`  API:         http://localhost:${flags.port}/api`)
      out.log(`  WebSocket:   ws://localhost:${flags.port}`)
      out.log(`  Ledger API:  ${ledgerUrl}`)
      out.log(`  Project:     ${projectDir}`)
      out.log('')
      out.log('Connect any IDE client to this server.')
      out.log('Press Ctrl+C to stop')
    }

    // Wait for shutdown
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        out.info('Shutting down...')
        await server.stop()
        if (devServer) await devServer.stop()
        resolve()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
  }
}
