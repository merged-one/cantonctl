import type {NormalizedProfile} from '../config-profile.js'

export type CompanionNetworkTier = 'custom' | 'devnet' | 'local' | 'mainnet' | 'testnet'

export interface NetworkPolicy {
  checklist: string[]
  displayName: string
  reminders: string[]
  resetExpectation: 'local-only' | 'no-resets-expected' | 'resets-expected' | 'unknown'
  tier: CompanionNetworkTier
}

export function resolveNetworkPolicy(options: {
  networkName: string
  profile: Pick<NormalizedProfile, 'kind' | 'name'>
}): NetworkPolicy {
  const tier = classifyNetworkTier(options.networkName, options.profile.kind)

  switch (tier) {
    case 'local':
      return {
        checklist: [
          'Use the official LocalNet workspace or sandbox lifecycle as the source of truth.',
          'Treat fallback tokens and local shared secrets as throwaway local-only material.',
        ],
        displayName: 'Local development',
        reminders: [
          'This profile is local. Preflight is advisory only and does not replace DPM or LocalNet startup checks.',
        ],
        resetExpectation: 'local-only',
        tier,
      }

    case 'devnet':
      return {
        checklist: [
          'Confirm deploy-host egress IPs are allowlisted before rollout.',
          'Expect resets and upgrade churn; verify migration-sensitive state after every reset.',
          'Reconfirm onboarding secrets and sponsor-owned inputs before promotion.',
        ],
        displayName: 'DevNet',
        reminders: [
          'DevNet resets happen. Treat migration IDs, balances, and onboarding state as disposable.',
        ],
        resetExpectation: 'resets-expected',
        tier,
      }

    case 'testnet':
      return {
        checklist: [
          'Confirm deploy-host egress IPs are allowlisted before rollout.',
          'Carry reset-aware runbooks and verify migration-sensitive state after upgrades.',
          'Reconfirm onboarding secrets, sponsor inputs, and validator allowlisting before promotion.',
        ],
        displayName: 'TestNet',
        reminders: [
          'TestNet may reset. Capture migration-sensitive assumptions in release notes before promotion.',
        ],
        resetExpectation: 'resets-expected',
        tier,
      }

    case 'mainnet':
      return {
        checklist: [
          'Confirm deploy-host egress IPs are allowlisted before rollout.',
          'Take backups and verify production auth material before any upgrade.',
          'Treat sponsor inputs, migration expectations, and validator connectivity as release gates.',
        ],
        displayName: 'MainNet',
        reminders: [
          'MainNet is expected not to reset. Investigate any migration-id discontinuity before rollout.',
        ],
        resetExpectation: 'no-resets-expected',
        tier,
      }

    case 'custom':
      return {
        checklist: [
          'Confirm remote auth material and allowlisting with the target operator.',
          'Verify scan reachability and any environment-specific upgrade or reset policy.',
        ],
        displayName: options.networkName,
        reminders: [
          'Custom remote environment. Confirm operator runbooks out-of-band before promotion.',
        ],
        resetExpectation: 'unknown',
        tier,
      }
  }
}

export function classifyNetworkTier(
  networkName: string,
  profileKind: NormalizedProfile['kind'],
): CompanionNetworkTier {
  const name = networkName.toLowerCase()

  if (
    profileKind === 'sandbox'
    || profileKind === 'canton-multi'
    || profileKind === 'splice-localnet'
    || name.includes('sandbox')
    || name.includes('localnet')
    || name === 'local'
  ) {
    return 'local'
  }

  if (name.includes('mainnet')) return 'mainnet'
  if (name.includes('testnet')) return 'testnet'
  if (name.includes('devnet')) return 'devnet'
  return 'custom'
}

