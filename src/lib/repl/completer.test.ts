import {describe, expect, it} from 'vitest'

import {createCompleter} from './completer.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Completer', () => {
  describe('command completion', () => {
    it('completes partial command names', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('he')
      expect(matches).toEqual(['help'])
    })

    it('returns all commands for empty input', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('')
      expect(matches).toEqual(['help', 'status', 'parties', 'query', 'submit', 'exit'])
    })

    it('returns multiple matches', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('s')
      expect(matches).toEqual(['status', 'submit'])
    })

    it('returns empty for no match', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('xyz')
      expect(matches).toEqual([])
    })

    it('handles whitespace-only input like an empty prefix', () => {
      const completer = createCompleter()
      const [matches, prefix] = completer.complete('   ')
      expect(prefix).toBe('')
      expect(matches).toEqual(['help', 'status', 'parties', 'query', 'submit', 'exit'])
    })
  })

  describe('party completion after submit', () => {
    it('completes party names', () => {
      const completer = createCompleter({partyNames: ['Alice', 'Bob', 'Admin']})
      const [matches] = completer.complete('submit A')
      expect(matches).toEqual(['Alice', 'Admin'])
    })

    it('returns empty when no parties match', () => {
      const completer = createCompleter({partyNames: ['Alice']})
      const [matches] = completer.complete('submit Z')
      expect(matches).toEqual([])
    })
  })

  describe('action completion after submit <party>', () => {
    it('completes create and exercise', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('submit Alice c')
      expect(matches).toEqual(['create'])
    })

    it('completes exercise', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('submit Alice e')
      expect(matches).toEqual(['exercise'])
    })
  })

  describe('query flag completion', () => {
    it('completes --party flag', () => {
      const completer = createCompleter()
      const [matches] = completer.complete('query Template --')
      expect(matches).toEqual(['--party'])
    })

    it('completes party name after --party', () => {
      const completer = createCompleter({partyNames: ['Alice', 'Bob']})
      const [matches] = completer.complete('query Template --party A')
      expect(matches).toEqual(['Alice'])
    })

    it('returns no completions for non-query trailing tokens that do not match a query flag shape', () => {
      const completer = createCompleter({partyNames: ['Alice', 'Bob']})
      const [matches] = completer.complete('status extra')
      expect(matches).toEqual([])
    })

    it('returns no completions for query arguments that are neither flags nor party completions', () => {
      const completer = createCompleter({partyNames: ['Alice', 'Bob']})
      const [matches, line] = completer.complete('query Template literal')
      expect(matches).toEqual([])
      expect(line).toBe('query Template literal')
    })
  })
})
