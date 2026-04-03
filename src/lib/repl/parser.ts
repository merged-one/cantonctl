/**
 * @module repl/parser
 *
 * Command grammar for the Canton console REPL. Parses user input into
 * structured command objects. The grammar is shared with the future
 * `cantonctl exec` command for scripted execution.
 *
 * Supported commands:
 * - `help` — show available commands
 * - `exit` / `quit` — exit the REPL
 * - `status` — show node health and version
 * - `parties` — list provisioned parties
 * - `query [templateId] [--party <party>]` — query active contracts
 * - `submit <party> create <templateId> <payload>` — create a contract
 * - `submit <party> exercise <contractId> <choiceName> <payload>` — exercise a choice
 *
 * @example
 * ```ts
 * const cmd = parseCommand('query MyModule:MyTemplate --party Alice')
 * // { type: 'query', templateId: 'MyModule:MyTemplate', party: 'Alice' }
 * ```
 */

import {CantonctlError, ErrorCode} from '../errors.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplCommand =
  | {type: 'help'}
  | {type: 'exit'}
  | {type: 'status'}
  | {type: 'parties'}
  | {type: 'query'; party?: string; templateId?: string}
  | {type: 'submit'; action: 'create'; party: string; payload: string; templateId: string}
  | {type: 'submit'; action: 'exercise'; choiceName: string; contractId: string; party: string; payload: string}
  | {type: 'unknown'; raw: string}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Parse a REPL input line into a structured command.
 *
 * @param input - Raw user input string
 * @returns Parsed command object
 */
export function parseCommand(input: string): ReplCommand {
  const trimmed = input.trim()
  if (!trimmed) {
    return {raw: '', type: 'unknown'}
  }

  const tokens = tokenize(trimmed)
  const command = tokens[0].toLowerCase()

  switch (command) {
    case 'help':
    case '?':
      return {type: 'help'}

    case 'exit':
    case 'quit':
    case '.exit':
      return {type: 'exit'}

    case 'status':
      return {type: 'status'}

    case 'parties':
      return {type: 'parties'}

    case 'query':
      return parseQuery(tokens.slice(1))

    case 'submit':
      return parseSubmit(tokens.slice(1))

    default:
      return {raw: trimmed, type: 'unknown'}
  }
}

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

function parseQuery(tokens: string[]): ReplCommand {
  let templateId: string | undefined
  let party: string | undefined

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--party' && i + 1 < tokens.length) {
      party = tokens[++i]
    } else if (!templateId) {
      templateId = tokens[i]
    }
  }

  return {party, templateId, type: 'query'}
}

function parseSubmit(tokens: string[]): ReplCommand {
  // submit <party> create <templateId> [payload]
  // submit <party> exercise <contractId> <choiceName> [payload]
  if (tokens.length < 3) {
    throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
      suggestion: 'Usage: submit <party> create <templateId> [payload] OR submit <party> exercise <contractId> <choiceName> [payload]',
    })
  }

  const party = tokens[0]
  const action = tokens[1].toLowerCase()

  if (action === 'create') {
    return {
      action: 'create',
      party,
      payload: tokens.slice(3).join(' ') || '{}',
      templateId: tokens[2],
      type: 'submit',
    }
  }

  if (action === 'exercise') {
    if (tokens.length < 4) {
      throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
        suggestion: 'Usage: submit <party> exercise <contractId> <choiceName> [payload]',
      })
    }

    return {
      action: 'exercise',
      choiceName: tokens[3],
      contractId: tokens[2],
      party,
      payload: tokens.slice(4).join(' ') || '{}',
      type: 'submit',
    }
  }

  throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
    context: {action},
    suggestion: `Unknown submit action "${action}". Use "create" or "exercise".`,
  })
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split input into tokens, respecting quoted strings.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (const char of input) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}
