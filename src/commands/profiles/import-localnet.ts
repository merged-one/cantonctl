import * as fs from 'node:fs'
import * as path from 'node:path'

import {Command, Flags} from '@oclif/core'

import {createOutput} from '../../lib/output.js'
import {createLocalnetWorkspaceDetector, type LocalnetProfileName, type LocalnetWorkspaceDetector} from '../../lib/localnet-workspace.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {mergeLocalnetProfileIntoConfigYaml, synthesizeProfileFromLocalnetWorkspace} from '../../lib/localnet-import.js'

export default class ProfilesImportLocalnet extends Command {
  static override description = 'Import an official LocalNet workspace as a splice-localnet profile'

  static override examples = [
    '<%= config.bin %> profiles import-localnet --workspace ../quickstart',
    '<%= config.bin %> profiles import-localnet --workspace ../quickstart --write --json',
    '<%= config.bin %> profiles import-localnet --workspace ../quickstart --source-profile app-user --name splice-localnet-user',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    name: Flags.string({
      description: 'Profile name override',
    }),
    'network-name': Flags.string({
      description: 'Network name override',
    }),
    'source-profile': Flags.string({
      default: 'sv',
      description: 'Workspace profile to import',
      options: ['app-provider', 'app-user', 'sv'],
    }),
    workspace: Flags.string({
      description: 'Path to the official LocalNet workspace root',
      required: true,
    }),
    write: Flags.boolean({
      default: false,
      description: 'Write the imported profile and network mapping into cantonctl.yaml',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProfilesImportLocalnet)
    const out = createOutput({json: flags.json})

    try {
      const workspace = await this.createDetector().detect(flags.workspace)
      const synthesized = synthesizeProfileFromLocalnetWorkspace({
        name: flags.name,
        networkName: flags['network-name'],
        sourceProfile: flags['source-profile'] as LocalnetProfileName,
        workspace,
      })

      let configPath: string | undefined
      if (flags.write) {
        configPath = path.join(process.cwd(), 'cantonctl.yaml')
        if (!fs.existsSync(configPath)) {
          throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
            suggestion: 'Run this command from a cantonctl project root with an existing cantonctl.yaml file.',
          })
        }

        const merged = mergeLocalnetProfileIntoConfigYaml({
          existingConfigYaml: fs.readFileSync(configPath, 'utf8'),
          synthesized,
        })
        fs.writeFileSync(configPath, merged, 'utf8')
      }

      if (!flags.json) {
        out.info(`Workspace: ${workspace.root}`)
        out.info(`Imported ${synthesized.sourceProfile} as profile "${synthesized.name}" and network "${synthesized.networkName}"`)
        out.log('')
        out.log(synthesized.yaml)
        if (flags.write && configPath) {
          out.success(`Updated ${configPath}`)
        }
      }

      out.result({
        data: flags.json ? {
          configPath,
          networkName: synthesized.networkName,
          profile: synthesized.profile,
          profileName: synthesized.name,
          sourceProfile: synthesized.sourceProfile,
          warnings: synthesized.warnings,
          workspace: workspace.root,
          write: flags.write,
          yaml: synthesized.yaml,
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

  protected createDetector(): LocalnetWorkspaceDetector {
    return createLocalnetWorkspaceDetector({
      access: (filePath: string) => fs.promises.access(filePath),
      readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
    })
  }
}
