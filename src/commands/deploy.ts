/**
 * @module commands/deploy
 *
 * Deploys .dar packages to a Canton network. Thin oclif wrapper over
 * {@link createDeployer}.
 */

import {Args, Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'

import {createBuilder, type Builder} from '../lib/builder.js'
import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {createDamlSdk, type DamlSdk} from '../lib/daml.js'
import {createDeployer, type Deployer} from '../lib/deployer.js'
import {CantonctlError} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createPluginHookManager, type PluginHookManager} from '../lib/plugin-hooks.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'
import {findDarFile, getFileMtime, getNewestDamlSourceMtime} from '../lib/runtime-support.js'
import {detectTopology, type GeneratedTopology} from '../lib/topology.js'

const NETWORKS = ['local', 'devnet', 'testnet', 'mainnet'] as const

interface DeployArgs {
  network?: string
}

interface DeployFlags {
  dar?: string
  'dry-run': boolean
  json: boolean
  party?: string
}

export default class Deploy extends Command {
  static override args = {
    network: Args.string({
      default: 'local',
      description: 'Target network',
      options: [...NETWORKS],
    }),
  }

  static override description = 'Deploy .dar packages to a Canton network'

  static override examples = [
    '<%= config.bin %> deploy',
    '<%= config.bin %> deploy devnet',
    '<%= config.bin %> deploy testnet --dar ./my-app.dar',
    '<%= config.bin %> deploy --dry-run',
    '<%= config.bin %> deploy --json',
  ]

