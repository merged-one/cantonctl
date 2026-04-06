/**
 * @module commands/auth/logout
 *
 * Remove stored credentials for a Canton network. Thin oclif wrapper
 * over credential-store.
 */

import {Args, Command, Flags} from '@oclif/core'

import {AUTH_CREDENTIAL_SCOPES} from '../../lib/auth-profile.js'
import {createCredentialStore, type CredentialStore, type KeychainBackend} from '../../lib/credential-store.js'
import {CantonctlError} from '../../lib/errors.js'
import {createBackendWithFallback} from '../../lib/keytar-backend.js'
import {createOutput} from '../../lib/output.js'

export default class AuthLogout extends Command {
  static override args = {
    network: Args.string({
      description: 'Network to remove credentials for',
      required: true,
    }),
  }

  static override description = 'Remove stored credentials for a Canton network'

  static override examples = [
    '<%= config.bin %> auth logout devnet',
    '<%= config.bin %> auth logout devnet --scope operator',
    '<%= config.bin %> auth logout testnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    scope: Flags.string({
      default: 'app',
      description: 'Credential scope to remove',
      options: [...AUTH_CREDENTIAL_SCOPES],
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogout)
    const out = createOutput({json: flags.json})

    try {
      const {backend} = await this.createBackend()
      const store = this.createCredentialStore(backend)
      const removed = await store.remove(args.network, {scope: flags.scope as 'app' | 'operator'})

      if (removed) {
        out.success(`Removed ${flags.scope} credentials for ${args.network}`)
      } else {
        out.info(`No ${flags.scope} credentials stored for ${args.network}`)
      }

      out.result({
        data: {network: args.network, removed, scope: flags.scope},
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

  protected async createBackend(): Promise<{backend: KeychainBackend}> {
    return createBackendWithFallback()
  }

  protected createCredentialStore(backend: KeychainBackend): CredentialStore {
    return createCredentialStore({backend})
  }
}
