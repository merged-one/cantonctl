import * as path from 'node:path'

import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {createDiagnosticsBundleWriter, type DiagnosticsBundleWriter} from '../../lib/diagnostics/bundle.js'
import {createDiagnosticsCollector, type DiagnosticsCollector} from '../../lib/diagnostics/collect.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class DiagnosticsBundle extends Command {
  static override description = 'Export a read-only diagnostics bundle for a resolved profile'

  static override examples = [
    '<%= config.bin %> diagnostics bundle --profile splice-devnet',
    '<%= config.bin %> diagnostics bundle --profile splice-devnet --output .cantonctl/diagnostics/devnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    output: Flags.string({
      description: 'Output directory',
    }),
    profile: Flags.string({
      description: 'Profile name (defaults to default-profile)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DiagnosticsBundle)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const snapshot = await this.createDiagnosticsCollector().collect({
        config,
        profileName: flags.profile,
      })
      const outputDir = flags.output ?? path.join(process.cwd(), '.cantonctl', 'diagnostics', snapshot.profile.name)
      const bundle = await this.createDiagnosticsBundleWriter().write({
        outputDir,
        snapshot,
      })

      if (!flags.json) {
        out.success(`Diagnostics bundle written to ${bundle.outputDir}`)
      }

      out.result({
        data: flags.json ? {
          bundle,
          snapshot,
        } : undefined,
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

  protected createDiagnosticsBundleWriter(): DiagnosticsBundleWriter {
    return createDiagnosticsBundleWriter()
  }

  protected createDiagnosticsCollector(): DiagnosticsCollector {
    return createDiagnosticsCollector()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

