/**
 * @module commands/init
 *
 * Scaffolds a new Canton project from a built-in or community template.
 * Thin oclif wrapper over {@link scaffoldProject} and {@link scaffoldFromUrl}.
 *
 * @example
 * ```bash
 * cantonctl init my-app
 * cantonctl init my-defi-app --template token
 * cantonctl init my-app --from https://github.com/user/template
 * ```
 */

import {Args, Command, Flags} from '@oclif/core'
import * as path from 'node:path'

import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner} from '../lib/process-runner.js'
import {TEMPLATES, type Template, scaffoldFromUrl, scaffoldProject} from '../lib/scaffold.js'

export default class Init extends Command {
  static override args = {
    name: Args.string({
      description: 'Project name',
      required: true,
    }),
  }

  static override description = 'Scaffold a new Canton project from a template'

  static override examples = [
    '<%= config.bin %> init my-app',
    '<%= config.bin %> init my-defi-app --template token',
    '<%= config.bin %> init my-app --from https://github.com/user/template',
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
    const projectDir = path.resolve(args.name)

    try {
      if (flags.from) {
        out.info(`Scaffolding from community template: ${flags.from}`)
        const runner = createProcessRunner()
        await scaffoldFromUrl({dir: projectDir, runner, url: flags.from})
        out.success(`Project created from ${flags.from}`)
        out.result({data: {from: flags.from, projectDir}, success: true})
        return
      }

      const template = flags.template as Template
      out.info(`Creating new Canton project: ${args.name}`)
      out.info(`Template: ${template}`)

      const result = scaffoldProject({dir: projectDir, name: args.name, template})

      out.success(`Project created at ./${args.name}`)
      out.log('')
      out.log('Next steps:')
      out.log(`  cd ${args.name}`)
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
}
