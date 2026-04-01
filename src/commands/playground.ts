/**
 * @module commands/playground
 *
 * Starts a Remix-like browser IDE for Canton development.
 * Launches a Canton sandbox, serves the playground UI, and provides
 * real-time WebSocket events for build, test, and contract state.
 *
 * @example
 * ```bash
 * cantonctl playground                   # Open browser IDE at localhost:4000
 * cantonctl playground --port 8080       # Custom port
 * cantonctl playground --no-open         # Don't auto-open browser
 * ```
 */

import {Command, Flags} from '@oclif/core'
import {exec} from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

import {watch} from 'chokidar'

import {createBuilder} from '../lib/builder.js'
import {loadConfig} from '../lib/config.js'
import {createDamlSdk} from '../lib/daml.js'
import {createDevServer} from '../lib/dev-server.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createPlaygroundServer} from '../lib/playground-server.js'
import {createProcessRunner} from '../lib/process-runner.js'
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

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open'
  exec(`${cmd} ${url}`)
}

export default class Playground extends Command {
  static override description = 'Open a Remix-like browser IDE for Canton development'

  static override examples = [
    '<%= config.bin %> playground',
    '<%= config.bin %> playground --port 8080',
    '<%= config.bin %> playground --no-open',
  ]

  static override flags = {
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'Canton JSON Ledger API port',
    }),
    'no-open': Flags.boolean({
      default: false,
      description: 'Do not auto-open browser',
    }),
    'no-sandbox': Flags.boolean({
      default: false,
      description: 'Connect to an existing sandbox instead of starting one',
    }),
    port: Flags.integer({
      char: 'p',
      default: 4000,
      description: 'Playground server port',
    }),
    'sandbox-port': Flags.integer({
      default: 5001,
      description: 'Canton sandbox port',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Playground)
    const out = createOutput({json: false})
    const projectDir = process.cwd()

    // Verify we're in a cantonctl project
    const configPath = path.join(projectDir, 'cantonctl.yaml')
    if (!fs.existsSync(configPath)) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" first to create a project, then run "cantonctl playground" from the project directory.',
      })
    }

    // Check port availability
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
      out.log('')
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

    // Find playground UI static files
    // In production: bundled at dist/playground/
    // In dev: playground/dist/ (after local build)
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'playground', 'dist'),    // dev: from dist/commands/
      path.join(__dirname, '..', 'playground'),                   // prod: dist/playground/
    ]
    const staticDir = possiblePaths.find(p => fs.existsSync(p))

    // Build playground dependencies
    const findDarFile = async (dir: string) => {
      try {
        const entries = await fs.promises.readdir(dir)
        const dar = entries.find(e => e.endsWith('.dar'))
        return dar ? path.join(dir, dar) : null
      } catch { return null }
    }

    const builder = createBuilder({
      findDarFile,
      getDamlSourceMtime: async () => 0,
      getFileMtime: async () => null,
      hooks: undefined,
      sdk,
    })

    const testRunner = createTestRunner({sdk})

    // Start playground server
    const playground = createPlaygroundServer({
      builder,
      createLedgerClient,
      createToken: createSandboxToken,
      output: out,
      testRunner,
    })

    await playground.start({
      ledgerUrl,
      port: flags.port,
      projectDir,
      staticDir,
    })

    if (!staticDir) {
      out.warn('Playground UI not found. API server is running — connect a frontend to http://localhost:' + flags.port)
      out.info('To build the playground UI: cd playground && npm install && npm run build')
    }

    // Open browser
    if (!flags['no-open'] && staticDir) {
      openBrowser(`http://localhost:${flags.port}`)
    }

    out.log('')
    out.log(`  Playground:  http://localhost:${flags.port}`)
    out.log(`  Ledger API:  ${ledgerUrl}`)
    out.log(`  Project:     ${projectDir}`)
    out.log('')
    out.log('Press Ctrl+C to stop')

    // Wait for shutdown
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        out.log('')
        out.info('Shutting down...')
        await playground.stop()
        if (devServer) await devServer.stop()
        resolve()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
  }
}
