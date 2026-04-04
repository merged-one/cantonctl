/**
 * @module config
 *
 * Hierarchical configuration management for cantonctl. Loads, validates,
 * and merges configuration from multiple sources in priority order:
 *
 *   CLI flags > env vars > project config > user config
 *
 * Configuration files are YAML (`cantonctl.yaml`) validated against a Zod
 * schema. The module throws structured {@link CantonctlError} instances with
 * human-readable messages when validation fails.
 *
 * @example
 * ```ts
 * import { loadConfig, resolveConfig } from './config.js'
 *
 * // Simple: load nearest cantonctl.yaml
 * const config = await loadConfig()
 *
 * // Full resolution with env + flags + user config
 * const resolved = await resolveConfig({
 *   dir: process.cwd(),
 *   env: process.env,
 *   flags: { 'project.name': 'override' },
 * })
 * ```
 */

import * as nodeFs from 'node:fs'
import * as path from 'node:path'

import * as yaml from 'js-yaml'
import {z} from 'zod'

import {
  type LegacyNetworkConfig,
  type NetworkConfigInput,
  type NormalizedProfile,
  type RawProfileConfig,
  normalizeConfigProfiles,
} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PartySchema = z.object({
  name: z.string(),
  role: z.enum(['operator', 'participant', 'observer']).optional(),
})

const TOPOLOGY_PARTICIPANT_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const NamedTopologyParticipantSchema = z.object({
  name: z.string(),
  parties: z.array(z.string()),
})

const TOPOLOGY_DEFAULT_BASE_PORT = 10_000
const TOPOLOGY_PORT_STRIDE = 10
const TOPOLOGY_MEDIATOR_ADMIN_OFFSET = 1001

const NamedTopologySchema = z.object({
  'base-port': z.number().int().positive().optional(),
  'canton-image': z.string().optional(),
  'display-name': z.string().optional(),
  kind: z.literal('canton-multi'),
  participants: z.array(NamedTopologyParticipantSchema).min(1),
}).superRefine((topology, ctx) => {
  const participantNames = new Set<string>()
  const partyNames = new Set<string>()

  for (const [participantIndex, participant] of topology.participants.entries()) {
    if (!TOPOLOGY_PARTICIPANT_IDENTIFIER_PATTERN.test(participant.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Participant name "${participant.name}" must start with a letter or underscore and contain only letters, digits, or underscores so generated Canton config and bootstrap identifiers stay valid`,
        path: ['participants', participantIndex, 'name'],
      })
    }

    if (participantNames.has(participant.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate participant name "${participant.name}"`,
        path: ['participants', participantIndex, 'name'],
      })
    }

    participantNames.add(participant.name)

    for (const [partyIndex, party] of participant.parties.entries()) {
      if (partyNames.has(party)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate party name "${party}"`,
          path: ['participants', participantIndex, 'parties', partyIndex],
        })
      }

      partyNames.add(party)
    }
  }

  const basePort = topology['base-port'] ?? TOPOLOGY_DEFAULT_BASE_PORT
  const portOwners = new Map<number, string>([
    [basePort + 1, 'synchronizer admin'],
    [basePort + 2, 'synchronizer public'],
    [basePort + TOPOLOGY_MEDIATOR_ADMIN_OFFSET, 'mediator admin'],
  ])

  for (const [participantIndex, participant] of topology.participants.entries()) {
    const rangeBase = basePort + (participantIndex + 1) * TOPOLOGY_PORT_STRIDE
    const generatedPorts: Array<[number, string]> = [
      [rangeBase + 1, `${participant.name} admin`],
      [rangeBase + 2, `${participant.name} ledger-api`],
      [rangeBase + 3, `${participant.name} json-api`],
    ]

    for (const [port, owner] of generatedPorts) {
      const existingOwner = portOwners.get(port)
      if (existingOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Generated port collision between ${existingOwner} and ${owner}`,
          path: ['base-port'],
        })
        continue
      }

      portOwners.set(port, owner)
    }
  }
})

