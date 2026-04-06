import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'

import {CantonctlError} from '../../lib/errors.js'
import {createLocalnet, type LocalnetStatusResult} from '../../lib/localnet.js'
import {createLocalnetWorkspaceDetector} from '../../lib/localnet-workspace.js'
import {createOutput, type OutputWriter} from '../../lib/output.js'
import {createProcessRunner} from '../../lib/process-runner.js'
import {createLocalnetWorkspaceInventory} from '../../lib/runtime-inventory.js'

export default class LocalnetUp extends Command {
  static override description = 'Start an upstream Splice LocalNet workspace'

  static override examples = [
    '<%= config.bin %> localnet up --workspace ../quickstart',
    '<%= config.bin %> localnet up --workspace ../quickstart --profile app-provider',
    '<%= config.bin %> localnet up --workspace ../quickstart --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    profile: Flags.string({
      description: 'Optional upstream profile hint passed through as PROFILE=<name>',
    }),
    workspace: Flags.string({
      description: 'Path to the official LocalNet workspace',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalnetUp)
    const out = createOutput({json: flags.json})

    try {
      const result = await this.createLocalnet().up({
        profile: flags.profile,
        workspace: flags.workspace,
      })

      if (flags.json) {
        out.result({
          data: serializeStatusResult(result),
          success: result.health.validatorReadyz.healthy,
        })
      } else {
        out.success('Upstream LocalNet workspace started')
        renderStatus(out, result)
      }

      if (!result.health.validatorReadyz.healthy) {
        this.exit(1)
      }
    } catch (error) {
      handleError(error, out, this)
    }
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

function renderStatus(out: OutputWriter, result: LocalnetStatusResult): void {
  out.log(`Workspace: ${result.workspace.root}`)
  out.log(`Health profile: ${result.selectedProfile}`)
  out.log('')
  renderHealth(out, result)
  out.log('')
  renderProfiles(out, result)

  if (result.containers.length > 0) {
    out.log('')
    out.table(
      ['Container', 'Service', 'Status', 'Ports'],
      result.containers.map(container => [
        container.name,
        container.service,
        container.status,
        container.ports ?? '-',
      ]),
    )
  }
}

function renderHealth(out: OutputWriter, result: LocalnetStatusResult): void {
  const health = result.health.validatorReadyz
  out.table(
    ['Check', 'Status', 'URL'],
    [[
      'validator readyz',
      health.healthy ? `healthy (${health.status})` : `unreachable (${health.status || 'error'})`,
      health.url,
    ]],
  )
}

function renderProfiles(out: OutputWriter, result: LocalnetStatusResult): void {
  out.table(
    ['Profile', 'Ledger', 'Wallet', 'Validator', 'Scan'],
    Object.values(result.profiles).map(profile => [
      profile.name,
      profile.urls.ledger,
      profile.urls.wallet,
      profile.urls.validator,
      profile.urls.scan ?? '-',
    ]),
  )
}

function serializeStatusResult(result: LocalnetStatusResult) {
  const inventory = createLocalnetWorkspaceInventory(result)
  return {
    capabilities: inventory.capabilities,
    containers: result.containers,
    drift: inventory.drift,
    health: result.health,
    inventory,
    profiles: result.profiles,
    selectedProfile: result.selectedProfile,
    services: result.services,
    workspace: result.workspace.root,
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
