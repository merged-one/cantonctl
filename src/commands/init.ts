/**
 * @module commands/init
 *
 * Scaffolds a new companion-ready Canton project from a built-in template.
 * Thin oclif wrapper over {@link scaffoldProject}.
 *
 * When called without arguments, launches an interactive wizard using inquirer.
 *
 * @example
 * ```bash
 * cantonctl init my-app
 * cantonctl init my-splice-app --template splice-token-app
 * cantonctl init                # Interactive mode
 * ```
 */

import {Args, Command, Flags} from '@oclif/core'
import * as path from 'node:path'

import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {
  TEMPLATES,
  TEMPLATE_CHOICES,
  type Template,
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

  static override description = 'Scaffold a companion-ready Canton project from a template'

  static override examples = [
    '<%= config.bin %> init my-app',
    '<%= config.bin %> init my-splice-app --template splice-token-app',
    '<%= config.bin %> init',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    template: Flags.string({
      char: 't',
      default: 'splice-dapp-sdk',
      description: `Project template (${TEMPLATES.join(', ')})`,
      options: [...TEMPLATES],
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)
    const out = createOutput({json: flags.json})

    await runInitCommand({
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
      scaffoldProject: (options) => this.scaffoldProject(options),
    }, args, {...flags, template: flags.template as Template})
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

  protected scaffoldProject(options: {dir: string; name: string; template: Template}) {
    return scaffoldProject(options)
  }
}

async function runInitCommand(
  command: {
    handleCommandError: (error: unknown) => never
    out: ReturnType<typeof createOutput>
    promptInteractive: () => Promise<{name: string; template: Template}>
    resolveProjectDir: (projectName: string) => string
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

    command.out.info(`Creating companion-ready project: ${projectName}`)
    command.out.info(`Template: ${template}`)

    const result = command.scaffoldProject({dir: projectDir, name: projectName, template})

    command.out.success(`Project created at ./${projectName}`)
    command.out.log('')
    command.out.log('Next steps:')
    command.out.log(`  cd ${projectName}`)
    command.out.log('  cantonctl dev        # Start the local sandbox wrapper')
    command.out.log('  cantonctl build      # Delegate build to DPM or daml')
    command.out.log('  cantonctl test       # Delegate tests to DPM or daml')
    if (template.startsWith('splice-')) {
      command.out.log('  cantonctl compat check splice-devnet  # Check remote stable/public compatibility')
    }

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
