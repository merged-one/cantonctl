import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'

import {CantonctlError} from '../../lib/errors.js'
import {createLocalnet} from '../../lib/localnet.js'
import {createLocalnetWorkspaceDetector} from '../../lib/localnet-workspace.js'
import {createOutput, type OutputWriter} from '../../lib/output.js'
import {createProcessRunner} from '../../lib/process-runner.js'

interface LocalnetDownFlags {
  json: boolean
  workspace: string
}

export default class LocalnetDown extends Command {
  static override description = 'Stop an upstream Splice LocalNet workspace'

  static override examples = [
    '<%= config.bin %> localnet down --workspace ../quickstart',
    '<%= config.bin %> localnet down --workspace ../quickstart --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    workspace: Flags.string({
      description: 'Path to the official LocalNet workspace',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalnetDown)
    const out = createOutput({json: flags.json})

    await runLocalnetDownCommand({
      createLocalnet: () => this.createLocalnet(),
      handleCommandError: (error: unknown) => handleError(error, out, this),
      out,
    }, flags)
  }

  protected createLocalnet() {
    const detector = createLocalnetWorkspaceDetector({
      access: (filePath: string) => fs.promises.access(filePath),
      readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
    })

    return createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: (url: string) => fetch(url),
      runner: createProcessRunner(),
    })
  }
}

function handleError(error: unknown, out: OutputWriter, command: Command): never {
  if (error instanceof CantonctlError) {
    out.result({
      error: {code: error.code, message: error.message, suggestion: error.suggestion},
      success: false,
    })
    command.exit(1)
  }

  throw error
}

async function runLocalnetDownCommand(
  command: {
    createLocalnet: () => ReturnType<LocalnetDown['createLocalnet']>
    handleCommandError: (error: unknown) => never
    out: OutputWriter
  },
  flags: LocalnetDownFlags,
): Promise<void> {
  try {
    const result = await command.createLocalnet().down({workspace: flags.workspace})

    if (flags.json) {
      command.out.result({
        data: {
          target: result.target,
          workspace: result.workspace.root,
        },
        success: true,
      })
      return
    }

    command.out.success('Upstream LocalNet workspace stopped')
    command.out.log(`Workspace: ${result.workspace.root}`)
  } catch (error) {
    command.handleCommandError(error)
  }
}
