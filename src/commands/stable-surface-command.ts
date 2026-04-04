import {Command} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {type AdapterProfileContext} from '../lib/adapters/index.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput, type OutputWriter} from '../lib/output.js'
import {createStableSplice, resolveStableSpliceProfile, type StableSplice} from '../lib/splice-public.js'

export abstract class StableSurfaceCommand extends Command {
  protected createStableSplice(): StableSplice {
    return createStableSplice()
  }

  protected async loadCommandConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected async maybeLoadProfileContext(options: {
    needsProfile: boolean
    profileName?: string
  }): Promise<AdapterProfileContext | undefined> {
    if (!options.needsProfile && !options.profileName) {
      return undefined
    }

    return resolveStableSpliceProfile(await this.loadCommandConfig(), options.profileName)
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
