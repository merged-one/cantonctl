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
        network: string
        app: {
          authenticated: boolean
          envVarName: string
          mode: string
          source: string | null
        }
        operator: {
          authenticated: boolean
          envVarName: string
          mode: string
          required: boolean
          source: string | null
        }
        warnings: string[]
      }> = []
      const globalWarnings: string[] = []

      for (const network of networks) {
        const authProfile = resolveAuthProfile({config, network})
        const networkConfig = config.networks?.[network]
        const appCredential = await store.resolveRecord(network)
        const operatorCredential = await store.resolveRecord(network, {scope: 'operator'})
        const warnings = [...authProfile.warnings]
        const storedMode = appCredential?.source === 'stored' ? appCredential.mode : undefined
        const mode = storedMode ?? authProfile.mode
        if (storedMode && storedMode !== authProfile.mode) {
          warnings.unshift(
            `Stored credential mode "${storedMode}" overrides the inferred "${authProfile.mode}" profile.`,
          )
        }

        const usesLocalFallback = authProfileUsesLocalFallback(authProfile, networkConfig)
        const appAuthenticated = usesLocalFallback ? true : !!appCredential
        const appSource = usesLocalFallback
          ? (appCredential ? (appCredential.source === 'env' ? 'env' : storedSource) : 'generated')
          : (appCredential ? (appCredential.source === 'env' ? 'env' : storedSource) : null)
        const operatorAuthenticated = authProfile.operator.localFallbackAllowed
          ? true
          : authProfile.operator.required
            ? !!operatorCredential
            : !!operatorCredential
        const operatorSource = authProfile.operator.localFallbackAllowed
          ? (operatorCredential ? (operatorCredential.source === 'env' ? 'env' : storedSource) : 'generated')
          : (operatorCredential ? (operatorCredential.source === 'env' ? 'env' : storedSource) : null)

        statuses.push({
          network,
          app: {
            authenticated: appAuthenticated,
            envVarName: authProfile.app.envVarName,
            mode,
            source: appSource,
          },
          operator: {
            authenticated: operatorAuthenticated,
            envVarName: authProfile.operator.envVarName,
            mode: authProfile.mode,
            required: authProfile.operator.required,
            source: operatorSource,
          },
          warnings,
        })
        globalWarnings.push(...warnings.map(warning => `${network}: ${warning}`))
      }

      if (!flags.json) {
        if (networks.length === 0) {
          out.info('No networks configured in cantonctl.yaml')
        } else {
          out.table(
            ['Network', 'App', 'App Source', 'Operator', 'Operator Source'],
            statuses.map(s => [
              s.network,
              s.app.authenticated ? s.app.mode : `${s.app.mode} (missing)`,
              s.app.source ?? '-',
              s.operator.required ? (s.operator.authenticated ? `${s.operator.mode}` : `${s.operator.mode} (missing)`) : 'not required',
              s.operator.source ?? '-',
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