const NetworkSchema = z.object({
  auth: z.enum(['jwt', 'shared-secret', 'none']).optional(),
  'json-api-port': z.number().optional(),
  port: z.number().optional(),
  type: z.enum(['sandbox', 'remote', 'docker']),
  url: z.string().optional(),
})

const NetworkReferenceSchema = z.object({
  kind: z.enum(['ledger', 'splice']).optional(),
  profile: z.string(),
})

const UrlServiceSchema = z.object({
  url: z.string(),
})

const LedgerServiceSchema = z.object({
  auth: z.enum(['jwt', 'shared-secret', 'none']).optional(),
  'json-api-port': z.number().optional(),
  port: z.number().optional(),
  url: z.string().optional(),
})

const AuthServiceSchema = z.object({
  audience: z.string().optional(),
  issuer: z.string().optional(),
  kind: z.enum(['jwt', 'shared-secret', 'none', 'oidc']),
  url: z.string().optional(),
})

const LocalnetServiceSchema = z.object({
  'base-port': z.number().optional(),
  'canton-image': z.string().optional(),
  distribution: z.string().optional(),
  version: z.string().optional(),
})

const ProfileSchema = z.object({
  ans: UrlServiceSchema.optional(),
  auth: AuthServiceSchema.optional(),
  experimental: z.boolean().optional(),
  kind: z.enum(['sandbox', 'canton-multi', 'splice-localnet', 'remote-validator', 'remote-sv-network']),
  ledger: LedgerServiceSchema.optional(),
  localnet: LocalnetServiceSchema.optional(),
  scan: UrlServiceSchema.optional(),
  scanProxy: UrlServiceSchema.optional(),
  tokenStandard: UrlServiceSchema.optional(),
  validator: UrlServiceSchema.optional(),
})

const RawConfigSchema = z.object({
  'default-profile': z.string().optional(),
  networks: z.record(z.string(), z.union([NetworkSchema, NetworkReferenceSchema])).optional(),
  parties: z.array(PartySchema).optional(),
  plugins: z.array(z.string()).optional(),
  profiles: z.record(z.string(), ProfileSchema).optional(),
  topologies: z.record(z.string(), NamedTopologySchema).optional(),
  project: z.object({
    name: z.string(),
    'sdk-version': z.string(),
    template: z.string().optional(),
  }),
  version: z.number(),
}).passthrough()

type RawConfig = z.infer<typeof RawConfigSchema>
export type NamedTopologyConfig = z.infer<typeof NamedTopologySchema>
export type NamedTopologyParticipantConfig = z.infer<typeof NamedTopologyParticipantSchema>

/** Validated cantonctl configuration object. */
export interface CantonctlConfig {
  'default-profile'?: string
  networks?: Record<string, LegacyNetworkConfig>
  networkProfiles?: Record<string, string>
  parties?: Array<z.infer<typeof PartySchema>>
  plugins?: string[]
  profiles?: Record<string, NormalizedProfile>
  topologies?: Record<string, NamedTopologyConfig>
  project: z.infer<typeof RawConfigSchema>['project']
  version: number
}

/** Partial config used for user-level overrides and merge layers. */
export type PartialConfig = {
  'default-profile'?: string
  networks?: Record<string, NetworkConfigInput>
  networkProfiles?: Record<string, string>
  parties?: Array<z.infer<typeof PartySchema>>
  plugins?: string[]
  profiles?: Record<string, Partial<NormalizedProfile>>
  topologies?: Record<string, Partial<NamedTopologyConfig>>
  project?: Partial<RawConfig['project']>
  version?: number
}

type RawPartialConfig = {
  'default-profile'?: string
  networks?: Record<string, NetworkConfigInput>
  parties?: Array<z.infer<typeof PartySchema>>
  plugins?: string[]
  profiles?: Record<string, RawProfileConfig>
  topologies?: Record<string, Partial<NamedTopologyConfig>>
  project?: Partial<RawConfig['project']>
  version?: number
}

