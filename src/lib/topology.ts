/**
 * @module topology
 *
 * Generates Docker Compose, Canton HOCON, and bootstrap script configurations
 * from a cantonctl.yaml config for multi-node development topologies.
 *
 * This module is a pure function — it takes configuration and returns strings.
 * No I/O, no Docker calls, no side effects. Fully testable without Docker.
 *
 * The generated topology follows the conformance kit pattern: a single Canton
 * container hosts multiple logical nodes (synchronizer + N participants),
 * differentiated by port prefix.
 *
 * @example
 * ```ts
 * import { generateTopology } from './topology.js'
 *
 * const topology = generateTopology({
 *   config,
 *   cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
 *   basePort: 10000,
 * })
 *
 * // topology.dockerCompose — Docker Compose YAML string
 * // topology.cantonConf    — Canton HOCON config string
 * // topology.bootstrapScript — Canton bootstrap script string
 * // topology.participants  — Array of { name, ports, parties }
 * ```
 */

import type {CantonctlConfig} from './config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Port assignments for a single participant node. */
export interface ParticipantPorts {
  /** Canton admin API port. */
  admin: number
  /** JSON Ledger API (HTTP) port. */
  jsonApi: number
  /** Canton Ledger API (gRPC) port. */
  ledgerApi: number
}

/** Synchronizer (domain) port assignments. */
export interface SynchronizerPorts {
  /** Admin API port. */
  admin: number
  /** Public API port (sequencer). */
  publicApi: number
}

/** A participant in the generated topology. */
export interface TopologyParticipant {
  /** Participant identifier (e.g., 'participant1'). */
  name: string
  /** Assigned parties. */
  parties: string[]
  /** Port assignments. */
  ports: ParticipantPorts
}

/** Complete generated topology. */
export interface GeneratedTopology {
  /** Canton bootstrap script content. */
  bootstrapScript: string
  /** Canton HOCON configuration content. */
  cantonConf: string
  /** Docker Compose YAML content. */
  dockerCompose: string
  /** Participant metadata (for status display and health polling). */
  participants: TopologyParticipant[]
  /** Synchronizer port assignments. */
  synchronizer: SynchronizerPorts
}

