/**
 * @module commands/deploy
 *
 * Profile-first DAR rollout command. Thin oclif wrapper over {@link createDeployer}.
 */

import {Args, Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {createDeployer, type Deployer, type DeployResult} from '../lib/deployer.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput, type OutputWriter} from '../lib/output.js'
import {createPluginHookManager, type PluginHookManager} from '../lib/plugin-hooks.js'
import {createProfileRuntimeResolver} from '../lib/profile-runtime.js'
import {findDarFile} from '../lib/runtime-support.js'
import {detectTopology, type GeneratedTopology} from '../lib/topology.js'

interface DeployArgs {
  target?: string
}

interface DeployFlags {
  dar?: string
  'dry-run': boolean
  json: boolean
  party?: string
  plan: boolean
  profile?: string
}

export default class Deploy extends Command {
  static override args = {
    target: Args.string({
      description: 'Target profile name or legacy network alias',
      required: false,
    }),
  }

  static override description = 'Roll out a built DAR to the resolved profile or legacy target'

  static override examples = [
    '<%= config.bin %> deploy',
    '<%= config.bin %> deploy --profile splice-devnet --plan --json',
    '<%= config.bin %> deploy sandbox --dry-run',
    '<%= config.bin %> deploy --profile sandbox --dar ./.daml/dist/demo.dar',
  ]

  static override flags = {
    dar: Flags.string({
      description: 'Path to an already built .dar file (defaults to .daml/dist auto-detection)',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Run read-only preflight and artifact resolution without uploading',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    party: Flags.string({
      description: 'Deploying party override for local fallback auth',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Produce a rollout plan without contacting the target runtime',
    }),
    profile: Flags.string({
      description: 'Resolved profile name (defaults to default-profile or the only profile)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deploy)
    const out = createOutput({json: flags.json})

    try {
      const target = resolveRequestedTarget(flags.profile, args.target)
      const result = await this.createDeployer({
        config: await this.loadProjectConfig(),
        hooks: this.createHooks(),
      }).deploy({
        darPath: flags.dar,
        mode: flags.plan ? 'plan' : (flags['dry-run'] ? 'dry-run' : 'apply'),
        party: flags.party,
        profileName: target,
        projectDir: this.getProjectDir(),
      })

      if (!flags.json) {
        renderDeployResult(out, result)
      }

      out.result({
        data: flags.json ? result : undefined,
        success: result.success,
      })

      if (!result.success) {
        this.exit(1)
      }
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

  protected createDeployer(deps: {config: CantonctlConfig; hooks: PluginHookManager}): Deployer {
    return createDeployer({
      config: deps.config,
      createLedgerClient,
      createProfileRuntimeResolver,
      createToken: createSandboxToken,
      detectTopology: (projectDir) => this.detectProjectTopology(projectDir),
      findDarFile,
      fs: {readFile: (filePath: string) => fs.promises.readFile(filePath)},
      hooks: deps.hooks,
    })
  }

  protected createHooks(): PluginHookManager {
    return createPluginHookManager()
  }

  protected async detectProjectTopology(projectDir: string): Promise<GeneratedTopology | null> {
    return detectTopology(projectDir)
  }

  protected getProjectDir(): string {
    return process.cwd()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

export function renderDeployResult(out: OutputWriter, result: DeployResult): void {
  out.log(`Profile: ${result.profile.name} (${result.profile.kind})`)
  out.log(`Network: ${result.profile.network}`)
  out.log(`Mode: ${result.mode}`)
  out.log(`DAR: ${result.artifact.darPath ?? 'not resolved'} (${result.artifact.source})`)
  out.log(`Fan-out: ${result.fanOut.mode} via ${result.fanOut.source}`)
  out.log('')
  out.table(
    ['Target', 'Status', 'Endpoint', 'Package ID'],
    result.targets.map(target => [
      target.label,
      target.status,
      target.baseUrl ?? '-',
      target.packageId ?? '-',
    ]),
  )
  out.log('')
  out.table(
    ['Step', 'Status', 'Detail'],
    result.steps.map(step => [
      step.title,
      step.status,
      step.detail ?? step.error?.message ?? '-',
    ]),
  )

  for (const step of result.steps) {
    for (const warning of step.warnings) {
      out.warn(`${step.title}: ${warning.detail}`)
    }

    for (const postcondition of step.postconditions) {
      if (postcondition.status === 'warn') {
        out.warn(`${step.title}: ${postcondition.detail}`)
      }
    }
  }

  if (result.success) {
    out.success(`Deploy ${result.mode === 'plan' ? 'plan' : 'rollout'} completed for ${result.targets.length} target${result.targets.length === 1 ? '' : 's'}.`)
  } else {
    out.error('Deploy rollout found blocking issues.')
  }
}

function resolveRequestedTarget(profile?: string, target?: string): string | undefined {
  if (profile && target && profile !== target) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {profile, target},
      suggestion: 'Use either the positional target or --profile, or pass the same value to both.',
    })
  }

  return profile ?? target
}
