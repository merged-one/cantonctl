/**
 * @module dev-server
 *
 * Orchestrates the local Canton development environment. Manages the full
 * lifecycle: port checking, sandbox startup, health polling, JWT auth,
 * idempotent party provisioning, file watching with debounce, and
 * hot-reload (build + DAR upload on change).
 *
 * All dependencies are injected via {@link DevServerDeps}, enabling full
 * testability without mocking modules or touching the filesystem.
 *
 * The startup sequence mirrors the canton-upgrade-conformance-kit pattern:
 * start process → poll health endpoint → proceed when ready.
 *
 * @example
 * ```ts
 * import { createDevServer } from './dev-server.js'
 *
 * const server = createDevServer({ sdk, createClient, createToken, watch, output, findDarFile, readFile, config })
 * const controller = new AbortController()
 * await server.start({ port: 5001, jsonApiPort: 7575, projectDir: '.', signal: controller.signal })
 * // ... sandbox running with hot-reload ...
 * await server.stop()
 * ```
 */

import * as path from 'node:path'

import type {CantonctlConfig} from './config.js'
import type {DamlSdk} from './daml.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {SandboxTokenOptions} from './jwt.js'
import type {LedgerClient, LedgerClientOptions} from './ledger-client.js'
import type {OutputWriter} from './output.js'
import type {SpawnedProcess} from './process-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal chokidar-compatible watcher interface for DI. */
export interface FileWatcher {
  on(event: string, handler: (...args: unknown[]) => void): FileWatcher
  close(): Promise<void>
}

/** All external dependencies injected into the dev server. */
export interface DevServerDeps {
  /** Daml SDK abstraction for build/sandbox operations. */
  sdk: DamlSdk
  /** Factory for creating Ledger API clients. */
  createClient: (opts: LedgerClientOptions) => LedgerClient
  /** Factory for generating sandbox JWT tokens. */
  createToken: (opts: SandboxTokenOptions) => Promise<string>
  /** Factory for creating file watchers (chokidar.watch). */
  watch: (paths: string, opts?: Record<string, unknown>) => FileWatcher
  /** Output writer for status messages. */
  output: OutputWriter
  /** Find the .dar file in a directory. Returns absolute path or null. */
  findDarFile: (dir: string) => Promise<string | null>
  /** Read a file as bytes (for DAR upload). */
  readFile: (path: string) => Promise<Uint8Array>
  /** Check if a TCP port is in use. Returns true if the port is occupied. */
  isPortInUse?: (port: number) => Promise<boolean>
  /** Loaded project configuration. */
  config: CantonctlConfig
}

export interface DevServerOptions {
  /** Canton participant port. */
  port: number
  /** JSON Ledger API port. */
  jsonApiPort: number
  /** Absolute path to the project root. */
  projectDir: string
  /** AbortSignal for graceful cancellation. */
  signal?: AbortSignal
  /** Health check timeout in ms (default 60000). */
  healthTimeoutMs?: number
  /** Health check retry delay in ms (default 1000). */
  healthRetryDelayMs?: number
  /** Debounce delay for file watcher in ms (default 300). */
  debounceMs?: number
}

