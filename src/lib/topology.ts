/**
 * @module topology
 *
 * Resolves and renders the local Canton-only `dev --net` topology.
 *
 * The runtime can come from:
 * - the default implicit topology derived from `config.parties`
 * - a named topology under the top-level `topologies:` config section
 *
 * The generated `.cantonctl/topology.json` manifest is the canonical runtime
 * description for the `dev --net` control-plane surface. Legacy compose
 * parsing remains as a fallback for already-generated worktrees.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type {CantonctlConfig, NamedTopologyConfig} from './config.js'
import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Port assignments for a single participant node. */
export interface ParticipantPorts {
  admin: number
  jsonApi: number
  ledgerApi: number
}

/** Synchronizer (domain) port assignments. */
export interface SynchronizerPorts {
  admin: number
  publicApi: number
}

/** A participant in the generated topology. */
export interface TopologyParticipant {
  name: string
  parties: string[]
  ports: ParticipantPorts
}

export interface TopologyMetadata {
  'base-port': number
  'canton-image': string
  mode: 'net'
  selectedBy: 'default' | 'legacy' | 'named'
  topologyName: string
}

export interface TopologyManifest {
  metadata: TopologyMetadata
  participants: TopologyParticipant[]
  synchronizer: SynchronizerPorts
}

/** Complete generated topology. */
export interface GeneratedTopology {
  bootstrapScript: string
  cantonConf: string
  dockerCompose: string
  manifest?: TopologyManifest
  participants: TopologyParticipant[]
  synchronizer: SynchronizerPorts
}

export interface TopologyOptions {
  /** Optional base-port override. */
  basePort?: number
  /** Default Canton image reference used when the named topology does not override it. */
  cantonImage: string
  /** Optional explicit Canton image override from the CLI. */
  cantonImageOverride?: string
  /** Project configuration. */
  config: CantonctlConfig
  /** Project name (used for Docker Compose project naming). */
  projectName?: string
  /** Optional named topology selection from config.topologies. */
  topologyName?: string
}

interface ResolvedTopologyDefinition {
  metadata: TopologyMetadata
  participants: Array<{name: string; parties: string[]}>
  projectName: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIG_DIR_NAME = '.cantonctl'
export const TOPOLOGY_MANIFEST_FILENAME = 'topology.json'

const DEFAULT_BASE_PORT = 10_000
const MEDIATOR_ADMIN_OFFSET = 1001

const OFFSETS = {
  admin: 1,
  jsonApi: 3,
  ledgerApi: 2,
} as const

const SYNC_OFFSETS = {
  admin: 1,
  publicApi: 2,
} as const

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function generateTopology(opts: TopologyOptions): GeneratedTopology {
  const resolved = resolveTopologyDefinition(opts)
  const {metadata, projectName} = resolved
  const basePort = metadata['base-port']

  const synchronizer: SynchronizerPorts = {
    admin: basePort + SYNC_OFFSETS.admin,
    publicApi: basePort + SYNC_OFFSETS.publicApi,
  }

  const participants = resolved.participants.map((participant, index) => {
    const rangeBase = basePort + (index + 1) * 10
    return {
      name: participant.name,
      parties: participant.parties,
      ports: {
        admin: rangeBase + OFFSETS.admin,
        jsonApi: rangeBase + OFFSETS.jsonApi,
        ledgerApi: rangeBase + OFFSETS.ledgerApi,
      },
    }
  })

  const manifest: TopologyManifest = {
    metadata,
    participants,
    synchronizer,
  }

  const cantonConf = generateCantonConf(synchronizer, participants)
  const bootstrapScript = generateBootstrapScript(participants)
  const dockerCompose = generateDockerCompose(metadata['canton-image'], projectName, synchronizer, participants)

  return {
    bootstrapScript,
    cantonConf,
    dockerCompose,
    manifest,
    participants,
    synchronizer,
  }
}

function resolveTopologyDefinition(opts: TopologyOptions): ResolvedTopologyDefinition {
  const projectName = opts.projectName ?? opts.config.project.name
  if (opts.topologyName) {
    const namedTopology = opts.config.topologies?.[opts.topologyName]
    if (!namedTopology) {
      throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
        suggestion: `Topology "${opts.topologyName}" is not defined under topologies: in cantonctl.yaml. Use "cantonctl topology show" to inspect the default topology or add topologies.${opts.topologyName}.`,
      })
    }

    return resolveNamedTopologyDefinition(opts, namedTopology, projectName)
  }

  return resolveDefaultTopologyDefinition(opts, projectName)
}

function resolveNamedTopologyDefinition(
  opts: TopologyOptions,
  topology: NamedTopologyConfig,
  projectName: string,
): ResolvedTopologyDefinition {
  return {
    metadata: {
      'base-port': opts.basePort ?? topology['base-port'] ?? DEFAULT_BASE_PORT,
      'canton-image': opts.cantonImageOverride ?? topology['canton-image'] ?? opts.cantonImage,
      mode: 'net',
      selectedBy: 'named',
      topologyName: opts.topologyName!,
    },
    participants: topology.participants.map(participant => ({
      name: participant.name,
      parties: [...participant.parties],
    })),
    projectName,
  }
}

