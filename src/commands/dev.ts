/**
 * @module commands/dev
 *
 * Starts a local Canton development environment with hot-reload.
 * Thin oclif wrapper over {@link createDevServer} (sandbox mode)
 * and {@link createFullDevServer} (local Canton-only net mode).
 *
 * @example
 * ```bash
 * cantonctl dev                      # Start sandbox on default ports
 * cantonctl dev --port 6001          # Custom Canton node port
 * cantonctl dev --net                # Multi-node topology via Docker
 * cantonctl dev --net --topology demo
 * cantonctl dev --json               # JSON output for CI
 * ```
 */

import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {watch} from 'chokidar'

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
import {findDarFile, isTcpPortInUse} from '../lib/runtime-support.js'

/** Default Canton Docker image for --net mode. */
const DEFAULT_CANTON_IMAGE = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'

export default class Dev extends Command {
  static override description = 'Start a local Canton development environment with hot-reload'

  static override examples = [
    '<%= config.bin %> dev',
    '<%= config.bin %> dev --port 6001',
    '<%= config.bin %> dev --net',
    '<%= config.bin %> dev --net --topology demo',
    '<%= config.bin %> dev --net --base-port 20000',
    '<%= config.bin %> dev --json',
  ]

  static override flags = {
    'base-port': Flags.integer({
      description: 'Base port for multi-node topology (--net mode only)',
    }),
    'canton-image': Flags.string({
      description: 'Canton Docker image for --net mode',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'JSON Ledger API port (sandbox mode only)',
    }),
    net: Flags.boolean({
      default: false,
      description: 'Start the local Canton-only net topology (requires Docker)',
    }),
    port: Flags.integer({
      char: 'p',
      default: 5001,
      description: 'Canton node port (sandbox mode only)',
    }),
    topology: Flags.string({
      description: 'Named local topology from topologies: in cantonctl.yaml (--net mode only)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Dev)
    const out = createOutput({json: flags.json})

    let server: DevServer | FullDevServer | null = null

    try {
      if (flags.topology && !flags.net) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Use "--topology" together with "--net", or remove the topology selection.',
        })
      }

      const config = await this.loadProjectConfig()
      const runner = this.createRunner()
      const sdk = this.createSdk(runner)
      const projectDir = this.getProjectDir()

      // Handle graceful shutdown without process.exit
      const controller = new AbortController()
      let shutdownPromiseResolve: (() => void) | null = null
      const shutdownPromise = new Promise<void>(resolve => { shutdownPromiseResolve = resolve })

      const shutdown = async () => {
        out.info('\nShutting down...')
        controller.abort()
        if (server) {
          await server.stop()
          server = null
        }

        out.success(flags.net ? 'Local Canton net topology stopped' : 'Canton sandbox stopped')
        out.result({data: {status: 'stopped'}, success: true})
        shutdownPromiseResolve?.()
      }

      if (flags.net) {
        // --net mode: local Canton-only Docker topology
        const docker = this.createDockerManager(out, runner)

        const fullServer = this.createFullServer({
          cantonImage: DEFAULT_CANTON_IMAGE,
          config,
          docker,
          output: out,
          sdk,
        })

        server = fullServer

        await fullServer.start({
          basePort: flags['base-port'],
          cantonImage: flags['canton-image'],
          projectDir,
          signal: controller.signal,
          topologyName: flags.topology,
        })

        if (flags.json) {
          out.result({
            data: {
              mode: 'net',
              parties: config.parties?.map(p => p.name) ?? [],
              status: 'running',
              topology: flags.topology ?? 'default',
            },
            success: true,
          })
        }
      } else {
        // Default: sandbox mode
        const sandboxServer = this.createSandboxServer({config, output: out, sdk})

        server = sandboxServer

        await sandboxServer.start({
          jsonApiPort: flags['json-api-port'],
          port: flags.port,
          projectDir,
          signal: controller.signal,
        })

        if (flags.json) {
          out.result({
            data: {
              jsonApiPort: flags['json-api-port'],
              mode: 'sandbox',
              parties: config.parties?.map(p => p.name) ?? [],
              port: flags.port,
              status: 'running',
            },
            success: true,
          })
        }
      }

      // Keep process alive until shutdown signal
      await this.waitForShutdown(flags.json, shutdown, shutdownPromise)
      this.cleanupInteractiveInput(flags.json)
    } catch (err) {
      // Ensure cleanup on error
      if (server) {
        await server.stop()
      }

      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }

  protected cleanupInteractiveInput(json: boolean): void {
    if (process.stdin.isTTY && !json) {
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
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
      build: async (projectDir: string) => { await deps.sdk.build({projectDir}) },
      cantonImage: deps.cantonImage,
      config: deps.config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      docker: deps.docker,
      findDarFile,
      mkdir: (dir: string) => fs.promises.mkdir(dir, {recursive: true}).then(() => undefined),
      output: deps.output,
      readFile: (p: string) => fs.promises.readFile(p),
      rmdir: (dir: string) => fs.promises.rm(dir, {force: true, recursive: true}),
      watch: (paths, opts) => watch(paths, opts),
      writeFile: (p: string, content: string) => fs.promises.writeFile(p, content, 'utf8'),
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
      isPortInUse: (port: number) => this.isManagedPortInUse(port),
      output: deps.output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: deps.sdk,
      watch: (paths, opts) => watch(paths, opts),
    })
  }

  protected createSdk(runner: ProcessRunner): DamlSdk {
    return createDamlSdk({runner})
  }

  protected getProjectDir(): string {
    return process.cwd()
  }

  protected isManagedPortInUse(port: number): Promise<boolean> {
    return isTcpPortInUse(port)
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected async waitForShutdown(
    json: boolean,
    shutdown: () => Promise<void>,
    shutdownPromise: Promise<void>,
  ): Promise<void> {
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    if (process.stdin.isTTY && !json) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on('data', async (data) => {
        const key = data.toString()
        if (key === 'q' || key === '\u0003') {
          await shutdown()
        }
      })
    }

    await shutdownPromise
  }
}