// ---------------------------------------------------------------------------
// Filesystem abstraction (for testability — no vi.mock needed)
// ---------------------------------------------------------------------------

/** Minimal filesystem interface for config loading. Inject a mock in tests. */
export interface ConfigFileSystem {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: BufferEncoding): string
}

const CONFIG_FILENAME = 'cantonctl.yaml'
const USER_CONFIG_PATH = '.config/cantonctl/config.yaml'
const ENV_PREFIX = 'CANTONCTL_'

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Directory to start searching from. Defaults to `process.cwd()`. */
  dir?: string
  /** Filesystem implementation. Defaults to Node's `fs`. */
  fs?: ConfigFileSystem
}

/**
 * Load and validate the nearest `cantonctl.yaml`.
 *
 * Searches upward from `dir` (or cwd) until it finds a config file.
 * Throws {@link CantonctlError} with appropriate error codes on failure:
 * - `E1001` CONFIG_NOT_FOUND — no config file in any parent directory
 * - `E1002` CONFIG_INVALID_YAML — YAML syntax error
 * - `E1003` CONFIG_SCHEMA_VIOLATION — config doesn't match schema
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<CantonctlConfig> {
  const fsImpl = options.fs ?? nodeFs
  const searchDir = options.dir ?? process.cwd()
  const configPath = findConfig(searchDir, fsImpl)

  if (!configPath) {
    throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
      suggestion: 'Run "cantonctl init" to create a project.',
    })
  }

  return parseAndValidate(fsImpl.readFileSync(configPath, 'utf8'))
}

export interface ResolveConfigOptions extends LoadConfigOptions {
  /** Environment variables (defaults to `process.env`). */
  env?: Record<string, string | undefined>
  /** CLI flag overrides in dot-notation (e.g., `{ 'project.name': 'foo' }`). */
  flags?: Record<string, string>
  /** Home directory for user config lookup. Defaults to `$HOME`. */
  homeDir?: string
}

/**
 * Fully resolve configuration by merging all layers in priority order:
 *
 *   1. User config (`~/.config/cantonctl/config.yaml`) — lowest priority
 *   2. Project config (`cantonctl.yaml`) — searched upward from `dir`
 *   3. Environment variables (`CANTONCTL_*`)
 *   4. CLI flags — highest priority
 *
 * @returns Merged and validated configuration
 */
export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<CantonctlConfig> {
  const fsImpl = options.fs ?? nodeFs
  const homeDir = options.homeDir ?? process.env.HOME ?? ''

  // Layer 1: User config (lowest priority)
  let userPartial: RawPartialConfig = {}
  const userConfigPath = path.join(homeDir, USER_CONFIG_PATH)
  if (fsImpl.existsSync(userConfigPath)) {
    try {
      const raw = fsImpl.readFileSync(userConfigPath, 'utf8')
      userPartial = (yaml.load(raw) as RawPartialConfig) ?? {}
    } catch {
      // Silently ignore malformed user config
    }
  }

  // Layer 2: Project config
  const projectRaw = readRawProjectConfig(options.dir ?? process.cwd(), fsImpl)

  // Merge: project over user
  let merged = mergeConfigLayers(userPartial, projectRaw)

  // Layer 3: Environment variable overrides
  const env = options.env ?? {}
  const envOverrides = parseEnvOverrides(env)
  if (Object.keys(envOverrides).length > 0) {
    merged = applyDotOverrides(merged, envOverrides)
  }

  // Layer 4: CLI flag overrides (highest priority)
  if (options.flags && Object.keys(options.flags).length > 0) {
    merged = applyDotOverrides(merged, options.flags)
  }

  return validateConfigObject(merged)
}

// ---------------------------------------------------------------------------
// Merge utilities
// ---------------------------------------------------------------------------

/**
 * Merge two validated configs. `overrides` fields take precedence over `base`.
 * Networks are deep-merged per key. Parties are concatenated. Plugins are
 * concatenated and deduplicated.
 */