export interface TopologyOptions {
  /** Base port for port assignment scheme. Default: 10000. */
  basePort?: number
  /** Canton Docker image reference. */
  cantonImage: string
  /** Project configuration. */
  config: CantonctlConfig
  /** Project name (used for Docker Compose project naming). */
  projectName?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default base port for the topology port scheme. */
const DEFAULT_BASE_PORT = 10_000

/** Port offsets within each participant's port range (10 ports per participant). */
const OFFSETS = {
  admin: 1,
  jsonApi: 3,
  ledgerApi: 2,
} as const

/** Synchronizer uses the first port range (index 0). */
const SYNC_OFFSETS = {
  admin: 1,
  publicApi: 2,
} as const

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generate a complete multi-node topology from cantonctl.yaml config.
 *
 * Pure function — no I/O, no side effects. Returns strings ready to write to disk.
 */
export function generateTopology(opts: TopologyOptions): GeneratedTopology {
  const basePort = opts.basePort ?? DEFAULT_BASE_PORT
  const projectName = opts.projectName ?? opts.config.project.name
  const parties = opts.config.parties ?? []

  // Determine participants from party roles
  const participantMap = assignPartiesToParticipants(parties)
  const participantNames = [...participantMap.keys()]

  // Ensure at least 2 participants for a meaningful multi-node setup
  if (participantNames.length < 2) {
    // Add a second empty participant if needed
    if (!participantMap.has('participant2')) {
      participantMap.set('participant2', [])
    }
  }

  // Synchronizer gets port range 0 (basePort + 0..9)
  const synchronizer: SynchronizerPorts = {
    admin: basePort + SYNC_OFFSETS.admin,
    publicApi: basePort + SYNC_OFFSETS.publicApi,
  }

  // Participants get port ranges starting at index 1
  const participants: TopologyParticipant[] = []
  let idx = 1
  for (const [name, assignedParties] of participantMap) {
    const rangeBase = basePort + idx * 10
    participants.push({
      name,
      parties: assignedParties,
      ports: {
        admin: rangeBase + OFFSETS.admin,
        jsonApi: rangeBase + OFFSETS.jsonApi,
        ledgerApi: rangeBase + OFFSETS.ledgerApi,
      },
    })
    idx++
  }

  const cantonConf = generateCantonConf(synchronizer, participants)
  const bootstrapScript = generateBootstrapScript(synchronizer, participants)
  const dockerCompose = generateDockerCompose(opts.cantonImage, projectName, synchronizer, participants)

  return {
    bootstrapScript,
    cantonConf,
    dockerCompose,
    participants,
    synchronizer,
  }
}

// ---------------------------------------------------------------------------
// Party-to-participant assignment
// ---------------------------------------------------------------------------

/**
 * Assign parties to participants based on their roles.
 *
 * - `operator` parties → participant1
 * - `participant` parties → participant2
 * - `observer` parties → participant2
 * - No role → round-robin starting from participant1
 */
function assignPartiesToParticipants(
  parties: Array<{name: string; role?: string}>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  map.set('participant1', [])
  map.set('participant2', [])

  let roundRobinIdx = 0
  const targets = ['participant1', 'participant2']

  for (const party of parties) {
    let target: string
    if (party.role === 'operator') {
      target = 'participant1'
    } else if (party.role === 'participant' || party.role === 'observer') {
      target = 'participant2'
    } else {
      target = targets[roundRobinIdx % targets.length]
      roundRobinIdx++
    }

    map.get(target)!.push(party.name)
  }

  return map
}

// ---------------------------------------------------------------------------
// Canton HOCON generation
// ---------------------------------------------------------------------------

function generateCantonConf(
  sync: SynchronizerPorts,
  participants: TopologyParticipant[],
): string {
  const participantBlocks = participants.map(p => `
    ${p.name} {
      storage.type = memory
      ledger-api {
        address = "0.0.0.0"
        port = ${p.ports.ledgerApi}
      }
      admin-api {
        address = "0.0.0.0"
        port = ${p.ports.admin}
      }
      http-ledger-api {
        address = "0.0.0.0"
        port = ${p.ports.jsonApi}
      }
    }`).join('\n')

  return `// Generated by cantonctl — do not edit manually.
// Multi-node development topology with in-memory storage.
// Canton 3.4.x schema: sequencers + mediators (not legacy "domains").

canton {
  parameters {
    non-standard-config = yes
  }

  sequencers {
    sequencer1 {
      storage.type = memory
      public-api {
        address = "0.0.0.0"
        port = ${sync.publicApi}
      }
      admin-api {
        address = "0.0.0.0"
        port = ${sync.admin}
      }
      sequencer.type = BFT
    }
  }

  mediators {
    mediator1 {
      storage.type = memory
      admin-api {
        address = "0.0.0.0"
        port = ${sync.admin + 100}
      }
    }
  }

  participants {${participantBlocks}
  }
}
`
}

// ---------------------------------------------------------------------------
// Bootstrap script generation
// ---------------------------------------------------------------------------

function generateBootstrapScript(
  _sync: SynchronizerPorts,
  participants: TopologyParticipant[],
): string {
  const connectBlocks = participants.map(p =>
    `  ${p.name}.synchronizers.connect_local(sequencer1, alias = "da")`,
  ).join('\n')

  const waitBlocks = participants.map(p =>
    `  utils.retry_until_true { ${p.name}.synchronizers.active("da") }`,
  ).join('\n')

  // Canton bootstrap scripts run in Ammonite (Scala scripting).
  // Top-level statements execute directly when the script is loaded via --bootstrap.
  return `// Generated by cantonctl — do not edit manually.
// Canton 3.4.x bootstrap: start nodes, bootstrap synchronizer, connect participants.

nodes.local.start()
bootstrap.synchronizer_local()

${connectBlocks}

${waitBlocks}
`
}

// ---------------------------------------------------------------------------
// Docker Compose generation
// ---------------------------------------------------------------------------

function generateDockerCompose(
  image: string,
  projectName: string,
  sync: SynchronizerPorts,
  participants: TopologyParticipant[],
): string {
  // Collect all ports that need to be exposed
  const ports: string[] = [
    `${sync.publicApi}:${sync.publicApi}`,
    `${sync.admin}:${sync.admin}`,
  ]

  for (const p of participants) {
    ports.push(
      `${p.ports.admin}:${p.ports.admin}`,
      `${p.ports.ledgerApi}:${p.ports.ledgerApi}`,
      `${p.ports.jsonApi}:${p.ports.jsonApi}`,
    )
  }

  const portsYaml = ports.map(p => `      - "${p}"`).join('\n')

  // Health check polls each participant's JSON API
  const healthEndpoints = participants
    .map(p => `curl -sf http://localhost:${p.ports.jsonApi}/v2/version`)
    .join(' && ')

  return `# Generated by cantonctl — do not edit manually.
# Multi-node Canton development topology.
name: ${projectName}

services:
  canton:
    image: ${image}
    entrypoint: ["/app/bin/canton"]
    command:
      - daemon
      - --no-tty
      - --log-encoder=json
      - --log-level-stdout=INFO
      - --log-file-appender=off
      - --config
      - /app/app.conf
      - --bootstrap
      - /canton/bootstrap.canton
    volumes:
      - ./canton.conf:/app/app.conf:ro
      - ./bootstrap.canton:/canton/bootstrap.canton:ro
    ports:
${portsYaml}
    healthcheck:
      test: ["CMD-SHELL", "${healthEndpoints}"]
      interval: 10s
      timeout: 30s
      retries: 30
      start_period: 30s
    tmpfs:
      - /tmp:exec,size=1G
`
}
