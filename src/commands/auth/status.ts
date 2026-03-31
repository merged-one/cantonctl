/**
 * @module commands/auth/status
 *
 * Show authentication status for all configured networks. Thin oclif
 * wrapper over credential-store.
 */

import {Command, Flags} from '@oclif/core'

import {loadConfig} from '../../lib/config.js'
import {createCredentialStore} from '../../lib/credential-store.js'
import {CantonctlError} from '../../lib/errors.js'
import {createBackendWithFallback} from '../../lib/keytar-backend.js'
import {createOutput} from '../../lib/output.js'

export default class AuthStatus extends Command {
  static override description = 'Show authentication status for configured networks'

  static override examples = [
    '<%= config.bin %> auth status',
    '<%= config.bin %> auth status --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthStatus)
    const out = createOutput({json: flags.json})

    try {
      const config = await loadConfig()
      const networks = Object.keys(config.networks ?? {})

      const {backend} = await createBackendWithFallback()
      const store = createCredentialStore({backend, env: process.env})

      const statuses: Array<{authenticated: boolean; network: string; source: string | null}> = []

      for (const network of networks) {
        const token = await store.resolve(network)
        const envVar = `CANTONCTL_JWT_${network.toUpperCase().replace(/-/g, '_')}`
        const fromEnv = !!process.env[envVar]

        statuses.push({
          authenticated: !!token,
          network,
          source: token ? (fromEnv ? 'env' : 'keychain') : null,
        })
      }

      if (!flags.json) {
        if (networks.length === 0) {
          out.info('No networks configured in cantonctl.yaml')
        } else {
          out.table(
            ['Network', 'Authenticated', 'Source'],
            statuses.map(s => [
              s.network,
              s.authenticated ? 'yes' : 'no',
              s.source ?? '-',
            ]),
          )
        }
      }

      out.result({
        data: {networks: statuses},
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
