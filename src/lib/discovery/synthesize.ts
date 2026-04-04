import * as yaml from 'js-yaml'

import type {RawProfileConfig} from '../config-profile.js'
import type {NetworkDiscoverySnapshot} from './fetch.js'

export interface SynthesizedProfile {
  name: string
  profile: RawProfileConfig
  warnings: string[]
  yaml: string
}

export function synthesizeProfileFromDiscovery(options: {
  discovery: NetworkDiscoverySnapshot
  kind: 'remote-sv-network' | 'remote-validator'
  name?: string
}): SynthesizedProfile {
  const warnings: string[] = []
  const inferred = inferServiceUrls(options.discovery.dsoInfo)
  const name = options.name ?? defaultProfileName(options.kind, options.discovery.scanUrl)
  const profile: RawProfileConfig = {
    kind: options.kind,
    scan: {url: options.discovery.scanUrl},
  }

  if (inferred.authUrl) {
    profile.auth = {kind: 'jwt', url: inferred.authUrl}
  } else {
    warnings.push('Could not infer an auth endpoint from scan discovery data.')
  }

  if (inferred.ledgerUrl) {
    profile.ledger = {url: inferred.ledgerUrl}
  }

  if (options.kind === 'remote-validator') {
    if (inferred.validatorUrl) {
      profile.validator = {url: inferred.validatorUrl}
    } else {
      warnings.push('Could not infer a validator endpoint from scan discovery data. Add it manually if needed.')
    }
  }

  if (inferred.tokenStandardUrl) {
    profile.tokenStandard = {url: inferred.tokenStandardUrl}
  }

  if (inferred.ansUrl) {
    profile.ans = {url: inferred.ansUrl}
  }

  return {
    name,
    profile,
    warnings,
    yaml: yaml.dump({
      profiles: {
        [name]: profile,
      },
    }, {lineWidth: 120}).trim(),
  }
}

export function mergeProfileIntoConfigYaml(options: {
  existingConfigYaml: string
  synthesized: SynthesizedProfile
}): string {
  const parsed = (yaml.load(options.existingConfigYaml) as Record<string, unknown> | undefined) ?? {}
  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  parsed.profiles = {
    ...profiles,
    [options.synthesized.name]: options.synthesized.profile,
  }
  return `${yaml.dump(parsed, {lineWidth: 120}).trim()}\n`
}

function inferServiceUrls(record: unknown): {
  ansUrl?: string
  authUrl?: string
  ledgerUrl?: string
  tokenStandardUrl?: string
  validatorUrl?: string
} {
  const matches = collectUrlMatches(record)
  const pick = (patterns: RegExp[]): string | undefined =>
    matches.find(entry => patterns.some(pattern => pattern.test(entry.key)))?.value

  return {
    ansUrl: pick([/ans/i]),
    authUrl: pick([/auth/i, /issuer/i]),
    ledgerUrl: pick([/ledger/i, /json.?api/i]),
    tokenStandardUrl: pick([/token/i]),
    validatorUrl: pick([/validator/i, /wallet/i]),
  }
}

function collectUrlMatches(value: unknown, prefix = ''): Array<{key: string; value: string}> {
  if (!value || typeof value !== 'object') return []
  const entries: Array<{key: string; value: string}> = []

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string' && /^https?:\/\//i.test(child)) {
      entries.push({key: fullKey, value: child})
      continue
    }

    if (Array.isArray(child)) {
      for (const item of child) {
        entries.push(...collectUrlMatches(item, fullKey))
      }
      continue
    }

    entries.push(...collectUrlMatches(child, fullKey))
  }

  return entries
}

function defaultProfileName(kind: 'remote-sv-network' | 'remote-validator', scanUrl: string): string {
  const host = new URL(scanUrl).hostname.replace(/\./g, '-')
  return `${kind}-${host}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

