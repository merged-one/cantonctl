import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {createOutput} from './output.js'

describe('OutputWriter', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>
  let stderrWrite: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('human mode', () => {
    const out = createOutput({json: false, noColor: true})

    it('log() writes to stdout', () => {
      out.log('hello')
      expect(stdoutWrite).toHaveBeenCalledWith('hello\n')
    })

    it('success() writes checkmark to stdout', () => {
      out.success('done')
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('✓'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('done'))
    })

    it('error() writes to stderr', () => {
      out.error('bad thing')
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Error:'))
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('bad thing'))
    })

    it('warn() writes to stderr', () => {
      out.warn('careful')
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Warning:'))
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('careful'))
    })

    it('info() writes dim text', () => {
      out.info('note')
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('note'))
    })

    it('table() renders cli-table3 output', () => {
      out.table(['Name', 'Role'], [['Alice', 'operator'], ['Bob', 'participant']])
      const output = (stdoutWrite.mock.calls[0] as string[])[0]
      expect(output).toContain('Alice')
      expect(output).toContain('Bob')
      expect(output).toContain('Name')
    })

    it('result() with success shows data', () => {
      out.result({data: 'Package uploaded', success: true})
      expect(stdoutWrite).toHaveBeenCalledWith('Package uploaded\n')
    })

    it('result() with error shows error on stderr', () => {
      out.result({
        error: {code: 'E4001', message: 'Build failed', suggestion: 'Check syntax'},
        success: false,
      })
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('E4001'))
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Check syntax'))
    })

    it('result() shows timing when present', () => {
      out.result({success: true, timing: {durationMs: 1234}})
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('1.2s'))
    })

    it('result() shows warnings', () => {
      out.result({success: true, warnings: ['Deprecated feature used']})
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Warning:'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Deprecated'))
    })
  })

  describe('JSON mode', () => {
    const out = createOutput({json: true})

    it('result() outputs JSON to stdout', () => {
      out.result({data: {packageId: 'abc123'}, success: true})
      const written = (stdoutWrite.mock.calls[0] as string[])[0]
      const parsed = JSON.parse(written)
      expect(parsed).toEqual({data: {packageId: 'abc123'}, success: true})
    })

    it('log() is suppressed', () => {
      out.log('should not appear')
      expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it('success() is suppressed', () => {
      out.success('should not appear')
      expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it('error() is suppressed', () => {
      out.error('should not appear')
      expect(stderrWrite).not.toHaveBeenCalled()
    })

    it('table() outputs JSON array', () => {
      out.table(['Name', 'Role'], [['Alice', 'operator']])
      const written = (stdoutWrite.mock.calls[0] as string[])[0]
      const parsed = JSON.parse(written)
      expect(parsed).toEqual([{Name: 'Alice', Role: 'operator'}])
    })
  })

  describe('quiet mode', () => {
    const out = createOutput({noColor: true, quiet: true})

    it('suppresses log', () => {
      out.log('hidden')
      expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it('suppresses success', () => {
      out.success('hidden')
      expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it('suppresses info', () => {
      out.info('hidden')
      expect(stdoutWrite).not.toHaveBeenCalled()
    })

    it('suppresses table', () => {
      out.table(['H'], [['v']])
      expect(stdoutWrite).not.toHaveBeenCalled()
    })
  })

  describe('spinner', () => {
    it('returns a spinner in human mode', () => {
      const out = createOutput({json: false, noColor: true})
      const spinner = out.spinner('Loading...')
      expect(spinner).toBeDefined()
      expect(spinner.text).toBe('Loading...')
      spinner.stop()
    })

    it('returns disabled spinner in json mode', () => {
      const out = createOutput({json: true})
      const spinner = out.spinner('Loading...')
      expect(spinner).toBeDefined()
      spinner.stop() // Should not throw
    })

    it('returns disabled spinner in quiet mode', () => {
      const out = createOutput({noColor: true, quiet: true})
      const spinner = out.spinner('Loading...')
      expect(spinner).toBeDefined()
      spinner.stop()
    })
  })

  describe('result() edge cases', () => {
    it('pretty-prints object data in human mode', () => {
      const out = createOutput({json: false, noColor: true})
      out.result({data: {id: 'abc', name: 'test'}, success: true})
      const output = (stdoutWrite.mock.calls[0] as string[])[0]
      expect(output).toContain('"id"')
      expect(output).toContain('"abc"')
    })
  })
})
