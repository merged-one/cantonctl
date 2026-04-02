import * as path from 'node:path'

import {CantonctlError, ErrorCode} from './errors.js'

export type LocalnetProfileName = 'app-provider' | 'app-user' | 'sv'

export interface LocalnetWorkspaceProfile {
  health: {
    validatorReadyz: string
  }
  name: LocalnetProfileName
  urls: {
    ledger: string
    scan?: string
    validator: string
    wallet: string
  }
}

export interface LocalnetWorkspace {
  composeFilePath: string
  configDir: string
  env: Record<string, string>
  envFilePaths: string[]
  localnetDir: string
  makeTargets: {
    down: string
    status: string
    up: string
  }
  makefilePath: string
  profiles: Record<LocalnetProfileName, LocalnetWorkspaceProfile>
  root: string
  services: {
    ledger: string
    scan: string
    validator: string
    wallet: string
  }
}

export interface LocalnetWorkspaceDetectorDeps {
  access: (filePath: string) => Promise<void>
  readFile: (filePath: string) => Promise<string>
}

export interface LocalnetWorkspaceDetector {
  detect(workspace: string): Promise<LocalnetWorkspace>
}

const ROOT_COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const LOCALNET_DIR_CANDIDATES = ['docker/modules/localnet', 'cluster/compose/localnet', 'localnet']
const PROFILE_PORT_PREFIX: Record<LocalnetProfileName, string> = {
  'app-provider': '3',
  'app-user': '2',
  sv: '4',
}
const UI_PORT_ENV: Record<LocalnetProfileName, string> = {
  'app-provider': 'APP_PROVIDER_UI_PORT',
  'app-user': 'APP_USER_UI_PORT',
  sv: 'SV_UI_PORT',
}

export function createLocalnetWorkspaceDetector(
  deps: LocalnetWorkspaceDetectorDeps,
): LocalnetWorkspaceDetector {
  const {access, readFile} = deps

  return {
    async detect(workspace: string): Promise<LocalnetWorkspace> {
      const root = path.resolve(workspace)
      const makefilePath = path.join(root, 'Makefile')
      const composeFilePath = await findFirstExisting(
        ROOT_COMPOSE_FILES.map(name => path.join(root, name)),
        access,
      )
      const rootEnvPath = path.join(root, '.env')
      const localnetDir = await findFirstExisting(
        LOCALNET_DIR_CANDIDATES.map(name => path.join(root, name)),
        access,
      )
      const configDir = await findFirstExisting(
        [
          path.join(root, 'config'),
          ...(localnetDir ? [path.join(localnetDir, 'conf')] : []),
        ],
        access,
      )

      const requiredPaths = [
        makefilePath,
        composeFilePath,
        rootEnvPath,
        configDir,
        localnetDir ? path.join(localnetDir, 'compose.yaml') : null,
        localnetDir ? path.join(localnetDir, 'compose.env') : null,
        localnetDir ? path.join(localnetDir, 'env', 'common.env') : null,
      ].filter((entry): entry is string => Boolean(entry))

      const missing: string[] = []
      for (const entry of requiredPaths) {
        if (!await exists(entry, access)) {
          missing.push(path.relative(root, entry) || entry)
        }
      }

      if (missing.length > 0 || !composeFilePath || !localnetDir || !configDir) {
        throw new CantonctlError(ErrorCode.LOCALNET_WORKSPACE_INVALID, {
          context: {missing, workspace: root},
          suggestion: 'Expected an official LocalNet workspace with Makefile, root compose file, .env, config/, and localnet module files under docker/modules/localnet or cluster/compose/localnet.',
        })
      }

      const makefile = await readFile(makefilePath)
      const targets = parseMakeTargets(makefile)
      const makeTargets = {
        down: resolveMakeTarget(targets, ['stop', 'down']),
        status: resolveMakeTarget(targets, ['status', 'ps']),
        up: resolveMakeTarget(targets, ['start', 'up']),
      }

      const envFilePaths = [
        rootEnvPath,
        path.join(root, '.env.local'),
        path.join(localnetDir, 'compose.env'),
        path.join(localnetDir, 'env', 'common.env'),
      ]

      const env = await loadEnvFiles(
        envFilePaths,
        {
          LOCALNET_DIR: localnetDir,
          LOCALNET_ENV_DIR: path.join(localnetDir, 'env'),
        },
        access,
        readFile,
      )

      const profiles = buildProfiles(env)

      return {
        composeFilePath,
        configDir,
        env,
        envFilePaths,
        localnetDir,
        makeTargets,
        makefilePath,
        profiles,
        root,
        services: {
          ledger: profiles.sv.urls.ledger,
          scan: profiles.sv.urls.scan!,
          validator: profiles.sv.urls.validator,
          wallet: profiles.sv.urls.wallet,
        },
      }
    },
  }
}

