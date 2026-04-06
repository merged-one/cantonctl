import {Command} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput, type OutputWriter} from '../lib/output.js'
import {
  createProfileRuntimeResolver,
  type ProfileRuntimeResolver,
  type ResolvedProfileRuntime,
} from '../lib/profile-runtime.js'
import {
  resolveOperatorSurface,
  type OperatorSurfaceId,
  type ResolvedOperatorSurface,
} from '../lib/operator-surface.js'

export abstract class OperatorSurfaceCommand extends Command {
  protected createProfileRuntimeResolver(): ProfileRuntimeResolver {
    return createProfileRuntimeResolver()
  }

  protected async loadCommandConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected async loadCommandRuntime(profileName: string): Promise<ResolvedProfileRuntime> {
    return this.createProfileRuntimeResolver().resolve({
      config: await this.loadCommandConfig(),
      profileName,
    })
  }

  protected async resolveOperatorCommandSurface(options: {
    profileName: string
    surfaceId: OperatorSurfaceId
  }): Promise<ResolvedOperatorSurface> {
    return resolveOperatorSurface(
      await this.loadCommandRuntime(options.profileName),
      options.surfaceId,
    )
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

  protected outputFor(json: boolean) {
    return createOutput({json})
  }
}
