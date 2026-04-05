import {describe, expect, it} from 'vitest'

import {CantonctlError, ErrorCode} from './errors.js'

describe('ErrorCode', () => {
  it('defines codes for all subsystems', () => {
    // Config
    expect(ErrorCode.CONFIG_NOT_FOUND).toBe('E1001')
    expect(ErrorCode.CONFIG_INVALID_YAML).toBe('E1002')
    expect(ErrorCode.CONFIG_SCHEMA_VIOLATION).toBe('E1003')
    // SDK
    expect(ErrorCode.SDK_NOT_INSTALLED).toBe('E2001')
    // Sandbox
    expect(ErrorCode.SANDBOX_START_FAILED).toBe('E3001')
    // Build
    expect(ErrorCode.BUILD_DAML_ERROR).toBe('E4001')
    // Test
    expect(ErrorCode.TEST_EXECUTION_FAILED).toBe('E5001')
    // Deploy
    expect(ErrorCode.DEPLOY_AUTH_FAILED).toBe('E6001')
    // Ledger
    expect(ErrorCode.LEDGER_CONNECTION_FAILED).toBe('E7001')
  })
})

describe('CantonctlError', () => {
  it('creates error with code and default message', () => {
    const err = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
    expect(err.code).toBe('E1001')
    expect(err.message).toBe('No cantonctl.yaml found in this directory or any parent directory.')
    expect(err.name).toBe('CantonctlError')
    expect(err).toBeInstanceOf(Error)
  })

  it('includes suggestion when provided', () => {
    const err = new CantonctlError(ErrorCode.SDK_NOT_INSTALLED, {
      suggestion: 'Run: curl -sSL https://get.daml.com | sh',
    })
    expect(err.suggestion).toBe('Run: curl -sSL https://get.daml.com | sh')
  })

  it('generates docs URL from error code', () => {
    const err = new CantonctlError(ErrorCode.BUILD_DAML_ERROR)
    expect(err.docsUrl).toBe('https://cantonctl.dev/errors#e4001')
  })

  it('allows custom docs URL override', () => {
    const err = new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {
      docsUrl: 'https://custom.docs/build-errors',
    })
    expect(err.docsUrl).toBe('https://custom.docs/build-errors')
  })

  it('carries structured context', () => {
    const err = new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
      context: {port: 5001, pid: 12345},
    })
    expect(err.context).toEqual({port: 5001, pid: 12345})
  })

  it('preserves cause chain', () => {
    const cause = new Error('EADDRINUSE')
    const err = new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {cause})
    expect(err.cause).toBe(cause)
  })

  describe('format()', () => {
    it('formats error with code and message', () => {
      const err = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
      const formatted = err.format()
      expect(formatted).toContain('Error E1001:')
      expect(formatted).toContain('No cantonctl.yaml found')
      expect(formatted).toContain('Docs: https://cantonctl.dev/errors#e1001')
    })

    it('includes suggestion line when present', () => {
      const err = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" to create a project.',
      })
      const formatted = err.format()
      expect(formatted).toContain('Suggestion: Run "cantonctl init"')
    })

    it('omits suggestion line when empty', () => {
      const err = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
      const formatted = err.format()
      expect(formatted).not.toContain('Suggestion:')
    })
  })

  describe('toJSON()', () => {
    it('serializes all fields', () => {
      const err = new CantonctlError(ErrorCode.DEPLOY_UPLOAD_FAILED, {
        context: {darPath: '/app.dar'},
        suggestion: 'Check package version.',
      })
      const json = err.toJSON()
      expect(json).toEqual({
        code: 'E6003',
        context: {darPath: '/app.dar'},
        docsUrl: 'https://cantonctl.dev/errors#e6003',
        message: 'DAR upload was rejected by the participant.',
        suggestion: 'Check package version.',
      })
    })

    it('omits empty optional fields', () => {
      const err = new CantonctlError(ErrorCode.TEST_EXECUTION_FAILED)
      const json = err.toJSON()
      expect(json.suggestion).toBeUndefined()
      expect(json.context).toBeUndefined()
    })
  })
})
