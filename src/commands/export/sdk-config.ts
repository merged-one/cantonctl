import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {renderSdkConfigEnv, renderSdkConfigJson} from '../../lib/export/formatters.js'
import {createSdkConfigExporter, type SdkConfigExporter, type SdkConfigTarget} from '../../lib/export/sdk-config.js'
import {createOutput} from '../../lib/output.js'

export default class ExportSdkConfig extends Command {
  static override description = 'Export profile-derived config for official SDK consumers'

  static override examples = [
    '<%= config.bin %> export sdk-config --profile splice-devnet --target dapp-sdk --format json',
    '<%= config.bin %> export sdk-config --profile splice-devnet --target wallet-sdk --format env',
  ]

  static override flags = {
    format: Flags.string({
      default: 'json',
      description: 'Output format',
      options: ['env', 'json'],
    }),
    json: Flags.boolean({
      default: false,
      description: 'Wrap the export in cantonctl JSON output',
    }),
    profile: Flags.string({
      description: 'Profile name (defaults to default-profile)',
    }),
    target: Flags.string({
      description: 'SDK target',
      options: ['dapp-sdk', 'wallet-sdk', 'dapp-api'],
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ExportSdkConfig)
    const out = createOutput({json: flags.json})

    try {
      const exported = await this.createExporter().exportConfig({
        config: await this.loadProjectConfig(),
        profileName: flags.profile,
        target: flags.target as SdkConfigTarget,
      })
      const rendered = flags.format === 'env'
        ? renderSdkConfigEnv(exported)
        : renderSdkConfigJson(exported)

      if (!flags.json) {
        process.stdout.write(rendered)
      }

      out.result({
        data: flags.json ? {config: exported, format: flags.format, rendered} : undefined,
        success: true,
      })
    } catch (error) {
      if (error instanceof CantonctlError) {
        out.result({
          error: {code: error.code, message: error.message, suggestion: error.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw error
    }
  }

  protected createExporter(): SdkConfigExporter {
    return createSdkConfigExporter()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

