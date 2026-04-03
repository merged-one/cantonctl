import {describe, expect, it, vi} from 'vitest'

import {DerivedCommand, type DerivedOutput, type DerivedResult, type DerivedService} from './derived-command.js'

describe('DerivedCommand coverage repro', () => {
  it('covers json, human, and error paths through instance spies', async () => {
    const jsonOut: DerivedOutput = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
    }
    const humanOut: DerivedOutput = {
      log: vi.fn(),
      result: vi.fn(),
      warn: vi.fn(),
    }
    const successResult: DerivedResult = {
      response: {
        entryContextCid: 'entry-1',
        name: 'alice',
        subscriptionRequestCid: 'sub-1',
      },
      warnings: ['warn-1'],
    }

    const jsonCommand = new DerivedCommand()
    vi.spyOn(jsonCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'base-url': 'https://service.example.com',
        description: 'desc',
        json: true,
        name: 'alice',
        profile: undefined,
        token: 'jwt',
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(jsonCommand as unknown as {outputFor: (json: boolean) => DerivedOutput}, 'outputFor').mockReturnValue(jsonOut)
    vi.spyOn(
      jsonCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(undefined)
    vi.spyOn(jsonCommand as unknown as {createService: () => DerivedService}, 'createService').mockReturnValue({
      createEntry: vi.fn().mockResolvedValue(successResult),
    })
    await jsonCommand.run()

    const humanCommand = new DerivedCommand()
    vi.spyOn(humanCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'base-url': undefined,
        description: 'desc',
        json: false,
        name: 'alice',
        profile: 'profile-a',
        token: undefined,
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(humanCommand as unknown as {outputFor: (json: boolean) => DerivedOutput}, 'outputFor').mockReturnValue(humanOut)
    vi.spyOn(
      humanCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue({name: 'profile-a'})
    vi.spyOn(humanCommand as unknown as {createService: () => DerivedService}, 'createService').mockReturnValue({
      createEntry: vi.fn().mockResolvedValue(successResult),
    })
    await humanCommand.run()

    const error = new Error('boom')
    const failureCommand = new DerivedCommand()
    const handleCommandError = vi.fn()
    vi.spyOn(failureCommand as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'base-url': undefined,
        description: 'desc',
        json: false,
        name: 'alice',
        profile: 'profile-a',
        token: undefined,
        url: 'https://alice.example.com',
      },
    })
    vi.spyOn(failureCommand as unknown as {outputFor: (json: boolean) => DerivedOutput}, 'outputFor').mockReturnValue(humanOut)
    vi.spyOn(
      failureCommand as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue({name: 'profile-a'})
    vi.spyOn(failureCommand as unknown as {createService: () => DerivedService}, 'createService').mockReturnValue({
      createEntry: vi.fn().mockRejectedValue(error),
    })
    vi.spyOn(
      failureCommand as unknown as {handleCommandError: (error: unknown, out: DerivedOutput) => never},
      'handleCommandError',
    ).mockImplementation((caught: unknown) => {
      handleCommandError(caught)
      throw caught as never
    })

    await expect(failureCommand.run()).rejects.toThrow('boom')
    expect(jsonOut.result).toHaveBeenCalledWith({
      data: successResult,
      success: true,
      warnings: ['warn-1'],
    })
    expect(humanOut.log).toHaveBeenCalledWith('Entry: alice')
    expect(humanOut.warn).toHaveBeenCalledWith('warn-1')
    expect(handleCommandError).toHaveBeenCalledWith(error)
  })
})