/** Dev server controller. */
export interface DevServer {
  /** Start the sandbox, provision parties, and begin watching for changes. */
  start(opts: DevServerOptions): Promise<void>
  /** Stop the sandbox and file watcher. */
  stop(): Promise<void>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a dev server that orchestrates sandbox lifecycle, party provisioning,
 * and hot-reload file watching.
 */
export function createDevServer(deps: DevServerDeps): DevServer {
  const {config, createClient, createToken, findDarFile, output, readFile, sdk, watch} = deps

  let sandboxProcess: SpawnedProcess | null = null
  let watcher: FileWatcher | null = null
  let client: LedgerClient | null = null
  let sandboxExited = false
  let rebuildInProgress = false
  let rebuildQueued = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  return {
    async start(opts: DevServerOptions): Promise<void> {
      const {jsonApiPort, port, projectDir} = opts
      const healthTimeout = opts.healthTimeoutMs ?? 60_000
      const healthRetryDelay = opts.healthRetryDelayMs ?? 1_000
      const debounceMs = opts.debounceMs ?? 300

      // Check abort before starting
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      // Step 1: Detect SDK
      const info = await sdk.detect()
      output.info(`Using ${info.tool} (${info.version})`)

      // Step 2: Check ports are free
      if (deps.isPortInUse) {
        for (const [label, p] of [['Canton node', port], ['JSON API', jsonApiPort]] as const) {
          if (await deps.isPortInUse(p)) {
            throw new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
              context: {port: p, service: label},
              suggestion: `Port ${p} is already in use. Stop the existing process or use --port / --json-api-port to choose different ports.`,
            })
          }
        }
      }

      // Step 3: Start sandbox
      output.info('Starting Canton sandbox...')
      sandboxExited = false
      sandboxProcess = await sdk.startSandbox({jsonApiPort, port})
      output.info(`Sandbox process started (PID: ${sandboxProcess.pid})`)

      // Wire up process exit detection for fail-fast
      sandboxProcess.onExit((code) => {
        sandboxExited = true
        if (client) {
          // Only log if we were running (not during shutdown)
          output.error(`Sandbox process exited unexpectedly (code: ${code})`)
        }
      })

      // Step 4: Poll health endpoint until ready
      const baseUrl = `http://localhost:${jsonApiPort}`

      // Generate JWT for API access
      const partyNames = config.parties?.map(p => p.name) ?? []
      const token = await createToken({
        actAs: partyNames.length > 0 ? partyNames : ['admin'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: partyNames,
      })

      client = createClient({baseUrl, token})

      await pollHealth(client, healthTimeout, healthRetryDelay, () => sandboxExited, opts.signal)
      output.success('Canton sandbox is ready')

      // Step 5: Idempotent party provisioning
      if (config.parties && config.parties.length > 0) {
        output.info('Provisioning parties...')

        // Fetch existing parties first to avoid redundant allocations
        let existingParties: Set<string> = new Set()
        try {
          const {partyDetails} = await client.getParties()
          existingParties = new Set(
            partyDetails.map((p: Record<string, unknown>) => String(p.displayName)),
          )
        } catch {
          // If listing fails, proceed with allocation (worst case: harmless duplicate attempt)
        }

        for (const party of config.parties) {
          if (existingParties.has(party.name)) {
            output.info(`  Party already exists: ${party.name}`)
            continue
          }

          try {
            await client.allocateParty({displayName: party.name})
            output.info(`  Provisioned party: ${party.name}`)
          } catch {
            output.warn(`  Failed to provision party: ${party.name}`)
          }
        }
      }

      // Step 6: Start file watcher with debounce + .daml filter
      const damlDir = path.join(projectDir, 'daml')
      watcher = watch(damlDir, {ignoreInitial: true})

      const triggerReload = async () => {
        if (sandboxExited) return
        if (rebuildInProgress) {
          rebuildQueued = true
          return
        }

        rebuildInProgress = true
        try {
          await handleFileChange(projectDir, sdk, client!, findDarFile, readFile, output)
        } finally {
          rebuildInProgress = false
          if (rebuildQueued) {
            rebuildQueued = false
            await triggerReload()
          }
        }
      }

      watcher.on('change', (filePath: unknown) => {
        const fp = String(filePath)
        if (!fp.endsWith('.daml')) return

        // Debounce: wait for edits to settle
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const relPath = path.relative(projectDir, fp)
          output.info(`File changed: ${relPath}`)
          triggerReload()
        }, debounceMs)
      })

      // Step 7: Display status
      output.log('')
      output.table(
        ['Service', 'Endpoint'],
        [
          ['Canton node', `localhost:${port}`],
          ['JSON API', `localhost:${jsonApiPort}`],
        ],
      )
      if (partyNames.length > 0) {
        output.log(`Parties: ${partyNames.join(', ')}`)
      }

      output.log(`Watching: ${damlDir}`)
      output.log('')
      output.log('Press Ctrl+C to stop')
    },

    async stop(): Promise<void> {
      // Clear debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      if (watcher) {
        await watcher.close()
        watcher = null
      }

      // Null out client before killing so exit handler knows we're shutting down
      client = null

      if (sandboxProcess) {
        sandboxProcess.kill()
        await sandboxProcess.waitForExit()
        sandboxProcess = null
        // Allow OS to reclaim ports and file locks from the JVM process tree
        await new Promise(r => setTimeout(r, 500))
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Health polling (conformance kit pattern)
// ---------------------------------------------------------------------------

/**
 * Poll the ledger API version endpoint until it responds successfully.
 * Fails fast if the sandbox process exits during polling.
 */
async function pollHealth(
  client: LedgerClient,
  timeoutMs: number,
  retryDelayMs: number,
  hasSandboxExited: () => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    // Fail fast if sandbox crashed
    if (hasSandboxExited()) {
      throw new CantonctlError(ErrorCode.SANDBOX_START_FAILED, {
        suggestion: 'Canton sandbox process exited before becoming healthy. Check SDK installation and port availability.',
      })
    }

    try {
      await client.getVersion()
      return // Success
    } catch {
      await sleep(retryDelayMs)
    }
  }

  throw new CantonctlError(ErrorCode.SANDBOX_HEALTH_TIMEOUT, {
    context: {timeoutMs},
    suggestion: `Canton sandbox did not become healthy within ${timeoutMs / 1000}s. Check if port is already in use or if the SDK is installed correctly.`,
  })
}

/**
 * Handle a file change: rebuild Daml, find the .dar, and upload it.
 * Errors are reported via output — they don't crash the server.
 */
async function handleFileChange(
  projectDir: string,
  sdk: DamlSdk,
  client: LedgerClient,
  findDarFile: (dir: string) => Promise<string | null>,
  readFile: (path: string) => Promise<Uint8Array>,
  output: OutputWriter,
): Promise<void> {
  try {
    output.info('Rebuilding...')
    await sdk.build({projectDir})
    output.success('Build successful')

    // Find the actual .dar file in .daml/dist/
    const darDir = path.join(projectDir, '.daml', 'dist')
    const darPath = await findDarFile(darDir)
    if (!darPath) {
      output.info('Build complete (no .dar file found in .daml/dist/)')
      return
    }

    const darBytes = await readFile(darPath)
    await client.uploadDar(darBytes)
    output.success(`DAR uploaded: ${path.basename(darPath)}`)
  } catch (err) {
    if (err instanceof CantonctlError) {
      output.error(`${err.code}: ${err.message}`)
    } else {
      output.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Promise-based sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
