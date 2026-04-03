import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {NormalizedProfile} from '../../src/lib/config.js'
import type {StableSplice} from '../../src/lib/splice-public.js'
import {StableDerivedCommand} from './stable-derived.js'

const CLI_ROOT = process.cwd()

const profile: NormalizedProfile = {
  experimental: false,
  kind: 'remote-validator',
  name: 'repro',
  services: {},
}

describe('StableDerivedCommand mixed execution repro', () => {
  it('covers the json path through static run on a subclass', async () => {
    class TestStableDerived extends StableDerivedCommand {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {name: 'alice'},
            source: 'ans',
            warnings: ['warn-1'],
          }),
        } as unknown as StableSplice
      }

      protected override async maybeLoadProfileContext(): Promise<NormalizedProfile | undefined> {
        return profile
      }
    }

    const result = await captureOutput(() => TestStableDerived.run([
      '--json',
      '--description',
      'desc',
      '--name',
      'alice',
      '--url',
      'https://alice.example.com',
    ], {root: CLI_ROOT}))

    expect(result.error).toBeUndefined()
  })

  it('covers the human path through static run on a subclass', async () => {
    class TestStableDerived extends StableDerivedCommand {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {name: 'alice'},
            source: 'ans',
            warnings: ['warn-1'],
          }),
        } as unknown as StableSplice
      }

      protected override async maybeLoadProfileContext(): Promise<NormalizedProfile | undefined> {
        return profile
      }
    }

    const result = await captureOutput(() => TestStableDerived.run([
      '--description',
      'desc',
      '--name',
      'alice',
      '--url',
      'https://alice.example.com',
    ], {root: CLI_ROOT}))

    expect(result.error).toBeUndefined()
  })

  it('covers the direct instance path with spies', async () => {
    const out = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
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
  })

  it('covers the error path with a spied instance handler', async () => {
    const out = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
    }
    const failure = new Error('boom')
    const handleCommandError = vi.fn()

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
      createAnsEntry: vi.fn().mockRejectedValue(failure),
    } as unknown as StableSplice)
    vi.spyOn(
      command as unknown as {handleCommandError: (error: unknown, out: typeof out) => never},
      'handleCommandError',
    ).mockImplementation((error: unknown) => {
      handleCommandError(error)
      throw error as never
    })

    await expect(command.run()).rejects.toThrow('boom')
    expect(handleCommandError).toHaveBeenCalledWith(failure)
  })
})
