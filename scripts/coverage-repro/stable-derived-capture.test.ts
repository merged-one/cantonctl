import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {NormalizedProfile} from '../../src/lib/config.js'
import type {StableSplice} from '../../src/lib/splice-public.js'
import {StableDerivedCommand} from './stable-derived.js'

describe('StableDerivedCommand captureOutput repro', () => {
  it('executes the same command path under captureOutput', async () => {
    const out = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
    }
    const profile: NormalizedProfile = {
      experimental: false,
      kind: 'remote-validator',
      name: 'repro',
      services: {},
    }

    const command = new StableDerivedCommand([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        description: 'desc',
        json: false,
        name: 'alice',
        profile: 'repro',
        token: undefined,
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(command as unknown as {outputFor: (json: boolean) => typeof out}, 'outputFor').mockReturnValue(out)
    vi.spyOn(
      command as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(profile)
    vi.spyOn(command as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice').mockReturnValue({
      createAnsEntry: vi.fn().mockResolvedValue({
        endpoint: 'https://ans.example.com',
        response: {name: 'alice'},
        source: 'ans',
        warnings: ['warn-1'],
      }),
    } as unknown as StableSplice)

    const result = await captureOutput(() => command.run())

    expect(result.error).toBeUndefined()
    expect(out.log).toHaveBeenCalledWith('Entry: alice')
    expect(out.warn).toHaveBeenCalledWith('warn-1')
  })
})
