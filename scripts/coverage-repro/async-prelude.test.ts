import {describe, expect, it, vi} from 'vitest'

import {AsyncPreludeCommand, type ReproOutput} from './async-prelude.js'

describe('AsyncPreludeCommand coverage repro', () => {
  it('executes the async prelude through instance spies', async () => {
    const out: ReproOutput = {
      result: vi.fn(),
      warn: vi.fn(),
    }

    const command = new AsyncPreludeCommand()
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {json: true},
    })
    vi.spyOn(command as unknown as {outputFor: (json: boolean) => ReproOutput}, 'outputFor').mockReturnValue(out)
    vi.spyOn(
      command as unknown as {doWork: () => Promise<{warnings: string[]}>},
      'doWork',
    ).mockResolvedValue({warnings: ['from-work']})

    await command.run()

    expect(out.result).toHaveBeenCalledWith({success: true, warnings: ['from-work']})
  })
})
