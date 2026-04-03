/**
 * @module commands/init
 *
 * Scaffolds a new Canton project from a built-in or community template.
 * Thin oclif wrapper over {@link scaffoldProject} and {@link scaffoldFromUrl}.
 *
 * When called without arguments, launches an interactive wizard using inquirer.
 *
 * @example
 * ```bash
 * cantonctl init my-app
 * cantonctl init my-defi-app --template token
 * cantonctl init my-app --from https://github.com/user/template
 * cantonctl init                # Interactive mode
 * ```
 */

import {Args, Command, Flags} from '@oclif/core'
import * as path from 'node:path'

import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'
import {
  TEMPLATES,
  TEMPLATE_CHOICES,
  type Template,
  scaffoldFromUrl,
  scaffoldProject,
} from '../lib/scaffold.js'

/** Prompt the user for project name and template selection. */
async function promptInteractive(): Promise<{name: string; template: Template}> {
  const {input, select} = await import('@inquirer/prompts')

  const name = await input({
    message: 'Project name:',
    validate: (value: string) => {
      if (!value.trim()) return 'Project name is required'
      if (/[^a-zA-Z0-9_-]/.test(value)) return 'Use only letters, numbers, hyphens, and underscores'
      return true
    },
  })

  const template = await select({
    choices: TEMPLATE_CHOICES.map(({description, template}) => ({
      description,
      name: template,
      value: template,
    })),
    message: 'Select a template:',
  }) as Template

  return {name, template}
}

export default class Init extends Command {
  static override args = {
    name: Args.string({
      description: 'Project name (omit for interactive mode)',
      required: false,
    }),
  }

  static override description = 'Scaffold a new Canton project from a template'

  static override examples = [
    '<%= config.bin %> init my-app',
    '<%= config.bin %> init my-defi-app --template token',
    '<%= config.bin %> init my-splice-app --template splice-token-app',
    '<%= config.bin %> init my-app --from https://github.com/user/template',
    '<%= config.bin %> init',
  ]

  static override flags = {
    from: Flags.string({
      char: 'f',
      description: 'Create from a community template (GitHub URL)',
      exclusive: ['template'],
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    template: Flags.string({
      char: 't',
      default: 'basic',
      description: `Project template (${TEMPLATES.join(', ')})`,
      options: [...TEMPLATES],
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)
    const out = createOutput({json: flags.json})

    try {
      if (flags.from) {
        const projectName = args.name
        if (!projectName) {
          throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
            suggestion: 'Provide a project name: cantonctl init my-app --from <url>',
          })
        }

        const projectDir = this.resolveProjectDir(projectName)
        out.info(`Scaffolding from community template: ${flags.from}`)
        const runner = this.createRunner()
        await this.scaffoldFromUrl({dir: projectDir, runner, url: flags.from})
        out.success(`Project created from ${flags.from}`)
        out.result({data: {from: flags.from, projectDir}, success: true})
        return
      }

      let projectName: string
      let template: Template

      if (args.name) {
        // Non-interactive: use flags
        projectName = args.name
        template = flags.template as Template
      } else {
        // Interactive mode
        const answers = await this.promptInteractive()
        projectName = answers.name
        template = answers.template
      }

      const projectDir = this.resolveProjectDir(projectName)

      out.info(`Creating new Canton project: ${projectName}`)
      out.info(`Template: ${template}`)

      const result = this.scaffoldProject({dir: projectDir, name: projectName, template})

      out.success(`Project created at ./${projectName}`)
      out.log('')
      out.log('Next steps:')
      out.log(`  cd ${projectName}`)
      out.log('  cantonctl dev        # Start local Canton node')
      out.log('  cantonctl build      # Compile Daml contracts')
      out.log('  cantonctl test       # Run tests')

      out.result({
        data: {
          files: result.files,
          projectDir: result.projectDir,
          template: result.template,
        },
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

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected async promptInteractive(): Promise<{name: string; template: Template}> {
    return promptInteractive()
  }

  protected resolveProjectDir(projectName: string): string {
    return path.resolve(projectName)
  }

  protected scaffoldFromUrl(options: {dir: string; runner: ProcessRunner; url: string}): Promise<void> {
    return scaffoldFromUrl(options)
  }

  protected scaffoldProject(options: {dir: string; name: string; template: Template}) {
    return scaffoldProject(options)
  }
}
