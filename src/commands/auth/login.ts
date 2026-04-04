/**
 * @module commands/auth/login
 *
 * Store a JWT token for a Canton network. Validates connectivity before
 * persisting. Thin oclif wrapper over credential-store.
 */

import {Args, Command, Flags} from '@oclif/core'
import * as readline from 'node:readline'

import {AUTH_PROFILE_MODES, isAuthProfileMode, resolveAuthProfile} from '../../lib/auth-profile.js'
import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {createCredentialStore, type CredentialStore, type KeychainBackend} from '../../lib/credential-store.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createBackendWithFallback} from '../../lib/keytar-backend.js'
import {createLedgerClient, type LedgerClient} from '../../lib/ledger-client.js'
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
    '<%= config.bin %> auth login validator --mode oidc-client-credentials --token eyJhbGci... --experimental',
    '<%= config.bin %> auth login devnet --json',
  ]

  static override flags = {
    experimental: Flags.boolean({
      default: false,
      description: 'Acknowledge experimental or operator-only auth modes',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    mode: Flags.string({
      description: 'Override the inferred auth profile mode for this login',
      options: [...AUTH_PROFILE_MODES],
    }),
    token: Flags.string({
      char: 't',
      description: 'JWT token (prompted if not provided)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogin)
    const out = createOutput({json: flags.json})
    const networkName = args.network

    try {
      const config = await this.loadCommandConfig()
      const authProfile = resolveAuthProfile({
        config,
        network: networkName,
        requestedMode: flags.mode && isAuthProfileMode(flags.mode) ? flags.mode : undefined,
      })
      const network = config.networks![networkName]!

      if (authProfile.requiresExplicitExperimental && !flags.experimental) {
        throw new CantonctlError(ErrorCode.EXPERIMENTAL_CONFIRMATION_REQUIRED, {
          context: {mode: authProfile.mode, network: networkName},
          suggestion: `Re-run "cantonctl auth login ${networkName} --experimental" to acknowledge the ${authProfile.mode} auth profile.`,
        })
      }

      const warnings = [...authProfile.warnings]
      if (!flags.json) {
        out.info(`Resolved auth profile for ${networkName}: ${authProfile.mode}`)
        for (const warning of authProfile.warnings) {
          out.warn(warning)
        }
      }

      // Get token: from flag or prompt when the mode actually persists operator credentials.
      let token = flags.token
      if (!token && authProfile.mode !== 'localnet-unsafe-hmac') {
        token = await this.promptForToken(authProfile.mode)
      }

      if (!token && authProfile.mode !== 'localnet-unsafe-hmac') {
        throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
          context: {mode: authProfile.mode, network: networkName},
          suggestion: 'No token provided. Pass --token or enter it when prompted.',
        })
      }

      if (!token && authProfile.mode === 'localnet-unsafe-hmac') {
        const message =
          `No credential persisted for ${networkName}. ` +
          'This profile relies on a local-only unsafe HMAC/shared-secret flow.'
        if (!flags.json) {
          out.info(message)
          out.success(`Acknowledged ${authProfile.mode} for ${networkName}`)
        }

        out.result({
          data: {
            mode: authProfile.mode,
            network: networkName,
            persisted: false,
            source: 'generated',
          },
          success: true,
          warnings: flags.json && warnings.length > 0 ? warnings : undefined,
        })
        return
      }

      // Validate connectivity with the token
      const jsonApiPort = network['json-api-port'] ?? 7575
      const baseUrl = network.url ?? `http://localhost:${jsonApiPort}`
      const client = this.createLedgerClient({baseUrl, token: token!})

      out.info(`Verifying connectivity to ${networkName}...`)
      try {
        await client.getVersion()
      } catch {
        const warning = `Could not verify connectivity to ${networkName}. Token stored anyway.`
        warnings.push(warning)
        out.warn(warning)
      }

      // Store in credential store (OS keychain with in-memory fallback)
      const {backend, isKeychain} = await this.createBackend()
      const source = isKeychain ? 'keychain' : 'memory'
      if (!isKeychain) {
        const warning = 'OS keychain unavailable — credentials stored in memory only (install keytar for persistence)'
        warnings.push(warning)
        out.warn(warning)
      }

      const store = this.createCredentialStore(backend)
      await store.store(networkName, token!, {mode: authProfile.mode})

      out.success(`Authenticated with ${networkName}`)
      out.result({
        data: {
          mode: authProfile.mode,
          network: networkName,
          persisted: true,
          source,
        },
        success: true,
        warnings: flags.json && warnings.length > 0 ? warnings : undefined,
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

  protected createCredentialStore(backend: KeychainBackend): CredentialStore {
    return createCredentialStore({backend})
  }

  protected async createBackend(): Promise<{backend: KeychainBackend; isKeychain: boolean}> {
    return createBackendWithFallback()
  }

  protected createLedgerClient(options: {baseUrl: string; token: string}): LedgerClient {
    return createLedgerClient(options)
  }

  protected async loadCommandConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected createReadlineInterface(options: readline.ReadLineOptions): readline.Interface {
    return readline.createInterface(options)
  }

  private async promptForToken(mode: string): Promise<string | undefined> {
    const rl = this.createReadlineInterface({
      input: process.stdin,
      output: process.stderr,
    })

    return new Promise((resolve) => {
      const label = mode === 'oidc-client-credentials' ? 'Enter OIDC access token: ' : 'Enter JWT token: '
      rl.question(label, (answer) => {
        rl.close()
        resolve(answer.trim() || undefined)
      })
    })
  }
}
