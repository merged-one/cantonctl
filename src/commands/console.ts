/**
 * @module commands/console
 *
 * Interactive REPL connected to a Canton node. Thin oclif wrapper over
 * the repl/parser, repl/executor, and repl/completer modules.
 */

import {Command, Flags} from '@oclif/core'
import * as readline from 'node:readline'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient, type LedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createCompleter, type Completer} from '../lib/repl/completer.js'
import {createExecutor, type Executor} from '../lib/repl/executor.js'
import {parseCommand} from '../lib/repl/parser.js'
import {detectTopology, type GeneratedTopology} from '../lib/topology.js'

export default class Console extends Command {
  static override description = 'Interactive REPL connected to a Canton node'

  static override examples = [
    '<%= config.bin %> console',
    '<%= config.bin %> console --network devnet',
    '<%= config.bin %> console --participant participant2',
  ]

  static override flags = {
    network: Flags.string({
      char: 'n',
      default: 'local',
      description: 'Network to connect to',
    }),
    participant: Flags.string({
      char: 'p',
      description: 'Participant to connect to in multi-node mode (e.g., participant1)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Console)
    const out = createOutput({json: false})

    try {
      const config = await this.loadProjectConfig()
      const networkName = flags.network
      const network = config.networks?.[networkName]

      if (!network) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          context: {availableNetworks: Object.keys(config.networks ?? {}), network: networkName},
          suggestion: `Network "${networkName}" not found in cantonctl.yaml. Available: ${Object.keys(config.networks ?? {}).join(', ') || 'none'}`,
        })
      }

      // Detect multi-node topology
      let baseUrl: string
      let connectionLabel: string
      const topology = networkName === 'local' ? await this.detectProjectTopology(this.getProjectDir()) : null

      if (topology && topology.participants.length > 0) {
        const participantName = flags.participant ?? topology.participants[0].name
        const participant = topology.participants.find(p => p.name === participantName)
        if (!participant) {
          const available = topology.participants.map(p => p.name).join(', ')
          throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
            context: {available, participant: participantName},
            suggestion: `Participant "${participantName}" not found. Available: ${available}`,
          })
        }

        baseUrl = `http://localhost:${participant.ports.jsonApi}`
        connectionLabel = `${networkName} → ${participantName} at ${baseUrl}`
      } else {
        const jsonApiPort = network['json-api-port'] ?? 7575
        baseUrl = network.url ?? `http://localhost:${jsonApiPort}`
        connectionLabel = `${networkName} at ${baseUrl}`
      }

      // Auth
      const partyNames = config.parties?.map(p => p.name) ?? []
      const token = await this.createSandboxToken({
        actAs: partyNames.length > 0 ? partyNames : ['admin'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: partyNames,
      })

      const client = this.createLedgerClient({baseUrl, token})
      const completer = this.createCompleter({partyNames})
      const executor = this.createExecutor({
        client,
        defaultParty: partyNames[0],
        output: out,
      })

      // Banner
      out.log(`Canton Console (cantonctl)`)
      out.log(`Connected to ${connectionLabel}`)
      out.log('Type "help" for commands, "exit" to quit')
      out.log('')

      // REPL loop
      const rl = this.createReadlineInterface({
        completer: (line: string) => completer.complete(line),
        input: process.stdin,
        output: process.stdout,
        prompt: 'canton> ',
      })

      rl.prompt()

      for await (const line of rl) {
        try {
          const cmd = parseCommand(line)
          const shouldContinue = await executor.execute(cmd)
          if (!shouldContinue) {
            rl.close()
            return
          }
        } catch (err) {
          if (err instanceof CantonctlError) {
            out.error(`${err.code}: ${err.message}`)
            if (err.suggestion) {
              out.info(`  ${err.suggestion}`)
            }
          } else {
            out.error(String(err))
          }
        }

        rl.prompt()
      }
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.error(err.format())
        this.exit(1)
      }

      throw err
    }
  }

  protected createCompleter(options: {partyNames: string[]}): Completer {
    return createCompleter(options)
  }

  protected createExecutor(options: Parameters<typeof createExecutor>[0]): Executor {
    return createExecutor(options)
  }

  protected createLedgerClient(options: {baseUrl: string; token: string}): LedgerClient {
    return createLedgerClient(options)
  }

  protected createReadlineInterface(options: readline.ReadLineOptions): readline.Interface {
    return readline.createInterface(options)
  }

  protected async createSandboxToken(options: Parameters<typeof createSandboxToken>[0]): Promise<string> {
    return createSandboxToken(options)
  }

  protected async detectProjectTopology(projectDir: string): Promise<GeneratedTopology | null> {
    return detectTopology(projectDir)
  }

  protected getProjectDir(): string {
    return process.cwd()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}