export function mergeConfigs(base: CantonctlConfig, overrides: PartialConfig): CantonctlConfig {
  return mergeConfigsRaw(base, overrides) as CantonctlConfig
}

/**
 * Internal merge that works with partial configs on both sides.
 * Returns a full CantonctlConfig when base is complete.
 */
function mergeConfigsRaw(base: CantonctlConfig, overrides: PartialConfig): CantonctlConfig {
  const result: Record<string, unknown> = {...base}

  // Merge project (shallow merge)
  if (overrides.project) {
    result.project = {...base.project, ...overrides.project}
  }

  // Merge networks (deep per-network merge)
  if (overrides.networks || base.networks) {
    const baseNetworks = (base.networks ?? {}) as unknown as Record<string, Record<string, unknown>>
    const overrideNetworks = (overrides.networks ?? {}) as unknown as Record<string, Record<string, unknown>>
    const mergedNetworks: Record<string, Record<string, unknown>> = {}
    const allKeys = new Set([...Object.keys(baseNetworks), ...Object.keys(overrideNetworks)])
    for (const key of allKeys) {
      mergedNetworks[key] = {...baseNetworks[key], ...overrideNetworks[key]}
    }

    result.networks = mergedNetworks
  }

  if (overrides.networkProfiles || base.networkProfiles) {
    result.networkProfiles = {
      ...(base.networkProfiles ?? {}),
      ...(overrides.networkProfiles ?? {}),
    }
  }

  // Merge parties (concatenate)
  if (overrides.parties) {
    result.parties = [...(base.parties ?? []), ...overrides.parties]
  }

  // Merge plugins (concatenate + deduplicate)
  if (overrides.plugins) {
    const all = [...(base.plugins ?? []), ...overrides.plugins]
    result.plugins = [...new Set(all)]
  }

  if (overrides.profiles || base.profiles) {
    const baseProfiles = (base.profiles ?? {}) as Record<string, NormalizedProfile>
    const overrideProfiles = (overrides.profiles ?? {}) as Record<string, Partial<NormalizedProfile>>
    const mergedProfiles: Record<string, NormalizedProfile | Partial<NormalizedProfile>> = {}
    const allKeys = new Set([...Object.keys(baseProfiles), ...Object.keys(overrideProfiles)])
    for (const key of allKeys) {
      const baseProfile = baseProfiles[key]
      const overrideProfile = overrideProfiles[key]
      if (!baseProfile) {
        mergedProfiles[key] = overrideProfile
        continue
      }

      if (!overrideProfile) {
        mergedProfiles[key] = baseProfile
        continue
      }

      mergedProfiles[key] = {
        ...baseProfile,
        ...overrideProfile,
        services: {
          ...baseProfile.services,
          ...(overrideProfile.services ?? {}),
        },
      }
    }

    result.profiles = mergedProfiles
  }

  if (overrides.topologies || base.topologies) {
    const baseTopologies = (base.topologies ?? {}) as Record<string, NamedTopologyConfig>
    const overrideTopologies = (overrides.topologies ?? {}) as Record<string, Partial<NamedTopologyConfig>>
    const mergedTopologies: Record<string, NamedTopologyConfig | Partial<NamedTopologyConfig>> = {}
    const allKeys = new Set([...Object.keys(baseTopologies), ...Object.keys(overrideTopologies)])
    for (const key of allKeys) {
      const baseTopology = baseTopologies[key]
      const overrideTopology = overrideTopologies[key]
      if (!baseTopology) {
        mergedTopologies[key] = overrideTopology
        continue
      }

      if (!overrideTopology) {
        mergedTopologies[key] = baseTopology
        continue
      }

      mergedTopologies[key] = {
        ...baseTopology,
        ...overrideTopology,
        participants: overrideTopology.participants ?? baseTopology.participants,
      }
    }

    result.topologies = mergedTopologies
  }

  if (overrides['default-profile'] !== undefined) {
    result['default-profile'] = overrides['default-profile']
  }

  // Carry over version from override if present
  if (overrides.version !== undefined) {
    result.version = overrides.version
  }

  return result as unknown as CantonctlConfig
}

