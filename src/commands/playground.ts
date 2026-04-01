/**
 * @module commands/playground
 *
 * Starts a Remix-like browser IDE for Canton development.
 * This is a convenience wrapper: it starts `cantonctl serve` and serves
 * the browser UI on top of the same server.
 *
 * For headless mode (VS Code, Neovim, other IDEs), use `cantonctl serve`.
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
import {watch} from 'chokidar'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import {createBuilder} from '../lib/builder.js'
import {loadConfig} from '../lib/config.js'
import {createDamlSdk} from '../lib/daml.js'
import {createFullDevServer, type FullDevServer} from '../lib/dev-server-full.js'
import {createDevServer} from '../lib/dev-server.js'
import {createDockerManager} from '../lib/docker.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner} from '../lib/process-runner.js'
import {createServeServer} from '../lib/serve.js'
import {createTestRunner} from '../lib/test-runner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
    '<%= config.bin %> playground --full',
    '<%= config.bin %> playground --port 8080',
    '<%= config.bin %> playground --no-open',
  ]

  static override flags = {
    'base-port': Flags.integer({
      default: 10_000,
      description: 'Base port for multi-node topology (--full mode only)',
    }),
    'canton-image': Flags.string({
      default: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
      description: 'Canton Docker image (--full mode only)',
    }),
    full: Flags.boolean({
      default: false,
      description: 'Start multi-node Docker topology instead of single sandbox',
    }),
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'Canton JSON Ledger API port (single sandbox mode)',
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
      description: 'Canton sandbox port (single sandbox mode)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Playground)
    const out = createOutput({json: false})
    const projectDir = process.cwd()

    if (!fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" first to create a project, then run "cantonctl playground" from the project directory.',
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

    // Start sandbox or multi-node topology
    let devServer: Awaited<ReturnType<typeof createDevServer>> | null = null
    let fullDevServer: FullDevServer | null = null

    const findDarFile = async (dir: string) => {
      try {
        const entries = await fs.promises.readdir(dir)
        const dar = entries.find(e => e.endsWith('.dar'))
        return dar ? path.join(dir, dar) : null
      } catch { return null }
    }

    if (!flags['no-sandbox'] && flags.full) {
      out.log('')
      out.info('Starting multi-node Canton topology via Docker...')

      const docker = createDockerManager({output: out, runner})
      fullDevServer = createFullDevServer({
        build: async (pd: string): Promise<void> => { await sdk.build({projectDir: pd}) },
        cantonImage: flags['canton-image'],
        config,
        createClient: createLedgerClient,
        createToken: createSandboxToken,
        docker,
        findDarFile,
        mkdir: async (dir: string): Promise<void> => { await fs.promises.mkdir(dir, {recursive: true}) },
        output: out,
        readFile: (p) => fs.promises.readFile(p),
        rmdir: (dir) => fs.promises.rm(dir, {force: true, recursive: true}),
        watch: (paths, opts) => watch(paths, opts),
        writeFile: (p, content) => fs.promises.writeFile(p, content, 'utf8'),
      })

      await fullDevServer.start({
        basePort: flags['base-port'],
        projectDir,
      })

      out.success('Multi-node topology ready')
    } else if (!flags['no-sandbox']) {
      out.log('')
      out.info('Starting Canton sandbox...')

      devServer = createDevServer({
        config,
        createClient: createLedgerClient,
        createToken: createSandboxToken,
        findDarFile,
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
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'playground', 'dist'),
      path.join(__dirname, '..', 'playground'),
    ]
    const staticDir = possiblePaths.find(p => fs.existsSync(p))

    // Create the serve server with UI
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
      staticDir,
    })

    if (!staticDir) {
      out.warn('Playground UI not found. API server is running at http://localhost:' + flags.port)
      out.info('To build the playground UI: cd playground && npm install && npm run build')
    }

    if (!flags['no-open'] && staticDir) {
      openBrowser(`http://localhost:${flags.port}`)
    }

    out.log('')
    out.log(`  Playground:  http://localhost:${flags.port}`)
    out.log(`  API:         http://localhost:${flags.port}/api`)
    out.log(`  WebSocket:   ws://localhost:${flags.port}`)
    out.log(`  Ledger API:  ${ledgerUrl}`)
    out.log(`  Project:     ${projectDir}`)
    out.log('')
    out.log('Press Ctrl+C to stop')

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        out.log('')
        out.info('Shutting down...')
        await server.stop()
        if (devServer) await devServer.stop()
        if (fullDevServer) await fullDevServer.stop()
        resolve()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
  }
}
