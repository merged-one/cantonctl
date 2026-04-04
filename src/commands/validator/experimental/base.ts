import {Command} from '@oclif/core'

import {resolveAuthProfile, type ResolvedAuthProfile} from '../../../lib/auth-profile.js'
import {type CantonctlConfig, loadConfig} from '../../../lib/config.js'
import {createCredentialStore} from '../../../lib/credential-store.js'
import {CantonctlError, ErrorCode} from '../../../lib/errors.js'
import {
  createValidatorInternalAdapter,
  requireExperimentalConfirmation,
  type ValidatorInternalAdapter,
} from '../../../lib/experimental/validator-internal.js'
import {createBackendWithFallback} from '../../../lib/keytar-backend.js'
import {createOutput, type OutputWriter} from '../../../lib/output.js'

export interface ExperimentalValidatorContext {
  adapter: ValidatorInternalAdapter
  authProfile: ResolvedAuthProfile
  config: CantonctlConfig
  network: string
  token: string
  validatorUrl: string
  warnings: string[]
}

export abstract class ExperimentalValidatorCommand extends Command {
  protected async loadCommandConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected outputFor(json: boolean): OutputWriter {
    return createOutput({json})
  }

  protected handleCommandError(error: unknown, out: OutputWriter): never {
    if (error instanceof CantonctlError) {
      out.result({
        error: {code: error.code, message: error.message, suggestion: error.suggestion},
        success: false,
      })
      this.exit(1)
    }

    throw error
  }

  protected requireExperimentalOptIn(enabled: boolean, commandPath: string): void {
    requireExperimentalConfirmation(enabled, commandPath)
  }

  protected emitWarnings(out: OutputWriter, warnings: readonly string[]): void {
    for (const warning of warnings) {
      out.warn(warning)
    }
  }

  protected async resolveExperimentalContext(options: {
    network: string
    token?: string
    validatorUrl?: string
  }): Promise<ExperimentalValidatorContext> {
    const config = await this.loadCommandConfig()
    const authProfile = resolveAuthProfile({
      config,
      network: options.network,
    })
    const profile = authProfile.profileName
      ? config.profiles?.[authProfile.profileName]
      : config.profiles?.[options.network]
    const validatorUrl = options.validatorUrl ?? profile?.services.validator?.url

    if (!validatorUrl) {
      throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
        context: {
          network: options.network,
          profile: authProfile.profileName,
        },
        suggestion:
          `Network "${options.network}" does not expose a validator service URL. ` +
          'Pass --validator-url or target a profile-backed validator network.',
      })
    }

    let token = options.token
    if (!token) {
      const {backend} = await createBackendWithFallback()
      const store = createCredentialStore({backend, env: process.env})
      token = await store.resolve(options.network) ?? undefined
    }

    if (!token) {
      const suggestion = authProfile.mode === 'localnet-unsafe-hmac'
        ? `Pass --token <jwt>. ${options.network} uses ${authProfile.mode}, so operator JWT minting remains explicit and experimental.`
        : `Pass --token <jwt> or run "cantonctl auth login ${options.network}" first.`
      throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
        context: {mode: authProfile.mode, network: options.network},
        suggestion,
      })
    }

    const warnings = [...authProfile.warnings]

    return {
      adapter: createValidatorInternalAdapter({
        baseUrl: validatorUrl,
        profile: profile
          ? {
            experimental: profile.experimental,
            kind: profile.kind,
            name: profile.name,
            services: profile.services,
          }
          : undefined,
        token,
      }),
      authProfile,
      config,
      network: options.network,
      token,
      validatorUrl,
      warnings,
    }
  }
}