function buildProfiles(env: Record<string, string>): Record<LocalnetProfileName, LocalnetWorkspaceProfile> {
  const hostBindIp = env.HOST_BIND_IP || '127.0.0.1'
  const validatorSuffix = env.VALIDATOR_ADMIN_API_PORT_SUFFIX || '903'

  return {
    'app-provider': buildProfile('app-provider', env, hostBindIp, validatorSuffix),
    'app-user': buildProfile('app-user', env, hostBindIp, validatorSuffix),
    sv: buildProfile('sv', env, hostBindIp, validatorSuffix),
  }
}

function buildProfile(
  name: LocalnetProfileName,
  env: Record<string, string>,
  hostBindIp: string,
  validatorSuffix: string,
): LocalnetWorkspaceProfile {
  const uiPort = env[UI_PORT_ENV[name]] || defaultUiPort(name)
  const portPrefix = PROFILE_PORT_PREFIX[name]
  const validatorPort = `${portPrefix}${validatorSuffix}`

  return {
    health: {
      validatorReadyz: `http://${hostBindIp}:${validatorPort}/api/validator/readyz`,
    },
    name,
    urls: {
      ledger: `http://canton.localhost:${uiPort}/v2`,
      scan: name === 'sv' ? `http://scan.localhost:${uiPort}/api/scan` : undefined,
      validator: `http://wallet.localhost:${uiPort}/api/validator`,
      wallet: `http://wallet.localhost:${uiPort}`,
    },
  }
}

function defaultUiPort(name: LocalnetProfileName): string {
  switch (name) {
    case 'app-user':
      return '2000'
    case 'app-provider':
      return '3000'
    case 'sv':
      return '4000'
  }
}

async function loadEnvFiles(
  filePaths: string[],
  seed: Record<string, string>,
  access: (filePath: string) => Promise<void>,
  readFile: (filePath: string) => Promise<string>,
): Promise<Record<string, string>> {
  const env = {...seed}

  for (const filePath of filePaths) {
    if (!await exists(filePath, access)) continue
    Object.assign(env, parseEnv(await readFile(filePath), env))
  }

  return env
}

function parseEnv(
  source: string,
  currentEnv: Record<string, string>,
): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const [, key, rawValue] = match
    const stripped = stripInlineComment(rawValue).trim()
    const unquoted = stripQuotes(stripped)
    parsed[key] = expandEnvValue(unquoted, {...currentEnv, ...parsed})
  }

  return parsed
}

function stripInlineComment(value: string): string {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === '#' && !inSingleQuote && !inDoubleQuote) {
      if (index === 0 || /\s/.test(value[index - 1])) {
        return value.slice(0, index)
      }
    }
  }

  return value
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function expandEnvValue(
  value: string,
  env: Record<string, string>,
): string {
  let expanded = value

  for (let iteration = 0; iteration < 5; iteration++) {
    const next = expanded
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g, (_, name: string, fallback: string) => {
        const resolved = env[name]
        return resolved && resolved.length > 0 ? resolved : expandEnvValue(fallback, env)
      })
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => env[name] ?? '')
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => env[name] ?? '')

    if (next === expanded) break
    expanded = next
  }

  return expanded
}

function parseMakeTargets(source: string): Set<string> {
  const targets = new Set<string>()

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/)
    if (!match) continue
    targets.add(match[1])
  }

  return targets
}

function resolveMakeTarget(targets: Set<string>, candidates: string[]): string {
  const target = candidates.find(candidate => targets.has(candidate))
  if (target) return target

  throw new CantonctlError(ErrorCode.LOCALNET_WORKSPACE_INVALID, {
    context: {candidates},
    suggestion: `Expected the workspace Makefile to expose one of these targets: ${candidates.join(', ')}`,
  })
}

async function findFirstExisting(
  candidates: string[],
  access: (filePath: string) => Promise<void>,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await exists(candidate, access)) return candidate
  }

  return null
}

async function exists(
  filePath: string,
  access: (filePath: string) => Promise<void>,
): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
