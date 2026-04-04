import {describe, expect, it, vi} from 'vitest'

import {createCollector} from './factory.js'

describe('createCollector coverage repro', () => {
  it('covers present and absent names', async () => {
    const read = vi.fn(async (name: string) => name !== 'missing')
    const write = vi.fn(async () => undefined)
    const collector = createCollector({read, write})

    const result = await collector.collect(['alpha', 'missing', 'beta'])

    expect(result).toEqual(['alpha', 'beta'])
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('returns early when nothing exists', async () => {
    const collector = createCollector({
      read: vi.fn(async () => false),
      write: vi.fn(async () => undefined),
    })

    await expect(collector.collect(['missing'])).resolves.toEqual([])
  })
})
