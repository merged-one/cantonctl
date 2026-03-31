import {describe, expect, it} from 'vitest'

import {createSandboxToken, decodeSandboxToken} from './jwt.js'

describe('JWT generation', () => {
  describe('createSandboxToken()', () => {
    it('generates a valid HS256 JWT for a single party', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        applicationId: 'cantonctl',
        readAs: ['Alice::1234'],
      })
      expect(typeof token).toBe('string')
      // JWT has 3 dot-separated parts
      expect(token.split('.')).toHaveLength(3)
    })

    it('generates a token with multiple actAs/readAs parties', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234', 'Bob::5678'],
        applicationId: 'cantonctl',
        readAs: ['Alice::1234', 'Bob::5678', 'Public'],
      })
      const decoded = await decodeSandboxToken(token)
      expect(decoded.actAs).toEqual(['Alice::1234', 'Bob::5678'])
      expect(decoded.readAs).toEqual(['Alice::1234', 'Bob::5678', 'Public'])
    })

    it('includes admin claim when specified', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: [],
      })
      const decoded = await decodeSandboxToken(token)
      expect(decoded.admin).toBe(true)
    })

    it('sets default expiry of 24 hours', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        applicationId: 'cantonctl',
        readAs: [],
      })
      const decoded = await decodeSandboxToken(token)
      expect(decoded.exp).toBeDefined()
      // Expiry should be ~24h from now (allow 5s tolerance)
      const expectedExp = Math.floor(Date.now() / 1000) + 24 * 60 * 60
      expect(Math.abs(decoded.exp! - expectedExp)).toBeLessThan(5)
    })

    it('accepts custom expiry', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        applicationId: 'cantonctl',
        expiresInSeconds: 3600,
        readAs: [],
      })
      const decoded = await decodeSandboxToken(token)
      const expectedExp = Math.floor(Date.now() / 1000) + 3600
      expect(Math.abs(decoded.exp! - expectedExp)).toBeLessThan(5)
    })

    it('sets the correct ledger API audience', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        applicationId: 'cantonctl',
        ledgerId: 'sandbox',
        readAs: [],
      })
      const decoded = await decodeSandboxToken(token)
      expect(decoded.ledgerId).toBe('sandbox')
    })

    it('uses a well-known sandbox secret for local development', async () => {
      // Canton sandbox decodes but does not validate JWTs.
      // We use a well-known secret so tokens are deterministic for testing.
      const token1 = await createSandboxToken({
        actAs: ['Alice::1234'],
        applicationId: 'cantonctl',
        readAs: [],
      })
      // Token should be decodable with the same secret
      const decoded = await decodeSandboxToken(token1)
      expect(decoded.applicationId).toBe('cantonctl')
    })
  })

  describe('decodeSandboxToken()', () => {
    it('round-trips a generated token', async () => {
      const token = await createSandboxToken({
        actAs: ['Alice::1234'],
        admin: true,
        applicationId: 'my-app',
        readAs: ['Alice::1234', 'Public'],
      })
      const decoded = await decodeSandboxToken(token)
      expect(decoded.actAs).toEqual(['Alice::1234'])
      expect(decoded.readAs).toEqual(['Alice::1234', 'Public'])
      expect(decoded.admin).toBe(true)
      expect(decoded.applicationId).toBe('my-app')
    })

    it('throws on invalid token', async () => {
      await expect(decodeSandboxToken('not.a.jwt')).rejects.toThrow()
    })
  })
})