// ---------------------------------------------------------------------------
// Environment variable parsing
// ---------------------------------------------------------------------------

/**
 * Parse `CANTONCTL_*` environment variables into dot-notation overrides.
 *
 * `CANTONCTL_PROJECT_NAME=foo` → `{ 'project.name': 'foo' }`
 * `CANTONCTL_PROJECT_SDK_VERSION=3.5.0` → `{ 'project.sdk-version': '3.5.0' }`
 */
function parseEnvOverrides(env: Record<string, string | undefined>): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX) || value === undefined) continue
    const path = key
      .slice(ENV_PREFIX.length)
      .toLowerCase()
      .replace(/_/g, '.')
      // Handle sdk-version special case: sdk.version → sdk-version
      .replace('project.sdk.version', 'project.sdk-version')
    overrides[path] = value
  }

  return overrides
}

/**
 * Apply dot-notation overrides to a config object.
 * `{ 'project.name': 'foo' }` sets `config.project.name = 'foo'`.
 */
function applyDotOverrides<T extends Record<string, unknown>>(config: T, overrides: Record<string, string>): T {
  const result = structuredClone(config)
  for (const [dotPath, value] of Object.entries(overrides)) {
    const parts = dotPath.split('.')
    let target: Record<string, unknown> = result as unknown as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in target) || typeof target[parts[i]] !== 'object') {
        target[parts[i]] = {}
      }

      target = target[parts[i]] as Record<string, unknown>
    }

    target[parts[parts.length - 1]] = value
  }

  return result
}

// ---------------------------------------------------------------------------
// File search
// ---------------------------------------------------------------------------

/**
 * Walk upward from `startDir` looking for `cantonctl.yaml`.
 * Returns the absolute path if found, undefined otherwise.
 */
function findConfig(startDir: string, fsImpl: ConfigFileSystem): string | undefined {
  let current = startDir
  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME)
    if (fsImpl.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

// ---------------------------------------------------------------------------
// YAML parsing + Zod validation with human-readable errors
// ---------------------------------------------------------------------------

/**
 * Parse YAML string and validate against the config schema.
 * Throws CantonctlError with detailed messages on failure.
 */
function parseAndValidate(raw: string): CantonctlConfig {
  return validateConfigObject(parseYaml(raw))
}

function parseYaml(raw: string): unknown {
  try {
    return yaml.load(raw)
  } catch (err) {
    throw new CantonctlError(ErrorCode.CONFIG_INVALID_YAML, {
      cause: err as Error,
      suggestion: 'Check your YAML syntax. Common issues: incorrect indentation, missing colons, or unquoted special characters.',
    })
  }
}

function validateConfigObject(parsed: unknown): CantonctlConfig {
  const result = RawConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${path}: ${issue.message}`
    })

    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {
        issues: result.error.issues.map(i => ({
          message: i.message,
          path: i.path.join('.'),
        })),
      },
      suggestion: `Fix the following fields in cantonctl.yaml:\n${issues.join('\n')}`,
    })
  }

  const normalized = normalizeConfigProfiles(result.data)
  const networkProfiles = collectNetworkProfiles(result.data, normalized)
  const {
    'default-profile': _rawDefaultProfile,
    networks: _rawNetworks,
    parties,
    plugins,
    profiles: _rawProfiles,
    project,
    version,
    ...rest
  } = result.data

  return {
    ...rest,
    'default-profile': normalized.defaultProfile,
    networks: Object.keys(normalized.networks).length > 0 ? normalized.networks : undefined,
    networkProfiles: Object.keys(networkProfiles).length > 0 ? networkProfiles : undefined,
    parties,
    plugins,
    profiles: Object.keys(normalized.profiles).length > 0 ? normalized.profiles : undefined,
    topologies: result.data.topologies,
    project,
    version,
  }
}

function collectNetworkProfiles(
  raw: RawConfig,
  normalized: ReturnType<typeof normalizeConfigProfiles>,
): Record<string, string> {
  const networkProfiles: Record<string, string> = {}

  for (const [name, network] of Object.entries(raw.networks ?? {})) {
    if ('profile' in network) {
      networkProfiles[name] = network.profile
      continue
    }

    networkProfiles[name] = name
  }

  if (
    !raw.networks?.local
    && normalized.defaultProfile
    && normalized.networks.local
    && normalized.profiles[normalized.defaultProfile]
  ) {
    networkProfiles.local = normalized.defaultProfile
  }

  return networkProfiles
}

function readRawProjectConfig(searchDir: string, fsImpl: ConfigFileSystem): RawConfig {
  const configPath = findConfig(searchDir, fsImpl)

  if (!configPath) {
    throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
      suggestion: 'Run "cantonctl init" to create a project.',
    })
  }

  const parsed = parseYaml(fsImpl.readFileSync(configPath, 'utf8'))
  const result = RawConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${path}: ${issue.message}`
    })

    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {
        issues: result.error.issues.map(i => ({
          message: i.message,
          path: i.path.join('.'),
        })),
      },
      suggestion: `Fix the following fields in cantonctl.yaml:\n${issues.join('\n')}`,
    })
  }

  return result.data
}

