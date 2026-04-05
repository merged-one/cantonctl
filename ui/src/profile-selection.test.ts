import {describe, expect, it} from 'vitest'

import {resolveInitialProfileSelection} from './profile-selection'

describe('resolveInitialProfileSelection', () => {
  const session = {
    defaultProfile: 'sandbox',
    profiles: [
      {name: 'sandbox'},
      {name: 'splice-localnet'},
      {name: 'splice-devnet'},
    ],
    requestedProfile: undefined,
  }

  it('prefers the requested profile over stored and default selections', () => {
    expect(resolveInitialProfileSelection({
      ...session,
      requestedProfile: 'splice-devnet',
    }, 'splice-localnet')).toBe('splice-devnet')
  })

  it('falls back to stored and then default profiles when the requested profile is absent', () => {
    expect(resolveInitialProfileSelection(session, 'splice-localnet')).toBe('splice-localnet')
    expect(resolveInitialProfileSelection(session, 'missing')).toBe('sandbox')
  })
})
