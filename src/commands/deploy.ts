/**
 * @module commands/deploy
 *
 * Deploys .dar packages to a Canton network. Thin oclif wrapper over
 * {@link createDeployer}.
 */

import {Args, Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {createBuilder} from '../lib/builder.js'
import {loadConfig} from '../lib/config.js'
import {createDamlSdk} from '../lib/daml.js'
import {createDeployer} from '../lib/deployer.js'
import {CantonctlError} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {createPluginHookManager} from '../lib/plugin-hooks.js'
import {createProcessRunner} from '../lib/process-runner.js'

const NETWORKS = ['local', 'devnet', 'testnet', 'mainnet'] as const

/** Find the first .dar file in a directory. */
async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const darFile = entries.find(e => e.endsWith('.dar'))
    return darFile ? path.join(dir, darFile) : null
  } catch {
    return null
  }
}

/** Get file modification time in ms since epoch. */
async function getFileMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    return stat.mtimeMs
  } catch {
    return null
  }
}

/** Get the newest mtime among all .daml files in a directory (recursive). */
async function getDamlSourceMtime(dir: string): Promise<number> {
  let newest = 0
  try {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true})
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = await getDamlSourceMtime(fullPath)
        if (sub > newest) newest = sub
      } else if (entry.name.endsWith('.daml')) {
        const stat = await fs.promises.stat(fullPath)
        if (stat.mtimeMs > newest) newest = stat.mtimeMs
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return newest
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

    try {
      const config = await loadConfig()
      const runner = createProcessRunner()
      const sdk = createDamlSdk({runner})
      const hooks = createPluginHookManager()
      const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, hooks, sdk})

      const deployer = createDeployer({
        builder,
        config,
        createLedgerClient,
        createToken: createSandboxToken,
        fs: {readFile: (p: string) => fs.promises.readFile(p)},
        hooks,
        output: out,
      })

      out.log(`Deploying to ${args.network}...`)
      out.log('')

      const result = await deployer.deploy({
        darPath: flags.dar,
        dryRun: flags['dry-run'],
        network: args.network ?? 'local',
        party: flags.party,
        projectDir: process.cwd(),
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
