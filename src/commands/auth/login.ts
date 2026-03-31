/**
 * @module commands/auth/login
 *
 * Store a JWT token for a Canton network. Validates connectivity before
 * persisting. Thin oclif wrapper over credential-store.
 */

import {Args, Command, Flags} from '@oclif/core'
import * as readline from 'node:readline'

import {loadConfig} from '../../lib/config.js'
import {createCredentialStore, createInMemoryBackend} from '../../lib/credential-store.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createLedgerClient} from '../../lib/ledger-client.js'
import {createOutput} from '../../lib/output.js'

export default class AuthLogin extends Command {
  static override args = {
    network: Args.string({
      description: 'Network to authenticate with',
      required: true,
    }),
  }

  static override description = 'Store a JWT token for a Canton network'

  static override examples = [
    '<%= config.bin %> auth login devnet',
    '<%= config.bin %> auth login testnet --token eyJhbGci...',
    '<%= config.bin %> auth login devnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    token: Flags.string({
      char: 't',
      description: 'JWT token (prompted if not provided)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogin)
    const out = createOutput({json: flags.json})

    try {
      const config = await loadConfig()
      const networkName = args.network
      const network = config.networks?.[networkName]

      if (!network) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          context: {availableNetworks: Object.keys(config.networks ?? {}), network: networkName},
          suggestion: `Network "${networkName}" not found in cantonctl.yaml. Available: ${Object.keys(config.networks ?? {}).join(', ') || 'none'}`,
        })
      }

      // Get token: from flag or prompt
      let token = flags.token
      if (!token) {
        token = await this.promptForToken()
      }

      if (!token) {
        throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
          context: {network: networkName},
          suggestion: 'No token provided. Pass --token or enter it when prompted.',
        })
      }

      // Validate connectivity with the token
      const jsonApiPort = network['json-api-port'] ?? 7575
      const baseUrl = network.url ?? `http://localhost:${jsonApiPort}`
      const client = createLedgerClient({baseUrl, token})

      out.info(`Verifying connectivity to ${networkName}...`)
      try {
        await client.getVersion()
      } catch {
        out.warn(`Could not verify connectivity to ${networkName}. Token stored anyway.`)
      }

      // Store in credential store
      // TODO: Replace with OS keychain backend when keytar is added
      const store = createCredentialStore({backend: createInMemoryBackend()})
      await store.store(networkName, token)

      out.success(`Authenticated with ${networkName}`)
      out.result({
        data: {network: networkName},
        success: true,
      })
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }

  private async promptForToken(): Promise<string | undefined> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    })

    return new Promise((resolve) => {
      rl.question('Enter JWT token: ', (answer) => {
        rl.close()
        resolve(answer.trim() || undefined)
      })
    })
  }
}
