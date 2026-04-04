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
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import {createBuilder, type Builder} from '../lib/builder.js'
import {resolveProfile} from '../lib/compat.js'
import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {createDamlSdk, type DamlSdk} from '../lib/daml.js'
import {createFullDevServer, type FullDevServer} from '../lib/dev-server-full.js'
import {createDevServer, type DevServer} from '../lib/dev-server.js'
import {createDockerManager, type DockerManager} from '../lib/docker.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'
import {findDarFile, isTcpPortInUse, openBrowserUrl} from '../lib/runtime-support.js'
import {createServeServer, type ServeServer} from '../lib/serve.js'
import {createTestRunner, type TestRunner} from '../lib/test-runner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default class Playground extends Command {
  static override description = 'Open a Remix-like browser IDE for Canton development'

  static override examples = [
    '<%= config.bin %> playground',
    '<%= config.bin %> playground --full',
    '<%= config.bin %> playground --profile splice-devnet --no-open',
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
    profile: Flags.string({
      description: 'Resolved runtime profile to expose through the playground IDE',
    }),
    'sandbox-port': Flags.integer({
      default: 5001,
      description: 'Canton sandbox port (single sandbox mode)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Playground)
    const out = createOutput({json: false})
    const projectDir = this.getProjectDir()

    if (!this.projectExists(projectDir)) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" first to create a project, then run "cantonctl playground" from the project directory.',
      })
    }

    if (await this.isPlaygroundPortInUse(flags.port)) {
      throw new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
        context: {port: flags.port},
        suggestion: `Port ${flags.port} is in use. Try --port ${flags.port + 1}`,
      })
    }

    const config = await this.loadProjectConfig()
    const runner = this.createRunner()
    const sdk = this.createSdk(runner)
    const resolvedProfile = config.profiles && Object.keys(config.profiles).length > 0
      ? resolveProfile(config, flags.profile)
      : null
    const profileLedger = resolvedProfile?.profile.services.ledger
    const sandboxJsonApiPort = profileLedger?.['json-api-port'] ?? flags['json-api-port']
    const sandboxPort = profileLedger?.port ?? flags['sandbox-port']
    const ledgerUrl = profileLedger?.url
      ?? `http://localhost:${sandboxJsonApiPort}`
    const shouldStartFullRuntime = !flags['no-sandbox'] && flags.full
    const shouldStartSandbox =
      !flags['no-sandbox']
      && !flags.full
      && (resolvedProfile?.profile.kind ?? 'sandbox') === 'sandbox'

    // Start sandbox or multi-node topology
    let devServer: DevServer | null = null
    let fullDevServer: FullDevServer | null = null

    if (shouldStartFullRuntime) {
      out.log('')
      out.info('Starting multi-node Canton topology via Docker...')

      const docker = this.createDockerManager(out, runner)
      fullDevServer = this.createFullServer({
        cantonImage: flags['canton-image'],
        config,
        docker,
        output: out,
        sdk,
      })

      await fullDevServer.start({
        basePort: flags['base-port'],
        projectDir,
      })

      out.success('Multi-node topology ready')
    } else if (shouldStartSandbox) {
      out.log('')
      out.info('Starting Canton sandbox...')

      devServer = this.createSandboxServer({config, output: out, sdk})

      await devServer.start({
        jsonApiPort: sandboxJsonApiPort,
        port: sandboxPort,
        projectDir,
      })

      out.success('Canton sandbox ready')
    } else if (!flags['no-sandbox'] && resolvedProfile) {
      out.log('')
      out.info(`Using profile "${resolvedProfile.profile.name}" without starting a managed sandbox`)
    }

    // Find playground UI static files
    const staticDir = this.resolveStaticDir()

    // Create the serve server with UI
    const builder = this.createServeBuilder(sdk)
    const testRunner = this.createServeTestRunner(sdk)
    const server = this.createServeServer({builder, output: out, testRunner})

    await server.start({
      ledgerUrl,
      multiNode: flags.full
        ? true
        : resolvedProfile?.profile.kind === 'canton-multi'
          ? undefined
          : false,
      port: flags.port,
      profileName: resolvedProfile?.profile.name,
      projectDir,
      staticDir,
    })

    if (!staticDir) {
      out.warn('Playground UI not found. API server is running at http://localhost:' + flags.port)
      out.info('To build the playground UI: cd playground && npm install && npm run build')
    }

    if (!flags['no-open'] && staticDir) {
      this.openBrowser(`http://localhost:${flags.port}`)
    }

    out.log('')
    out.log(`  Playground:  http://localhost:${flags.port}`)
    out.log(`  API:         http://localhost:${flags.port}/api`)
    out.log(`  WebSocket:   ws://localhost:${flags.port}`)
    out.log(`  Ledger API:  ${ledgerUrl}`)
    if (resolvedProfile) out.log(`  Profile:     ${resolvedProfile.profile.name} (${resolvedProfile.profile.kind})`)
    out.log(`  Project:     ${projectDir}`)
    out.log('')
    out.log('Press Ctrl+C to stop')

    await this.waitForShutdown(async () => {
      out.log('')
      out.info('Shutting down...')
      await server.stop()
      if (devServer) await devServer.stop()
      if (fullDevServer) await fullDevServer.stop()
    })
  }

  protected createDockerManager(out: ReturnType<typeof createOutput>, runner: ProcessRunner): DockerManager {
    return createDockerManager({output: out, runner})
  }

  protected createFullServer(deps: {
    cantonImage: string
    config: CantonctlConfig
    docker: DockerManager
    output: ReturnType<typeof createOutput>
    sdk: DamlSdk
  }): FullDevServer {
    return createFullDevServer({
      build: async (pd: string): Promise<void> => { await deps.sdk.build({projectDir: pd}) },
      cantonImage: deps.cantonImage,
      config: deps.config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      docker: deps.docker,
      findDarFile,
      mkdir: async (dir: string): Promise<void> => { await fs.promises.mkdir(dir, {recursive: true}) },
      output: deps.output,
      readFile: (p) => fs.promises.readFile(p),
      rmdir: (dir) => fs.promises.rm(dir, {force: true, recursive: true}),
      watch: (paths, opts) => watch(paths, opts),
      writeFile: (p, content) => fs.promises.writeFile(p, content, 'utf8'),
    })
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected createSandboxServer(deps: {
    config: CantonctlConfig
    output: ReturnType<typeof createOutput>
    sdk: DamlSdk
  }): DevServer {
    return createDevServer({
      config: deps.config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      isPortInUse: (port: number) => this.isPlaygroundPortInUse(port),
      output: deps.output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: deps.sdk,
      watch: (paths, opts) => watch(paths, opts),
    })
  }

  protected createSdk(runner: ProcessRunner): DamlSdk {
    return createDamlSdk({runner})
  }

  protected createServeBuilder(sdk: DamlSdk): Builder {
    return createBuilder({
      findDarFile,
      getDamlSourceMtime: async () => 0,
      getFileMtime: async () => null,
      hooks: undefined,
      sdk,
    })
  }

  protected createServeServer(deps: {
    builder: Builder
    output: ReturnType<typeof createOutput>
    testRunner: TestRunner
  }): ServeServer {
    return createServeServer({
      builder: deps.builder,
      createLedgerClient,
      createToken: createSandboxToken,
      output: deps.output,
      testRunner: deps.testRunner,
    })
  }

  protected createServeTestRunner(sdk: DamlSdk): TestRunner {
    return createTestRunner({sdk})
  }

  protected getProjectDir(): string {
    return process.cwd()
  }

  protected isPlaygroundPortInUse(port: number): Promise<boolean> {
    return isTcpPortInUse(port)
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected openBrowser(url: string): void {
    openBrowserUrl(url)
  }

  protected projectExists(projectDir: string): boolean {
    return fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))
  }

  protected resolveStaticDir(): string | undefined {
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'playground', 'dist'),
      path.join(__dirname, '..', 'playground'),
    ]
    return possiblePaths.find(p => fs.existsSync(p))
  }

  protected async waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
    await new Promise<void>((resolve) => {
      const handler = async () => {
        await shutdown()
        resolve()
      }

      process.on('SIGINT', handler)
      process.on('SIGTERM', handler)
    })
  }
}
