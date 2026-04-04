/**
 * @module commands/serve
 *
 * Starts the Canton IDE Protocol backend — a profile-aware REST + WebSocket
 * server for local workbenches, demos, and editor integrations.
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
import * as path from 'node:path'

import {createBuilder, type Builder} from '../lib/builder.js'
import {resolveProfile} from '../lib/compat.js'
import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {createDamlSdk, type DamlSdk} from '../lib/daml.js'
import {createDevServer, type DevServer} from '../lib/dev-server.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'
import {findDarFile, isTcpPortInUse} from '../lib/runtime-support.js'
import {createServeServer, type ServeServer} from '../lib/serve.js'
import {createTestRunner, type TestRunner} from '../lib/test-runner.js'

export default class Serve extends Command {
  static override description = 'Start the profile-aware Canton IDE Protocol backend'

  static override examples = [
    '<%= config.bin %> serve',
    '<%= config.bin %> serve --port 8080',
    '<%= config.bin %> serve --profile splice-devnet --no-sandbox',
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
    profile: Flags.string({
      description: 'Resolved runtime profile to expose through the IDE server',
    }),
    'sandbox-port': Flags.integer({
      default: 5001,
      description: 'Canton sandbox port',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Serve)
    const out = createOutput({json: flags.json})
    const projectDir = this.getProjectDir()

    // Verify we're in a cantonctl project
    if (!this.projectExists(projectDir)) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" first to create a project, then run "cantonctl serve" from the project directory.',
      })
    }

    if (await this.isServePortInUse(flags.port)) {
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
    const shouldStartSandbox =
      !flags['no-sandbox']
      && (resolvedProfile?.profile.kind ?? 'sandbox') === 'sandbox'

    // Start sandbox if needed
    let devServer: DevServer | null = null
    if (shouldStartSandbox) {
      out.info('Starting Canton sandbox...')

      devServer = this.createManagedSandboxServer({config, output: out, sdk})

      await devServer.start({
        jsonApiPort: sandboxJsonApiPort,
        port: sandboxPort,
        projectDir,
      })

      out.success('Canton sandbox ready')
    } else if (!flags['no-sandbox'] && resolvedProfile) {
      out.info(`Using profile "${resolvedProfile.profile.name}" without starting a managed sandbox`)
    }

    // Create serve dependencies
    const builder = this.createServeBuilder(sdk)
    const testRunner = this.createServeTestRunner(sdk)
    const server = this.createServeServer({builder, output: out, testRunner})

    await server.start({
      ledgerUrl,
      port: flags.port,
      profileName: resolvedProfile?.profile.name,
      projectDir,
    })

    out.result({
      data: {
        ledgerUrl,
        port: flags.port,
        profile: resolvedProfile?.profile
          ? {
            experimental: resolvedProfile.profile.experimental,
            kind: resolvedProfile.profile.kind,
            name: resolvedProfile.profile.name,
          }
          : undefined,
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
      if (resolvedProfile) out.log(`  Profile:     ${resolvedProfile.profile.name} (${resolvedProfile.profile.kind})`)
      out.log(`  Project:     ${projectDir}`)
      out.log('')
      out.log('Connect local workbenches or editor integrations to this backend.')
      out.log('Press Ctrl+C to stop')
    }

    // Wait for shutdown
    await this.waitForShutdown(async () => {
      out.info('Shutting down...')
      await server.stop()
      if (devServer) await devServer.stop()
    })
  }

  protected createManagedSandboxServer(deps: {
    config: CantonctlConfig
    output: ReturnType<typeof createOutput>
    sdk: DamlSdk
  }): DevServer {
    return createDevServer({
      config: deps.config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      isPortInUse: (port: number) => this.isServePortInUse(port),
      output: deps.output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: deps.sdk,
      watch: (paths, opts) => watch(paths, opts),
    })
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
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

  protected isServePortInUse(port: number): Promise<boolean> {
    return isTcpPortInUse(port)
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected projectExists(projectDir: string): boolean {
    return fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))
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
