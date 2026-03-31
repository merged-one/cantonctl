/**
 * @module repl/completer
 *
 * Tab completion for the Canton console REPL. Completes command names
 * and can optionally complete party names and template IDs loaded
 * from the ledger.
 *
 * @example
 * ```ts
 * const completer = createCompleter({ partyNames: ['Alice', 'Bob'] })
 * const [completions, line] = completer.complete('par')
 * // [['parties'], 'par']
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompleterDeps {
  /** Known party names for completion (loaded from ledger). */
  partyNames?: string[]
}

export interface Completer {
  /** Return completions for a partial input line. */
  complete(line: string): [string[], string]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMANDS = ['help', 'status', 'parties', 'query', 'submit', 'exit']

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a tab completer for the REPL.
 */
export function createCompleter(deps: CompleterDeps = {}): Completer {
  const {partyNames = []} = deps

  return {
    complete(line: string): [string[], string] {
      const trimmed = line.trimStart()
      const tokens = trimmed.split(/\s+/)

      // Complete command name (first token)
      if (tokens.length <= 1) {
        const prefix = tokens[0] ?? ''
        const matches = COMMANDS.filter(c => c.startsWith(prefix.toLowerCase()))
        return [matches, prefix]
      }

      const command = tokens[0].toLowerCase()

      // Complete party names after 'submit'
      if (command === 'submit' && tokens.length === 2) {
        const prefix = tokens[1]
        const matches = partyNames.filter(p => p.toLowerCase().startsWith(prefix.toLowerCase()))
        return [matches, prefix]
      }

      // Complete action after 'submit <party>'
      if (command === 'submit' && tokens.length === 3) {
        const prefix = tokens[2]
        const actions = ['create', 'exercise']
        const matches = actions.filter(a => a.startsWith(prefix.toLowerCase()))
        return [matches, prefix]
      }

      // Complete --party flag for query
      if (command === 'query') {
        const lastToken = tokens[tokens.length - 1]
        if (tokens[tokens.length - 2] === '--party') {
          const matches = partyNames.filter(p => p.toLowerCase().startsWith(lastToken.toLowerCase()))
          return [matches, lastToken]
        }

        if (lastToken.startsWith('--')) {
          const flags = ['--party']
          const matches = flags.filter(f => f.startsWith(lastToken))
          return [matches, lastToken]
        }
      }

      return [[], line]
    },
  }
}
