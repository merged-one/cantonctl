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
  })
})
