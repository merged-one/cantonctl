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

interface InteractivePromptModule {
  input(options: {
    message: string
    validate: (value: string) => string | true
  }): Promise<string>
  select(options: {
    choices: Array<{description: string; name: string; value: Template}>
    message: string
  }): Promise<Template>
}

interface InitArgs {
  name?: string
}

interface InitFlags {
  from?: string
  json: boolean
  template: Template
}

async function loadInteractivePrompts(): Promise<InteractivePromptModule> {
  const prompts = await import('@inquirer/prompts')
  return {
    input: prompts.input,
    select: prompts.select as InteractivePromptModule['select'],
  }
}

/** Prompt the user for project name and template selection. */
async function promptInteractive(prompts: InteractivePromptModule): Promise<{name: string; template: Template}> {
  const name = await prompts.input({
    message: 'Project name:',
    validate: (value: string) => {
      if (!value.trim()) return 'Project name is required'
      if (/[^a-zA-Z0-9_-]/.test(value)) return 'Use only letters, numbers, hyphens, and underscores'
      return true
    },
  })

  const template = await prompts.select({
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

    await runInitCommand({
      createRunner: () => this.createRunner(),
      handleCommandError: (error: unknown) => {
        if (error instanceof CantonctlError) {
          out.result({
            error: {code: error.code, message: error.message, suggestion: error.suggestion},
            success: false,
          })
          this.exit(1)
        }

        throw error
      },
      out,
      promptInteractive: () => this.promptInteractive(),
      resolveProjectDir: (projectName) => this.resolveProjectDir(projectName),
      scaffoldFromUrl: (options) => this.scaffoldFromUrl(options),
      scaffoldProject: (options) => this.scaffoldProject(options),
    }, args, {...flags, template: flags.template as Template})
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected async loadInteractivePrompts(): Promise<InteractivePromptModule> {
    return loadInteractivePrompts()
  }

  protected async promptInteractive(): Promise<{name: string; template: Template}> {
    return promptInteractive(await this.loadInteractivePrompts())
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

async function runInitCommand(
  command: {
    createRunner: () => ProcessRunner
    handleCommandError: (error: unknown) => never
    out: ReturnType<typeof createOutput>
    promptInteractive: () => Promise<{name: string; template: Template}>
    resolveProjectDir: (projectName: string) => string
    scaffoldFromUrl: (options: {dir: string; runner: ProcessRunner; url: string}) => Promise<void>
    scaffoldProject: (options: {dir: string; name: string; template: Template}) => {
      files: string[]
      projectDir: string
      template: Template
    }
  },
  args: InitArgs,
  flags: InitFlags,
): Promise<void> {
  try {
    if (flags.from) {
      const projectName = args.name
      if (!projectName) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Provide a project name: cantonctl init my-app --from <url>',
        })
      }

      const projectDir = command.resolveProjectDir(projectName)
      command.out.info(`Scaffolding from community template: ${flags.from}`)
      const runner = command.createRunner()
      await command.scaffoldFromUrl({dir: projectDir, runner, url: flags.from})
      command.out.success(`Project created from ${flags.from}`)
      command.out.result({data: {from: flags.from, projectDir}, success: true})
      return
    }

    let projectName: string
    let template: Template

    if (args.name) {
      projectName = args.name
      template = flags.template
    } else {
      const answers = await command.promptInteractive()
      projectName = answers.name
      template = answers.template
    }

    const projectDir = command.resolveProjectDir(projectName)

    command.out.info(`Creating new Canton project: ${projectName}`)
    command.out.info(`Template: ${template}`)

    const result = command.scaffoldProject({dir: projectDir, name: projectName, template})

    command.out.success(`Project created at ./${projectName}`)
    command.out.log('')
    command.out.log('Next steps:')
    command.out.log(`  cd ${projectName}`)
    command.out.log('  cantonctl dev        # Start local Canton node')
    command.out.log('  cantonctl build      # Compile Daml contracts')
    command.out.log('  cantonctl test       # Run tests')

    command.out.result({
      data: {
        files: result.files,
        projectDir: result.projectDir,
        template: result.template,
      },
      success: true,
    })
  } catch (error) {
    command.handleCommandError(error)
  }
}
