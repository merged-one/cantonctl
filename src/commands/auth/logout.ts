/**
 * @module commands/auth/logout
 *
 * Remove stored credentials for a Canton network. Thin oclif wrapper
 * over credential-store.
 */

import {Args, Command, Flags} from '@oclif/core'

import {createCredentialStore} from '../../lib/credential-store.js'
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
    '<%= config.bin %> auth logout testnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogout)
    const out = createOutput({json: flags.json})

    try {
      const {backend} = await createBackendWithFallback()
      const store = createCredentialStore({backend})
      const removed = await store.remove(args.network)

      if (removed) {
        out.success(`Removed credentials for ${args.network}`)
      } else {
        out.info(`No credentials stored for ${args.network}`)
      }

      out.result({
        data: {network: args.network, removed},
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
}