function mergeConfigLayers(base: RawPartialConfig, overrides: RawConfig): RawPartialConfig {
  const result: Record<string, unknown> = {...base}

  result.project = {...(base.project ?? {}), ...overrides.project}

  if (overrides.networks || base.networks) {
    const baseNetworks = (base.networks ?? {}) as unknown as Record<string, Record<string, unknown>>
    const overrideNetworks = (overrides.networks ?? {}) as unknown as Record<string, Record<string, unknown>>
    const mergedNetworks: Record<string, Record<string, unknown>> = {}
    const allKeys = new Set([...Object.keys(baseNetworks), ...Object.keys(overrideNetworks)])
    for (const key of allKeys) {
      mergedNetworks[key] = {...baseNetworks[key], ...overrideNetworks[key]}
    }

    result.networks = mergedNetworks
  }

  if (overrides.parties) {
    result.parties = [...(base.parties ?? []), ...overrides.parties]
  }

  if (overrides.plugins) {
    const all = [...(base.plugins ?? []), ...overrides.plugins]
    result.plugins = [...new Set(all)]
  }

  if (overrides.profiles || base.profiles) {
    const baseProfiles = (base.profiles ?? {}) as unknown as Record<string, Record<string, unknown>>
    const overrideProfiles = (overrides.profiles ?? {}) as unknown as Record<string, Record<string, unknown>>
    const mergedProfiles: Record<string, Record<string, unknown>> = {}
    const allKeys = new Set([...Object.keys(baseProfiles), ...Object.keys(overrideProfiles)])
    for (const key of allKeys) {
      const baseProfile = baseProfiles[key] ?? {}
      const overrideProfile = overrideProfiles[key] ?? {}
      mergedProfiles[key] = {...baseProfile, ...overrideProfile}

      for (const serviceKey of ['ans', 'auth', 'ledger', 'localnet', 'scan', 'scanProxy', 'tokenStandard', 'validator']) {
        if (!baseProfile[serviceKey] && !overrideProfile[serviceKey]) continue
        mergedProfiles[key][serviceKey] = {
          ...(baseProfile[serviceKey] as Record<string, unknown> | undefined),
          ...(overrideProfile[serviceKey] as Record<string, unknown> | undefined),
        }
      }
    }

    result.profiles = mergedProfiles
  }

  if (overrides['default-profile'] !== undefined) {
    result['default-profile'] = overrides['default-profile']
  }

  result.version = overrides.version

  return result as RawPartialConfig
}
