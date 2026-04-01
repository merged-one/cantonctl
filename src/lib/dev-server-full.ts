/**
 * @module dev-server-full
 *
 * Orchestrates a multi-node Canton development environment using Docker Compose.
 * This is the `--full` mode counterpart to the sandbox-based dev server.
 *
 * The startup sequence follows the conformance kit pattern:
 *   1. Check Docker is available
 *   2. Generate topology configs from cantonctl.yaml
 *   3. Write configs to .cantonctl/ directory
 *   4. Start Docker Compose
 *   5. Poll health endpoints for all participants
 *   6. Generate JWTs and provision parties on each participant
 *   7. Start file watcher for hot-reload
 *   8. Display multi-node status table
 *
 * All dependencies are injected via {@link FullDevServerDeps}.
 *
 * @example
 * ```ts
 * const server = createFullDevServer({ docker, config, ... })
 * await server.start({ projectDir: '/my-project' })
 * // ... multi-node topology running with hot-reload ...
 * await server.stop()
 * ```
 */

import * as path from 'node:path'

import type {CantonctlConfig} from './config.js'
import type {DockerManager} from './docker.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {SandboxTokenOptions} from './jwt.js'
import type {LedgerClient, LedgerClientOptions} from './ledger-client.js'
import type {OutputWriter} from './output.js'
import {generateTopology, type GeneratedTopology, type TopologyParticipant} from './topology.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal chokidar-compatible watcher interface for DI. */
export interface FileWatcher {
  on(event: string, handler: (...args: unknown[]) => void): FileWatcher
  close(): Promise<void>
}

export interface FullDevServerDeps {
  /** Docker Compose lifecycle manager. */
  docker: DockerManager
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
  /** Write a file (for generated configs). */
  writeFile: (filePath: string, content: string) => Promise<void>
  /** Create a directory recursively. */
  mkdir: (dir: string) => Promise<void>
  /** Remove a directory recursively. */
  rmdir: (dir: string) => Promise<void>
  /** Build Daml project. */
  build: (projectDir: string) => Promise<void>
  /** Loaded project configuration. */
  config: CantonctlConfig
  /** Canton Docker image to use. */
  cantonImage: string
}

export interface FullDevServerOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** AbortSignal for graceful cancellation. */
  signal?: AbortSignal
  /** Base port for the topology (default 10000). */
  basePort?: number
  /** Health check timeout in ms (default 120000). */
  healthTimeoutMs?: number
  /** Health check retry delay in ms (default 2000). */
  healthRetryDelayMs?: number
  /** Debounce delay for file watcher in ms (default 300). */
  debounceMs?: number
}

