/**
 * @module commands/dev
 *
 * Starts a local Canton development environment with hot-reload.
 * Thin oclif wrapper over {@link createDevServer} (sandbox mode)
 * and {@link createFullDevServer} (multi-node Docker mode).
 *
 * @example
 * ```bash
 * cantonctl dev                      # Start sandbox on default ports
 * cantonctl dev --port 6001          # Custom Canton node port
 * cantonctl dev --full               # Multi-node topology via Docker
 * cantonctl dev --json               # JSON output for CI
 * ```
 */

import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import {watch} from 'chokidar'

import {loadConfig} from '../lib/config.js'
import {createDamlSdk} from '../lib/daml.js'
import {createFullDevServer, type FullDevServer} from '../lib/dev-server-full.js'
import {createDevServer, type DevServer} from '../lib/dev-server.js'
import {createDockerManager} from '../lib/docker.js'
import {CantonctlError} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner} from '../lib/process-runner.js'

/** Default Canton Docker image for --full mode. */
const DEFAULT_CANTON_IMAGE = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'

/**
 * Check if a TCP port is currently in use.
 * Attempts to create a server on the port; if it fails with EADDRINUSE, the port is occupied.
 */
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

/**
 * Find the first .dar file in a directory.
 * Returns the absolute path or null if no .dar files exist.
 */
async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const darFile = entries.find(e => e.endsWith('.dar'))
    return darFile ? path.join(dir, darFile) : null
  } catch {
    return null
  }
}

export default class Dev extends Command {
  static override description = 'Start a local Canton development environment with hot-reload'

  static override examples = [
    '<%= config.bin %> dev',
    '<%= config.bin %> dev --port 6001',
    '<%= config.bin %> dev --full',
    '<%= config.bin %> dev --full --base-port 20000',
    '<%= config.bin %> dev --json',
  ]

  static override flags = {
    'base-port': Flags.integer({
      default: 10_000,
      description: 'Base port for multi-node topology (--full mode only)',
    }),
    'canton-image': Flags.string({
      default: DEFAULT_CANTON_IMAGE,
      description: 'Canton Docker image for --full mode',
    }),
    full: Flags.boolean({
      default: false,
      description: 'Start full multi-node topology (requires Docker)',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'JSON Ledger API port (sandbox mode only)',
    }),
    port: Flags.integer({
      char: 'p',
      default: 5001,
      description: 'Canton node port (sandbox mode only)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Dev)
    const out = createOutput({json: flags.json})

    let server: DevServer | FullDevServer | null = null

    try {
      const config = await loadConfig()
      const runner = createProcessRunner()

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

        out.success(flags.full ? 'Multi-node topology stopped' : 'Canton sandbox stopped')
        out.result({data: {status: 'stopped'}, success: true})
        shutdownPromiseResolve?.()
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)

      // Handle keyboard input ([q] to quit) — only in TTY mode
      if (process.stdin.isTTY && !flags.json) {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on('data', async (data) => {
          const key = data.toString()
          if (key === 'q' || key === '\u0003') {
            await shutdown()
          }
        })
      }

      if (flags.full) {
        // --full mode: multi-node Docker topology
        const sdk = createDamlSdk({runner})
        const docker = createDockerManager({output: out, runner})

        const fullServer = createFullDevServer({
          build: async (projectDir: string) => { await sdk.build({projectDir}) },
          cantonImage: flags['canton-image'],
          config,
          createClient: createLedgerClient,
          createToken: createSandboxToken,
          docker,
          findDarFile,
          mkdir: (dir: string) => fs.promises.mkdir(dir, {recursive: true}).then(() => undefined),
          output: out,
          readFile: (p: string) => fs.promises.readFile(p),
          rmdir: (dir: string) => fs.promises.rm(dir, {force: true, recursive: true}),
          watch: (paths, opts) => watch(paths, opts),
          writeFile: (p: string, content: string) => fs.promises.writeFile(p, content, 'utf8'),
        })

        server = fullServer

        await fullServer.start({
          basePort: flags['base-port'],
          projectDir: process.cwd(),
          signal: controller.signal,
        })

        if (flags.json) {
          out.result({
            data: {
              mode: 'full',
              parties: config.parties?.map(p => p.name) ?? [],
              status: 'running',
            },
            success: true,
          })
        }
      } else {
        // Default: sandbox mode
        const sandboxServer = createDevServer({
          config,
          createClient: createLedgerClient,
          createToken: createSandboxToken,
          findDarFile,
          isPortInUse,
          output: out,
          readFile: (p) => fs.promises.readFile(p),
          sdk: createDamlSdk({runner}),
          watch: (paths, opts) => watch(paths, opts),
        })

        server = sandboxServer

        await sandboxServer.start({
          jsonApiPort: flags['json-api-port'],
          port: flags.port,
          projectDir: process.cwd(),
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
      await shutdownPromise

      // Clean up stdin
      if (process.stdin.isTTY && !flags.json) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
      }
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
}
