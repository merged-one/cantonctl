import type {CantonctlConfig} from '../config.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'

export type SdkConfigTarget = 'dapp-api' | 'dapp-sdk' | 'wallet-sdk'

export interface ExportedSdkConfig {
  auth: {
    envVarName: string
    mode: string
    tokenPlaceholder: string
  }
  cip: 'CIP-0103'
  endpoints: {
    authUrl?: string
    dappApiUrl?: string
    ledgerUrl?: string
    scanUrl?: string
    tokenStandardUrl?: string
    validatorUrl?: string
    walletGatewayUrl?: string
  }
  notes: string[]
  profile: {
    kind: string
    name: string
    network: string
  }
  target: SdkConfigTarget
}

export interface SdkConfigExporter {
  exportConfig(options: {
    config: CantonctlConfig
    profileName?: string
    target: SdkConfigTarget
  }): Promise<ExportedSdkConfig>
}

export function createSdkConfigExporter(
  deps: {
    createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  } = {},
): SdkConfigExporter {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())

  return {
    async exportConfig(options) {
      const runtime = await resolveRuntime().resolve({
        config: options.config,
        profileName: options.profileName,
      })

      return {
        auth: {
          envVarName: runtime.auth.envVarName,
          mode: runtime.auth.mode,
          tokenPlaceholder: `\${${runtime.auth.envVarName}}`,
        },
        cip: 'CIP-0103',
        endpoints: {
          authUrl: runtime.profile.services.auth?.url ?? runtime.profile.services.auth?.issuer,
          dappApiUrl: options.target === 'dapp-api' || options.target === 'dapp-sdk'
            ? runtime.profile.services.validator?.url
            : undefined,
          ledgerUrl: runtime.profile.services.ledger?.url,
          scanUrl: runtime.profile.services.scan?.url,
          tokenStandardUrl: runtime.profile.services.tokenStandard?.url,
          validatorUrl: options.target === 'wallet-sdk' ? runtime.profile.services.validator?.url : undefined,
          walletGatewayUrl: options.target === 'dapp-sdk' ? runtime.profile.services.validator?.url : undefined,
        },
        notes: buildNotes(options.target),
        profile: {
          kind: runtime.profile.kind,
          name: runtime.profile.name,
          network: runtime.networkName,
        },
        target: options.target,
      }
    },
  }
}

function buildNotes(target: SdkConfigTarget): string[] {
  switch (target) {
    case 'dapp-sdk':
      return [
        'Use this export as a wiring helper for the official dApp SDK.',
        'Replace wallet-gateway placeholders if your deployment splits them from validator endpoints.',
      ]
    case 'dapp-api':
      return [
        'Use this export as a wiring helper for the official dApp API or Wallet Gateway.',
        'Replace dApp API placeholders if your deployment exposes a dedicated gateway URL.',
      ]
    case 'wallet-sdk':
      return [
        'Use this export as a wiring helper for the official Wallet SDK.',
        'cantonctl exports config only; it does not replace Wallet SDK runtime behavior.',
      ]
  }
}