  static override flags = {
    dar: Flags.string({
      description: 'Path to .dar file (default: auto-detected from .daml/dist/)',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Simulate deployment without uploading',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    party: Flags.string({
      description: 'Deploying party (default: from cantonctl.yaml)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Deploy)
    const out = createOutput({json: flags.json})

    await runDeployCommand({
      createBuilder: (deps) => this.createBuilder(deps),
      createHooks: () => this.createHooks(),
      createRunner: () => this.createRunner(),
      createSdk: (runner) => this.createSdk(runner),
      deployMultiNode: (config, builder, hooks, commandOut, commandFlags, networkName, topology, projectDir) =>
        this.deployMultiNode(config, builder, hooks, commandOut, commandFlags, networkName, topology, projectDir),
      deploySingleNode: (config, builder, hooks, commandOut, commandFlags, networkName, projectDir) =>
        this.deploySingleNode(config, builder, hooks, commandOut, commandFlags, networkName, projectDir),
      detectProjectTopology: (projectDir) => this.detectProjectTopology(projectDir),
      getProjectDir: () => this.getProjectDir(),
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
      loadProjectConfig: () => this.loadProjectConfig(),
      out,
    }, args, flags)
  }

  private async deployMultiNode(
    config: Awaited<ReturnType<typeof loadConfig>>,
    builder: ReturnType<typeof createBuilder>,
    hooks: ReturnType<typeof createPluginHookManager>,
    out: ReturnType<typeof createOutput>,
    flags: {dar?: string; 'dry-run': boolean; json: boolean; party?: string},
    networkName: string,
    topology: Awaited<ReturnType<typeof detectTopology>> & object,
    projectDir: string,
  ): Promise<void> {
    out.log(`Deploying to ${networkName} (multi-node: ${topology.participants.length} participants)...`)
    out.log('')

    const results: Array<{mainPackageId: string | null; participant: string; port: number}> = []
    for (const participant of topology.participants) {
      const baseUrl = `http://localhost:${participant.ports.jsonApi}`
      out.info(`Deploying to ${participant.name} (port ${participant.ports.jsonApi})...`)

      const deployer = this.createDeployer({
        builder,
        config: {
          ...config,
          networks: {
            ...config.networks,
            [networkName]: {
              ...config.networks?.[networkName],
              'json-api-port': participant.ports.jsonApi,
              type: 'sandbox' as const,
              url: baseUrl,
            },
          },
        },
        hooks,
        output: out,
      })

      const result = await deployer.deploy({
        darPath: flags.dar,
        dryRun: flags['dry-run'],
        network: networkName,
        party: flags.party,
        projectDir,
      })

      results.push({
        mainPackageId: result.mainPackageId ?? null,
        participant: participant.name,
        port: participant.ports.jsonApi,
      })
    }

    out.result({
      data: {
        dryRun: flags['dry-run'],
        mode: 'multi-node',
        network: networkName,
        participants: results,
      },
      success: true,
    })
  }

  private async deploySingleNode(
    config: Awaited<ReturnType<typeof loadConfig>>,
    builder: ReturnType<typeof createBuilder>,
    hooks: ReturnType<typeof createPluginHookManager>,
    out: ReturnType<typeof createOutput>,
    flags: {dar?: string; 'dry-run': boolean; json: boolean; party?: string},
    networkName: string,
    projectDir: string,
  ): Promise<void> {
    const deployer = this.createDeployer({builder, config, hooks, output: out})

    out.log(`Deploying to ${networkName}...`)
    out.log('')

    const result = await deployer.deploy({
      darPath: flags.dar,
      dryRun: flags['dry-run'],
      network: networkName,
      party: flags.party,
      projectDir,
    })

    out.result({
      data: {
        darPath: result.darPath,
        dryRun: result.dryRun,
        mainPackageId: result.mainPackageId,
        network: result.network,
      },
      success: true,
      timing: {durationMs: result.durationMs},
    })
  }

  protected createBuilder(deps: {hooks: PluginHookManager; sdk: DamlSdk}): Builder {
    return createBuilder({
      findDarFile,
      getDamlSourceMtime: getNewestDamlSourceMtime,
      getFileMtime,
      hooks: deps.hooks,
      sdk: deps.sdk,
    })
  }

  protected createDeployer(deps: {
    builder: Builder
    config: CantonctlConfig
    hooks: PluginHookManager
    output: ReturnType<typeof createOutput>
  }): Deployer {
    return createDeployer({
      builder: deps.builder,
      config: deps.config,
      createLedgerClient,
      createToken: createSandboxToken,
      fs: {readFile: (p: string) => fs.promises.readFile(p)},
      hooks: deps.hooks,
      output: deps.output,
    })
  }

  protected createHooks(): PluginHookManager {
    return createPluginHookManager()
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected createSdk(runner: ProcessRunner): DamlSdk {
    return createDamlSdk({runner})
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

async function runDeployCommand(
  command: {
    createBuilder: (deps: {hooks: PluginHookManager; sdk: DamlSdk}) => Builder
    createHooks: () => PluginHookManager
    createRunner: () => ProcessRunner
    createSdk: (runner: ProcessRunner) => DamlSdk
    deployMultiNode: (
      config: CantonctlConfig,
      builder: Builder,
      hooks: PluginHookManager,
      out: ReturnType<typeof createOutput>,
      flags: DeployFlags,
      networkName: string,
      topology: GeneratedTopology,
      projectDir: string,
    ) => Promise<void>
    deploySingleNode: (
      config: CantonctlConfig,
      builder: Builder,
      hooks: PluginHookManager,
      out: ReturnType<typeof createOutput>,
      flags: DeployFlags,
      networkName: string,
      projectDir: string,
    ) => Promise<void>
    detectProjectTopology: (projectDir: string) => Promise<GeneratedTopology | null>
    getProjectDir: () => string
    handleCommandError: (error: unknown) => never
    loadProjectConfig: () => Promise<CantonctlConfig>
    out: ReturnType<typeof createOutput>
  },
  args: DeployArgs,
  flags: DeployFlags,
): Promise<void> {
  try {
    const config = await command.loadProjectConfig()
    const runner = command.createRunner()
    const sdk = command.createSdk(runner)
    const hooks = command.createHooks()
    const builder = command.createBuilder({hooks, sdk})
    const projectDir = command.getProjectDir()

    const networkName = args.network ?? 'local'
    const topology = networkName === 'local' ? await command.detectProjectTopology(projectDir) : null

    if (topology && topology.participants.length > 0) {
      await command.deployMultiNode(config, builder, hooks, command.out, flags, networkName, topology, projectDir)
      return
    }

    await command.deploySingleNode(config, builder, hooks, command.out, flags, networkName, projectDir)
  } catch (error) {
    command.handleCommandError(error)
  }
}
