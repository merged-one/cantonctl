import {describe, expect, it} from 'vitest'

import initHook from './init.js'
import prerunHook from './prerun.js'

describe('oclif hooks', () => {
  it('init hook is a no-op and resolves cleanly', async () => {
    await expect(initHook.call({} as never, {} as never)).resolves.toBeUndefined()
  })

  it('prerun hook is a no-op and resolves cleanly', async () => {
    await expect(prerunHook.call({} as never, {} as never)).resolves.toBeUndefined()
  })
})