export interface FullDevServer {
  /** Start the multi-node topology, provision parties, and begin watching. */
  start(opts: FullDevServerOptions): Promise<void>
  /** Stop the topology and file watcher. */
  stop(): Promise<void>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Directory within project for generated configs. */
const CONFIG_DIR = '.cantonctl'

export function createFullDevServer(deps: FullDevServerDeps): FullDevServer {
  const {build, cantonImage, config, createClient, createToken, docker, findDarFile, mkdir, output, readFile, rmdir, watch, writeFile} = deps

  let watcher: FileWatcher | null = null
  let topology: GeneratedTopology | null = null
  let configDir: string | null = null
  let clients: Array<{client: LedgerClient; participant: TopologyParticipant}> = []
  let rebuildInProgress = false
  let rebuildQueued = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  return {
    async start(opts: FullDevServerOptions): Promise<void> {
      const {projectDir} = opts
      const healthTimeout = opts.healthTimeoutMs ?? 120_000
      const healthRetryDelay = opts.healthRetryDelayMs ?? 2_000
      const debounceMs = opts.debounceMs ?? 300

      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      // Step 1: Check Docker is available
      await docker.checkAvailable()

      // Step 2: Generate topology from config
      output.info('Generating multi-node topology...')
      topology = generateTopology({
        basePort: opts.basePort,
        cantonImage,
        config,
      })

      output.info(`Topology: ${topology.participants.length} participants + 1 synchronizer`)

      // Step 3: Write generated configs to .cantonctl/
      configDir = path.join(projectDir, CONFIG_DIR)
      await mkdir(configDir)
      await writeFile(path.join(configDir, 'docker-compose.yml'), topology.dockerCompose)
      await writeFile(path.join(configDir, 'canton.conf'), topology.cantonConf)
      await writeFile(path.join(configDir, 'bootstrap.canton'), topology.bootstrapScript)

      // Step 4: Start Docker Compose
      const composeFile = path.join(configDir, 'docker-compose.yml')
      await docker.composeUp({composeFile, cwd: configDir})

      // Step 5: Poll health for all participants
      output.info('Waiting for all participants to become healthy...')
      const partyNames = config.parties?.map(p => p.name) ?? []

      for (const participant of topology.participants) {
        const baseUrl = `http://localhost:${participant.ports.jsonApi}`
        const token = await createToken({
          actAs: partyNames.length > 0 ? partyNames : ['admin'],
          admin: true,
          applicationId: 'cantonctl',
          readAs: partyNames,
        })

        const client = createClient({baseUrl, token})
        await pollHealth(client, participant.name, healthTimeout, healthRetryDelay, opts.signal)
        clients.push({client, participant})
        output.success(`${participant.name} is healthy (JSON API: ${participant.ports.jsonApi})`)
      }

      // Step 6: Provision parties on their assigned participants
      for (const {client, participant} of clients) {
        if (participant.parties.length === 0) continue

        output.info(`Provisioning parties on ${participant.name}...`)

        let existingParties = new Set<string>()
        try {
          const {partyDetails} = await client.getParties()
          existingParties = new Set(
            partyDetails.map((p: Record<string, unknown>) => String(p.displayName)),
          )
        } catch {
          // If listing fails, proceed with allocation
        }

        for (const partyName of participant.parties) {
          if (existingParties.has(partyName)) {
            output.info(`  Party already exists: ${partyName}`)
            continue
          }

          try {
            await client.allocateParty({displayName: partyName})
            output.info(`  Provisioned party: ${partyName}`)
          } catch {
            output.warn(`  Failed to provision party: ${partyName}`)
          }
        }
      }

      // Step 7: Start file watcher with debounce + .daml filter
      const damlDir = path.join(projectDir, 'daml')
      watcher = watch(damlDir, {ignoreInitial: true})

      const triggerReload = async () => {
        if (rebuildInProgress) {
          rebuildQueued = true
          return
        }

        rebuildInProgress = true
        try {
          await handleFileChange(projectDir, build, clients, findDarFile, readFile, output)
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

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const relPath = path.relative(projectDir, fp)
          output.info(`File changed: ${relPath}`)
          triggerReload()
        }, debounceMs)
      })

      // Step 8: Display status
      output.log('')
      output.table(
        ['Node', 'JSON API', 'Parties'],
        topology.participants.map(p => [
          p.name,
          `localhost:${p.ports.jsonApi}`,
          p.parties.length > 0 ? p.parties.join(', ') : '(none)',
        ]),
      )
      output.log('')
      output.table(
        ['Synchronizer', 'Endpoint'],
        [
          ['Public API', `localhost:${topology.synchronizer.publicApi}`],
          ['Admin API', `localhost:${topology.synchronizer.admin}`],
        ],
      )
      output.log(`\nWatching: ${damlDir}`)
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

      clients = []

      // Stop Docker Compose
      if (configDir && topology) {
        const composeFile = path.join(configDir, 'docker-compose.yml')
        await docker.composeDown({composeFile, cwd: configDir})
      }

      // Clean up generated configs
      if (configDir) {
        try {
          await rmdir(configDir)
        } catch {
          // Non-fatal: config dir may already be gone
        }

        configDir = null
      }

      topology = null
    },
  }
}

// ---------------------------------------------------------------------------
// Health polling (conformance kit pattern)
// ---------------------------------------------------------------------------

async function pollHealth(
  client: LedgerClient,
  participantName: string,
  timeoutMs: number,
  retryDelayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    try {
      await client.getVersion()
      return
    } catch {
      await sleep(retryDelayMs)
    }
  }

  throw new CantonctlError(ErrorCode.SANDBOX_HEALTH_TIMEOUT, {
    context: {participant: participantName, timeoutMs},
    suggestion: `Participant ${participantName} did not become healthy within ${timeoutMs / 1000}s. Check Docker logs with: docker compose -f .cantonctl/docker-compose.yml logs`,
  })
}

// ---------------------------------------------------------------------------
// Hot-reload across all participants
// ---------------------------------------------------------------------------

async function handleFileChange(
  projectDir: string,
  buildFn: (projectDir: string) => Promise<void>,
  clients: Array<{client: LedgerClient; participant: TopologyParticipant}>,
  findDarFile: (dir: string) => Promise<string | null>,
  readFile: (path: string) => Promise<Uint8Array>,
  output: OutputWriter,
): Promise<void> {
  try {
    output.info('Rebuilding...')
    await buildFn(projectDir)
    output.success('Build successful')

    const darDir = path.join(projectDir, '.daml', 'dist')
    const darPath = await findDarFile(darDir)
    if (!darPath) {
      output.info('Build complete (no .dar file found in .daml/dist/)')
      return
    }

    const darBytes = await readFile(darPath)
    const darName = path.basename(darPath)

    // Upload to ALL participants
    for (const {client, participant} of clients) {
      try {
        await client.uploadDar(darBytes)
        output.success(`DAR uploaded to ${participant.name}: ${darName}`)
      } catch (err) {
        if (err instanceof CantonctlError) {
          output.error(`Upload to ${participant.name}: ${err.code}: ${err.message}`)
        } else {
          output.error(`Upload to ${participant.name} failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  } catch (err) {
    if (err instanceof CantonctlError) {
      output.error(`${err.code}: ${err.message}`)
    } else {
      output.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
