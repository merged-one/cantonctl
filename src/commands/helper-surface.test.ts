import {describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {OutputWriter} from '../lib/output.js'
import type {StableSplice} from '../lib/splice-public.js'
import {StableSurfaceCommand} from './stable-surface-command.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

describe('command helper coverage', () => {
  it('covers StableSurfaceCommand helper methods', async () => {
    const out = {result: vi.fn()} as unknown as OutputWriter

    class Harness extends StableSurfaceCommand {
      public async callMaybeLoadProfileContext(options: {needsProfile: boolean; profileName?: string}) {
        return this.maybeLoadProfileContext(options)
      }

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public callHandleCommandError(error: unknown, writer: OutputWriter): never {
        return this.handleCommandError(error, writer)
      }

      public callOutputFor(json: boolean) {
        return this.outputFor(json)
      }

      public async run(): Promise<void> {}

      protected override createStableSplice(): StableSplice {
        return {
          listScanUpdates: vi.fn(),
          transferToken: vi.fn(),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    class BaseHarness extends StableSurfaceCommand {
      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public callCreateStableSplice() {
        return this.createStableSplice()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    await expect(harness.callMaybeLoadProfileContext({needsProfile: false})).resolves.toBeUndefined()
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true}))
      .resolves.toEqual(expect.objectContaining({kind: 'sandbox', name: 'sandbox'}))
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true, profileName: 'splice-devnet'}))
      .resolves.toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    await expect(harness.callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(harness.callOutputFor(true)).toEqual(expect.objectContaining({result: expect.any(Function)}))
    expect(() => harness.callHandleCommandError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND), out))
      .toThrow()
    expect(() => harness.callHandleCommandError(new Error('boom'), out)).toThrow('boom')
    expect(out.result).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))
    await expect(new BaseHarness([], {} as never).callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(new BaseHarness([], {} as never).callCreateStableSplice()).toEqual(expect.objectContaining({
      listScanUpdates: expect.any(Function),
      transferToken: expect.any(Function),
    }))
    loadConfigSpy.mockRestore()
  })
})
