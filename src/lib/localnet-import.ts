import * as yaml from 'js-yaml'

import type {RawProfileConfig} from './config-profile.js'
import type {LocalnetProfileName, LocalnetWorkspace} from './localnet-workspace.js'

export interface SynthesizedLocalnetProfile {
  name: string
  network: {profile: string}
  networkName: string
  profile: RawProfileConfig
  sourceProfile: LocalnetProfileName
  warnings: string[]
  yaml: string
}

export function synthesizeProfileFromLocalnetWorkspace(options: {
  name?: string
  networkName?: string
  sourceProfile?: LocalnetProfileName
  workspace: LocalnetWorkspace
}): SynthesizedLocalnetProfile {
  const sourceProfile = options.sourceProfile ?? 'sv'
  const selected = options.workspace.profiles[sourceProfile]
  const name = options.name ?? 'splice-localnet'
  const networkName = options.networkName ?? 'localnet'
  const warnings: string[] = []

  const profile: RawProfileConfig = {
    kind: 'splice-localnet',
    ledger: {url: selected.urls.ledger},
    localnet: {
      distribution: 'splice-localnet',
      'source-profile': sourceProfile,
      version: options.workspace.env.SPLICE_VERSION,
      workspace: options.workspace.root,
    },
    validator: {url: selected.urls.validator},
  }

  if (selected.urls.scan) {
    profile.scan = {url: selected.urls.scan}
  } else {
    warnings.push(`Profile "${sourceProfile}" does not expose a scan endpoint; stable/public checks will be limited.`)
  }

  if (!options.workspace.env.SPLICE_VERSION) {
    warnings.push('Could not infer SPLICE_VERSION from the LocalNet workspace .env files.')
  }

  return {
    name,
    network: {profile: name},
    networkName,
    profile,
    sourceProfile,
    warnings,
    yaml: yaml.dump({
      networks: {
        [networkName]: {profile: name},
      },
      profiles: {
        [name]: profile,
      },
    }, {lineWidth: 120}).trim(),
  }
}

export function mergeLocalnetProfileIntoConfigYaml(options: {
  existingConfigYaml: string
  synthesized: SynthesizedLocalnetProfile
}): string {
  const parsed = (yaml.load(options.existingConfigYaml) as Record<string, unknown> | undefined) ?? {}
  const profiles = isRecord(parsed.profiles) ? parsed.profiles : {}
  const networks = isRecord(parsed.networks) ? parsed.networks : {}

  parsed.profiles = {
    ...profiles,
    [options.synthesized.name]: options.synthesized.profile,
  }
  parsed.networks = {
    ...networks,
    [options.synthesized.networkName]: options.synthesized.network,
  }

  return `${yaml.dump(parsed, {lineWidth: 120}).trim()}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
