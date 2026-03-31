/**
 * @module repl/executor
 *
 * Dispatches parsed REPL commands to the Canton Ledger API via LedgerClient.
 * Each command handler formats output through the OutputWriter for consistent
 * human/JSON rendering.
 *
 * @example
 * ```ts
 * const executor = createExecutor({ client, output })
 * const cmd = parseCommand('parties')
 * const shouldContinue = await executor.execute(cmd)
 * ```
 */

import {CantonctlError, ErrorCode} from '../errors.js'
import type {LedgerClient} from '../ledger-client.js'
import type {OutputWriter} from '../output.js'
import type {ReplCommand} from './parser.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutorDeps {
  /** Ledger API client. */
  client: LedgerClient
  /** Output writer for rendering results. */
  output: OutputWriter
  /** Default party for queries. */
  defaultParty?: string
}

export interface Executor {
  /**
   * Execute a parsed REPL command.
   * @returns `true` to continue the REPL loop, `false` to exit.
   */
  execute(cmd: ReplCommand): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `Available commands:
  help                                      Show this help message
  status                                    Show node health and version
  parties                                   List provisioned parties
  query [templateId] [--party <party>]      Query active contracts
  submit <party> create <templateId> [payload]
                                            Create a contract
  submit <party> exercise <contractId> <choiceName> [payload]
                                            Exercise a contract choice
  exit                                      Exit the console`

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an Executor that dispatches REPL commands to the Ledger API.
 */
export function createExecutor(deps: ExecutorDeps): Executor {
  const {client, defaultParty, output} = deps

  return {
    async execute(cmd: ReplCommand): Promise<boolean> {
      switch (cmd.type) {
        case 'help':
          output.log(HELP_TEXT)
          return true

        case 'exit':
          output.info('Goodbye.')
          return false

        case 'status':
          return executeStatus()

        case 'parties':
          return executeParties()

        case 'query':
          return executeQuery(cmd.templateId, cmd.party)

        case 'submit':
          if (cmd.action === 'create') {
            return executeSubmitCreate(cmd.party, cmd.templateId, cmd.payload)
          }

          return executeSubmitExercise(cmd.party, cmd.contractId, cmd.choiceName, cmd.payload)

        case 'unknown':
          if (cmd.raw) {
            throw new CantonctlError(ErrorCode.CONSOLE_UNKNOWN_COMMAND, {
              context: {input: cmd.raw},
              suggestion: `Unknown command "${cmd.raw}". Type "help" for available commands.`,
            })
          }

          return true
      }
    },
  }

  async function executeStatus(): Promise<boolean> {
    const version = await client.getVersion()
    output.success(`Node healthy (v${version.version})`)
    return true
  }

  async function executeParties(): Promise<boolean> {
    const {partyDetails} = await client.getParties()
    if (partyDetails.length === 0) {
      output.info('No parties found')
    } else {
      output.table(
        ['Party', 'ID', 'Local'],
        partyDetails.map(p => [
          String(p.displayName ?? ''),
          String(p.identifier ?? ''),
          String(p.isLocal ?? ''),
        ]),
      )
    }

    return true
  }

  async function executeQuery(templateId?: string, party?: string): Promise<boolean> {
    const queryParty = party ?? defaultParty
    if (!queryParty) {
      throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
        suggestion: 'Specify a party with --party or set a default party in cantonctl.yaml.',
      })
    }

    const templateIds = templateId ? [templateId] : undefined
    const {activeContracts} = await client.getActiveContracts({
      filter: {party: queryParty, templateIds},
    })

    if (activeContracts.length === 0) {
      output.info('No active contracts found')
    } else {
      output.log(`Found ${activeContracts.length} active contract(s):`)
      for (const contract of activeContracts) {
        output.log(JSON.stringify(contract, null, 2))
      }
    }

    return true
  }

  async function executeSubmitCreate(party: string, templateId: string, payload: string): Promise<boolean> {
    let parsedPayload: Record<string, unknown>
    try {
      parsedPayload = JSON.parse(payload) as Record<string, unknown>
    } catch {
      throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
        suggestion: 'Invalid JSON payload. Use valid JSON, e.g. {"field": "value"}.',
      })
    }

    const commandId = `cantonctl-${Date.now()}`
    const result = await client.submitAndWait({
      actAs: [party],
      commandId,
      commands: [{
        CreateCommand: {
          payload: parsedPayload,
          templateId,
        },
      }],
    })

    output.success('Contract created')
    output.log(JSON.stringify(result.transaction, null, 2))
    return true
  }

  async function executeSubmitExercise(party: string, contractId: string, choiceName: string, payload: string): Promise<boolean> {
    let parsedPayload: Record<string, unknown>
    try {
      parsedPayload = JSON.parse(payload) as Record<string, unknown>
    } catch {
      throw new CantonctlError(ErrorCode.CONSOLE_PARSE_ERROR, {
        suggestion: 'Invalid JSON payload. Use valid JSON, e.g. {"field": "value"}.',
      })
    }

    const commandId = `cantonctl-${Date.now()}`
    const result = await client.submitAndWait({
      actAs: [party],
      commandId,
      commands: [{
        ExerciseCommand: {
          argument: parsedPayload,
          choiceName,
          contractId,
        },
      }],
    })

    output.success('Choice exercised')
    output.log(JSON.stringify(result.transaction, null, 2))
    return true
  }
}