function resolveDefaultTopologyDefinition(
  opts: TopologyOptions,
  projectName: string,
): ResolvedTopologyDefinition {
  const participantMap = assignPartiesToParticipants(opts.config.parties ?? [])

  return {
    metadata: {
      'base-port': opts.basePort ?? DEFAULT_BASE_PORT,
      'canton-image': opts.cantonImageOverride ?? opts.cantonImage,
      mode: 'net',
      selectedBy: 'default',
      topologyName: 'default',
    },
    participants: [...participantMap.entries()].map(([name, parties]) => ({name, parties})),
    projectName,
  }
}

export function serializeTopologyManifest(topology: GeneratedTopology): string {
  const manifest = topology.manifest ?? {
    metadata: {
      'base-port': DEFAULT_BASE_PORT,
      'canton-image': '',
      mode: 'net' as const,
      selectedBy: 'legacy' as const,
      topologyName: 'default',
    },
    participants: topology.participants,
    synchronizer: topology.synchronizer,
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function topologyManifestPath(projectDir: string): string {
  return path.join(projectDir, CONFIG_DIR_NAME, TOPOLOGY_MANIFEST_FILENAME)
}

function assignPartiesToParticipants(
  parties: Array<{name: string; role?: string}>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  map.set('participant1', [])
  map.set('participant2', [])

  let roundRobinIndex = 0
  const defaultTargets = ['participant1', 'participant2']

  for (const party of parties) {
    let target: string
    if (party.role === 'operator') {
      target = 'participant1'
    } else if (party.role === 'participant' || party.role === 'observer') {
      target = 'participant2'
    } else {
      target = defaultTargets[roundRobinIndex % defaultTargets.length]
      roundRobinIndex++
    }

    map.get(target)!.push(party.name)
  }

  return map
}

function generateCantonConf(sync: SynchronizerPorts, participants: TopologyParticipant[]): string {
  const participantBlocks = participants.map(participant => `
    ${participant.name} {
      storage.type = memory
      ledger-api {
        address = "0.0.0.0"
        port = ${participant.ports.ledgerApi}
      }
      admin-api {
        address = "0.0.0.0"
        port = ${participant.ports.admin}
      }
      http-ledger-api {
        address = "0.0.0.0"
        port = ${participant.ports.jsonApi}
      }
    }`).join('\n')

  return `// Generated by cantonctl — do not edit manually.
// Local Canton-only topology with in-memory storage.
// Canton 3.4.x schema: sequencers + mediators.

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
        port = ${sync.admin + MEDIATOR_ADMIN_OFFSET}
      }
    }
  }

  participants {${participantBlocks}
  }
}
`
}

function generateBootstrapScript(participants: TopologyParticipant[]): string {
  const connectBlocks = participants.map(participant =>
    `  ${participant.name}.synchronizers.connect_local(sequencer1, alias = "da")`,
  ).join('\n')

  const waitBlocks = participants.map(participant =>
    `  utils.retry_until_true { ${participant.name}.synchronizers.active("da") }`,
  ).join('\n')

  return `// Generated by cantonctl — do not edit manually.
// Local Canton-only bootstrap: start nodes, bootstrap synchronizer, connect participants.

nodes.local.start()
bootstrap.synchronizer_local()

${connectBlocks}

${waitBlocks}
`
}

function generateDockerCompose(
  image: string,
  projectName: string,
  sync: SynchronizerPorts,
  participants: TopologyParticipant[],
): string {
  const ports: string[] = [
    `${sync.publicApi}:${sync.publicApi}`,
    `${sync.admin}:${sync.admin}`,
  ]

  for (const participant of participants) {
    ports.push(
      `${participant.ports.admin}:${participant.ports.admin}`,
      `${participant.ports.ledgerApi}:${participant.ports.ledgerApi}`,
      `${participant.ports.jsonApi}:${participant.ports.jsonApi}`,
    )
  }

  const portsYaml = ports.map(port => `      - "${port}"`).join('\n')
  const healthEndpoints = participants
    .map(participant => `curl -sf http://localhost:${participant.ports.jsonApi}/v2/version`)
    .join(' && ')

  return `# Generated by cantonctl — do not edit manually.
# Local Canton-only net topology.
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

export async function detectTopology(projectDir: string): Promise<GeneratedTopology | null> {
  try {
    const configDir = path.join(projectDir, CONFIG_DIR_NAME)
    const manifestPath = path.join(configDir, TOPOLOGY_MANIFEST_FILENAME)
    const composePath = path.join(configDir, 'docker-compose.yml')
    const confPath = path.join(configDir, 'canton.conf')
    const bootstrapPath = path.join(configDir, 'bootstrap.canton')

    const manifestExists = await fs.promises.access(manifestPath).then(() => true).catch(() => false)
    if (manifestExists) {
      const [manifestContent, composeContent, cantonConf, bootstrapScript] = await Promise.all([
        fs.promises.readFile(manifestPath, 'utf8'),
        fs.promises.readFile(composePath, 'utf8').catch(() => ''),
        fs.promises.readFile(confPath, 'utf8').catch(() => ''),
        fs.promises.readFile(bootstrapPath, 'utf8').catch(() => ''),
      ])
      const manifest = parseTopologyManifest(manifestContent)
      if (!manifest) return null

      return {
        bootstrapScript,
        cantonConf,
        dockerCompose: composeContent,
        manifest,
        participants: manifest.participants,
        synchronizer: manifest.synchronizer,
      }
    }

    return await detectTopologyFromCompose(configDir)
  } catch {
    return null
  }
}

async function detectTopologyFromCompose(configDir: string): Promise<GeneratedTopology | null> {
  try {
    const confPath = path.join(configDir, 'canton.conf')
    const composePath = path.join(configDir, 'docker-compose.yml')
    const [confExists, composeExists] = await Promise.all([
      fs.promises.access(confPath).then(() => true).catch(() => false),
      fs.promises.access(composePath).then(() => true).catch(() => false),
    ])
    if (!confExists || !composeExists) return null

    const composeContent = await fs.promises.readFile(composePath, 'utf8')
    const portMatches = [...composeContent.matchAll(/localhost:(\d+)\/v2\/version/g)]
    if (portMatches.length === 0) return null

    const participants = portMatches.map((match, index) => ({
      name: `participant${index + 1}`,
      parties: [] as string[],
      ports: {admin: 0, jsonApi: Number.parseInt(match[1], 10), ledgerApi: 0},
    }))

    let syncAdmin = 0
    let syncPublicApi = 0
    const allPortMappings = [...composeContent.matchAll(/"(\d+):(\d+)"/g)]
    if (allPortMappings.length > 0) {
      const hostPorts = allPortMappings.map(match => Number.parseInt(match[1], 10)).sort((a, b) => a - b)
      if (hostPorts.length >= 2) {
        syncAdmin = hostPorts[0]
        syncPublicApi = hostPorts[1]
      }
    }

    const inferredBasePort = syncAdmin > 0 ? syncAdmin - 1 : DEFAULT_BASE_PORT
    return {
      bootstrapScript: '',
      cantonConf: '',
      dockerCompose: composeContent,
      manifest: {
        metadata: {
          'base-port': inferredBasePort,
          'canton-image': '',
          mode: 'net',
          selectedBy: 'legacy',
          topologyName: 'default',
        },
        participants,
        synchronizer: {admin: syncAdmin, publicApi: syncPublicApi},
      },
      participants,
      synchronizer: {admin: syncAdmin, publicApi: syncPublicApi},
    }
  } catch {
    return null
  }
}

function parseTopologyManifest(raw: string): TopologyManifest | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null

    const metadata = parsed.metadata as Record<string, unknown> | undefined
    const participants = parsed.participants
    const synchronizer = parsed.synchronizer as Record<string, unknown> | undefined

    if (!metadata || !Array.isArray(participants) || !synchronizer) return null

    const parsedParticipants: TopologyParticipant[] = []
    for (const participant of participants) {
      const record = participant as Record<string, unknown>
      const ports = record.ports as Record<string, unknown> | undefined
      if (
        typeof record.name !== 'string'
        || !Array.isArray(record.parties)
        || !ports
        || typeof ports.admin !== 'number'
        || typeof ports.ledgerApi !== 'number'
        || typeof ports.jsonApi !== 'number'
      ) {
        return null
      }

      parsedParticipants.push({
        name: record.name,
        parties: record.parties.map(party => String(party)),
        ports: {
          admin: ports.admin,
          jsonApi: ports.jsonApi,
          ledgerApi: ports.ledgerApi,
        },
      })
    }

    if (
      typeof metadata['base-port'] !== 'number'
      || typeof metadata['canton-image'] !== 'string'
      || metadata.mode !== 'net'
      || (metadata.selectedBy !== 'default' && metadata.selectedBy !== 'named' && metadata.selectedBy !== 'legacy')
      || typeof metadata.topologyName !== 'string'
      || typeof synchronizer.admin !== 'number'
      || typeof synchronizer.publicApi !== 'number'
    ) {
      return null
    }

    return {
      metadata: {
        'base-port': metadata['base-port'],
        'canton-image': metadata['canton-image'],
        mode: 'net',
        selectedBy: metadata.selectedBy,
        topologyName: metadata.topologyName,
      },
      participants: parsedParticipants,
      synchronizer: {
        admin: synchronizer.admin,
        publicApi: synchronizer.publicApi,
      },
    }
  } catch {
    return null
  }
}
