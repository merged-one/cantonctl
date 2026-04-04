import {describe, expect, it} from 'vitest'

import {CantonctlError, ErrorCode} from '../errors.js'
import {parseCommand, tokenize} from './parser.js'

// ---------------------------------------------------------------------------
// Tokenizer tests
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world'])
  })

  it('handles multiple spaces', () => {
    expect(tokenize('hello   world')).toEqual(['hello', 'world'])
  })

  it('handles tabs', () => {
    expect(tokenize('hello\tworld')).toEqual(['hello', 'world'])
  })

  it('respects double quotes', () => {
    expect(tokenize('submit Alice create "My:Template"')).toEqual(['submit', 'Alice', 'create', 'My:Template'])
  })

  it('respects single quotes', () => {
    expect(tokenize("query 'My:Template'")).toEqual(['query', 'My:Template'])
  })

  it('handles quoted strings with spaces', () => {
    expect(tokenize('submit Alice create Template "{ field: 1 }"')).toEqual(
      ['submit', 'Alice', 'create', 'Template', '{ field: 1 }'],
    )
  })

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('parseCommand', () => {
  describe('simple commands', () => {
    it('parses help', () => {
      expect(parseCommand('help')).toEqual({type: 'help'})
    })

    it('parses ? as help', () => {
      expect(parseCommand('?')).toEqual({type: 'help'})
    })

    it('parses exit', () => {
      expect(parseCommand('exit')).toEqual({type: 'exit'})
    })

    it('parses quit as exit', () => {
      expect(parseCommand('quit')).toEqual({type: 'exit'})
    })

    it('parses .exit as exit', () => {
      expect(parseCommand('.exit')).toEqual({type: 'exit'})
    })

    it('parses status', () => {
      expect(parseCommand('status')).toEqual({type: 'status'})
    })

    it('parses parties', () => {
      expect(parseCommand('parties')).toEqual({type: 'parties'})
    })

    it('is case-insensitive for commands', () => {
      expect(parseCommand('HELP')).toEqual({type: 'help'})
      expect(parseCommand('Status')).toEqual({type: 'status'})
    })

    it('trims whitespace', () => {
      expect(parseCommand('  help  ')).toEqual({type: 'help'})
    })

    it('returns unknown for empty input', () => {
      expect(parseCommand('')).toEqual({raw: '', type: 'unknown'})
      expect(parseCommand('   ')).toEqual({raw: '', type: 'unknown'})
    })

    it('returns unknown for unrecognized commands', () => {
      expect(parseCommand('foobar')).toEqual({raw: 'foobar', type: 'unknown'})
    })
  })

  describe('query command', () => {
    it('parses bare query', () => {
      expect(parseCommand('query')).toEqual({
        party: undefined,
        templateId: undefined,
        type: 'query',
      })
    })

    it('parses query with template ID', () => {
      expect(parseCommand('query MyModule:MyTemplate')).toEqual({
        party: undefined,
        templateId: 'MyModule:MyTemplate',
        type: 'query',
      })
    })

    it('parses query with --party flag', () => {
      expect(parseCommand('query --party Alice')).toEqual({
        party: 'Alice',
        templateId: undefined,
        type: 'query',
      })
    })

    it('parses query with template and --party', () => {
      expect(parseCommand('query MyModule:MyTemplate --party Alice')).toEqual({
        party: 'Alice',
        templateId: 'MyModule:MyTemplate',
        type: 'query',
      })
    })

    it('ignores extra positional tokens after the template id', () => {
      expect(parseCommand('query MyModule:MyTemplate ignored --party Alice')).toEqual({
        party: 'Alice',
        templateId: 'MyModule:MyTemplate',
        type: 'query',
      })
    })
  })

  describe('submit create command', () => {
    it('parses submit create with template', () => {
      const result = parseCommand('submit Alice create MyModule:MyTemplate')
      expect(result).toEqual({
        action: 'create',
        party: 'Alice',
        payload: '{}',
        templateId: 'MyModule:MyTemplate',
        type: 'submit',
      })
    })

    it('parses submit create with payload', () => {
      // Use single-quoted JSON to avoid the tokenizer stripping double quotes
      const result = parseCommand("submit Alice create MyModule:MyTemplate '{\"field\":1}'")
      expect(result).toEqual({
        action: 'create',
        party: 'Alice',
        payload: '{"field":1}',
        templateId: 'MyModule:MyTemplate',
        type: 'submit',
      })
    })
  })

  describe('submit exercise command', () => {
    it('parses submit exercise', () => {
      const result = parseCommand('submit Alice exercise contract123 MyChoice')
      expect(result).toEqual({
        action: 'exercise',
        choiceName: 'MyChoice',
        contractId: 'contract123',
        party: 'Alice',
        payload: '{}',
        type: 'submit',
      })
    })

    it('parses submit exercise with payload', () => {
      const result = parseCommand("submit Alice exercise contract123 MyChoice '{\"arg\":1}'")
      expect(result).toEqual({
        action: 'exercise',
        choiceName: 'MyChoice',
        contractId: 'contract123',
        party: 'Alice',
        payload: '{"arg":1}',
        type: 'submit',
      })
    })
  })

  describe('submit errors', () => {
    it('throws CONSOLE_PARSE_ERROR for insufficient tokens', () => {
      expect(() => parseCommand('submit Alice')).toThrow(CantonctlError)
      try {
        parseCommand('submit Alice')
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.CONSOLE_PARSE_ERROR)
      }
    })

    it('throws CONSOLE_PARSE_ERROR for create with too few args', () => {
      expect(() => parseCommand('submit Alice create')).toThrow(CantonctlError)
    })

    it('throws CONSOLE_PARSE_ERROR for unknown action', () => {
      expect(() => parseCommand('submit Alice unknown Template')).toThrow(CantonctlError)
      try {
        parseCommand('submit Alice unknown Template')
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.CONSOLE_PARSE_ERROR)
      }
    })

    it('throws CONSOLE_PARSE_ERROR for exercise with too few args', () => {
      expect(() => parseCommand('submit Alice exercise contract123')).toThrow(CantonctlError)
    })
  })
})
