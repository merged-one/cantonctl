import {describe, expect, it, vi} from 'vitest'

import type {NormalizedProfile} from '../../src/lib/config.js'
import type {StableSplice} from '../../src/lib/splice-public.js'
import {StableDerivedCommand} from './stable-derived.js'

describe('StableDerivedCommand coverage repro', () => {
  it('covers json, human, and error paths through instance spies', async () => {
    const jsonOut = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
    }
    const humanOut = {
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

    const jsonCommand = new StableDerivedCommand([], {} as never)
    vi.spyOn(jsonCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        description: 'desc',
        json: true,
        name: 'alice',
        profile: 'repro',
        token: 'jwt',
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(jsonCommand as unknown as {outputFor: (json: boolean) => typeof jsonOut}, 'outputFor').mockReturnValue(jsonOut)
    vi.spyOn(
      jsonCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(profile)
    vi.spyOn(jsonCommand as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice').mockReturnValue({
      createAnsEntry: vi.fn().mockResolvedValue({
        endpoint: 'https://ans.example.com',
        response: {name: 'alice'},
        source: 'ans',
        warnings: ['warn-1'],
      }),
    } as unknown as StableSplice)
    await jsonCommand.run()

    const humanCommand = new StableDerivedCommand([], {} as never)
    vi.spyOn(humanCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        description: 'desc',
        json: false,
        name: 'alice',
        profile: 'repro',
        token: undefined,
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(humanCommand as unknown as {outputFor: (json: boolean) => typeof humanOut}, 'outputFor').mockReturnValue(humanOut)
    vi.spyOn(
      humanCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(profile)
    vi.spyOn(humanCommand as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice').mockReturnValue({
      createAnsEntry: vi.fn().mockResolvedValue({
        endpoint: 'https://ans.example.com',
        response: {name: 'alice'},
        source: 'ans',
        warnings: ['warn-1'],
      }),
    } as unknown as StableSplice)
    await humanCommand.run()

    const failure = new Error('boom')
    const failureCommand = new StableDerivedCommand([], {} as never)
    const handleCommandError = vi.fn()
    vi.spyOn(failureCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        description: 'desc',
        json: false,
        name: 'alice',
        profile: 'repro',
        token: undefined,
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(failureCommand as unknown as {outputFor: (json: boolean) => typeof humanOut}, 'outputFor').mockReturnValue(humanOut)
    vi.spyOn(
      failureCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(profile)
    vi.spyOn(failureCommand as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice').mockReturnValue({
      createAnsEntry: vi.fn().mockRejectedValue(failure),
    } as unknown as StableSplice)
    vi.spyOn(
      failureCommand as unknown as {handleCommandError: (error: unknown, out: typeof humanOut) => never},
      'handleCommandError',
    ).mockImplementation((error: unknown) => {
      handleCommandError(error)
      throw error as never
    })

    await expect(failureCommand.run()).rejects.toThrow('boom')
    expect(jsonOut.result).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      warnings: ['warn-1'],
    }))
    expect(humanOut.log).toHaveBeenCalledWith('Entry: alice')
    expect(humanOut.warn).toHaveBeenCalledWith('warn-1')
    expect(handleCommandError).toHaveBeenCalledWith(failure)
  })
})
