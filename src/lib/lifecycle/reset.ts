import {resolveNetworkPolicy} from '../preflight/network-policy.js'

export interface ResetChecklistItem {
  severity: 'info' | 'warn'
  text: string
}

export interface ResetChecklistReport {
  checklist: ResetChecklistItem[]
  network: 'devnet' | 'mainnet' | 'testnet'
  resetExpectation: 'no-resets-expected' | 'resets-expected'
}

export interface ResetHelper {
  createChecklist(options: {network: 'devnet' | 'mainnet' | 'testnet'}): ResetChecklistReport
}

export function createResetHelper(): ResetHelper {
  return {
    createChecklist(options) {
      const policy = resolveNetworkPolicy({
        networkName: options.network,
        profile: {kind: 'remote-validator', name: options.network},
      })

      const checklist = policy.checklist.map(text => ({
        severity: policy.resetExpectation === 'no-resets-expected' ? 'info' as const : 'warn' as const,
        text,
      }))

      return {
        checklist,
        network: options.network,
        resetExpectation: policy.resetExpectation === 'no-resets-expected'
          ? 'no-resets-expected'
          : 'resets-expected',
      }
    },
  }
}

