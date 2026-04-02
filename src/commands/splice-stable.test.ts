import {captureOutput} from '@oclif/test'
import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import type {StableSplice} from '../lib/splice-public.js'
import AnsCreate from './ans/create.js'
import ScanUpdates from './scan/updates.js'
import TokenHoldings from './token/holdings.js'
import ValidatorTrafficStatus from './validator/traffic-status.js'

const CLI_ROOT = process.cwd()

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com/api/validator'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

describe('stable splice command surface', () => {
  it('emits scan update history in json mode', async () => {
    class TestScanUpdates extends ScanUpdates {
      protected override createStableSplice(): StableSplice {
        return {
          listScanUpdates: async () => ({
            endpoint: 'https://scan.example.com',
            source: 'scan',
            updates: [{kind: 'transaction', recordTime: '2026-04-02T20:00:00Z', updateId: 'update-1'}],
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanUpdates.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: 'https://scan.example.com',
      source: 'scan',
      updates: [{kind: 'transaction', recordTime: '2026-04-02T20:00:00Z', updateId: 'update-1'}],
    }))
  })

  it('emits token holdings in json mode', async () => {
    class TestTokenHoldings extends TokenHoldings {
      protected override createStableSplice(): StableSplice {
        return {
          listTokenHoldings: async () => ({
            endpoint: 'https://ledger.example.com',
            holdings: [{
              amount: '5.0000000000',
              contractId: 'holding-1',
              instrumentId: {admin: 'Registry', id: 'USD'},
              owner: 'Alice',
            }],
            interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTokenHoldings.run([
      '--json',
      '--party',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      holdings: [
        expect.objectContaining({
          amount: '5.0000000000',
          contractId: 'holding-1',
          owner: 'Alice',
        }),
      ],
      interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    }))
  })

  it('emits ans create results in json mode', async () => {
    class TestAnsCreate extends AnsCreate {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {
              entryContextCid: 'entry-context-1',
              subscriptionRequestCid: 'subscription-1',
            },
            source: 'ans',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAnsCreate.run([
      '--json',
      '--description',
      'Alice profile',
      '--name',
      'alice.unverified.ans',
      '--token',
      'jwt-token',
      '--url',
      'https://alice.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      response: expect.objectContaining({
        entryContextCid: 'entry-context-1',
        subscriptionRequestCid: 'subscription-1',
      }),
      source: 'ans',
    }))
  })

  it('emits validator traffic status in json mode', async () => {
    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            source: 'validator-user',
            status: {status: 'completed', transaction_id: 'tx-traffic-1'},
            trackingId: 'traffic-1',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficStatus.run([
      '--json',
      '--token',
      'jwt-token',
      '--tracking-id',
      'traffic-1',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      source: 'validator-user',
      status: {
        status: 'completed',
        transaction_id: 'tx-traffic-1',
      },
      trackingId: 'traffic-1',
    }))
  })
})
