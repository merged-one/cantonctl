/**
 * @module commands/auth/status
 *
 * Show authentication status for all configured networks. Thin oclif
 * wrapper over credential-store.
 */

import {Command, Flags} from '@oclif/core'

import {authProfileUsesLocalFallback, resolveAuthProfile} from '../../lib/auth-profile.js'
import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {createCredentialStore, type CredentialStore, type KeychainBackend} from '../../lib/credential-store.js'
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
      const config = await this.loadCommandConfig()
      const networks = Object.keys(config.networks ?? {})

      const {backend, isKeychain} = await this.createBackend()
      const store = this.createCredentialStore(backend)
      const storedSource = isKeychain ? 'keychain' : 'memory'

      const statuses: Array<{
        authenticated: boolean
        mode: string
        network: string
        source: string | null
        warnings: string[]
      }> = []
      const globalWarnings: string[] = []

      for (const network of networks) {
        const authProfile = resolveAuthProfile({config, network})
        const networkConfig = config.networks?.[network]
        const resolved = await store.resolveRecord(network)
        const warnings = [...authProfile.warnings]
        const storedMode = resolved?.source === 'stored' ? resolved.mode : undefined
        const mode = storedMode ?? authProfile.mode
        if (storedMode && storedMode !== authProfile.mode) {
          warnings.unshift(
            `Stored credential mode "${storedMode}" overrides the inferred "${authProfile.mode}" profile.`,
          )
        }

        const usesLocalFallback = authProfileUsesLocalFallback(authProfile, networkConfig)
        const authenticated = usesLocalFallback ? true : !!resolved
        const source = usesLocalFallback
          ? (resolved ? (resolved.source === 'env' ? 'env' : storedSource) : 'generated')
          : (resolved ? (resolved.source === 'env' ? 'env' : storedSource) : null)

        statuses.push({
          authenticated,
          mode,
          network,
          source,
          warnings,
        })
        globalWarnings.push(...warnings.map(warning => `${network}: ${warning}`))
      }

      if (!flags.json) {
        if (networks.length === 0) {
          out.info('No networks configured in cantonctl.yaml')
        } else {
          out.table(
            ['Network', 'Mode', 'Authenticated', 'Source'],
            statuses.map(s => [
              s.network,
              s.mode,
              s.authenticated ? 'yes' : 'no',
              s.source ?? '-',
            ]),
          )
          for (const status of statuses) {
            for (const warning of status.warnings) {
              out.warn(`${status.network}: ${warning}`)
            }
          }
        }
      }

      out.result({
        data: {
          networks: statuses.map(({warnings, ...status}) => status),
        },
        success: true,
        warnings: flags.json && globalWarnings.length > 0 ? globalWarnings : undefined,
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

  protected async createBackend(): Promise<{backend: KeychainBackend; isKeychain: boolean}> {
    return createBackendWithFallback()
  }

  protected createCredentialStore(backend: KeychainBackend): CredentialStore {
    return createCredentialStore({backend, env: process.env})
  }

  protected async loadCommandConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}
