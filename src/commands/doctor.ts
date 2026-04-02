/**
 * @module commands/doctor
 *
 * Environment diagnostics — checks all prerequisites and reports status.
 * Offers to install missing required dependencies (Daml SDK).
 * Thin oclif wrapper over {@link createDoctor}.
 */

import {Command, Flags} from '@oclif/core'
import {execSync} from 'node:child_process'
import * as readline from 'node:readline'
import pc from 'picocolors'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {resolveProfile} from '../lib/compat.js'
import {createDoctor, type CheckResult} from '../lib/doctor.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'

const BANNER = `
   ___          _                  _   _
  / __\\__ _ _ __ | |_ ___  _ __   ___| |_| |
 / /  / _\` | '_ \\| __/ _ \\| '_ \\ / __| __| |
/ /__| (_| | | | | || (_) | | | | (__| |_| |
\\____/\\__,_|_| |_|\\__\\___/|_| |_|\\___|\\__|_|
`

export default class Doctor extends Command {
  static override description = 'Check your development environment for prerequisites'

  static override examples = [
    '<%= config.bin %> doctor',
    '<%= config.bin %> doctor --json',
    '<%= config.bin %> doctor --fix',
  ]

  static override flags = {
    fix: Flags.boolean({
      default: false,
      description: 'Offer to install missing dependencies',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    profile: Flags.string({
      description: 'Run profile-aware diagnostics for the selected profile',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const out = createOutput({json: flags.json})
    const runner = this.createRunner()

    let config: CantonctlConfig | undefined
    try {
      config = await this.loadProjectConfig()
    } catch (err) {
      if (!(err instanceof CantonctlError)) {
        throw err
      }

      if (flags.profile || err.code !== ErrorCode.CONFIG_NOT_FOUND) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }
    }

    const doctor = createDoctor({
      config,
      output: out,
      profileName: flags.profile,
      runner,
    })

    if (!flags.json && process.stdout.isTTY) {
      process.stdout.write(pc.cyan(BANNER))
      process.stdout.write(pc.dim('  Institutional-grade CLI toolchain for Canton Network\n'))
    }

    if (!flags.json) {
      out.log('')
      out.log('Checking your development environment...')
      out.log('')
    }

    const result = await doctor.check()
    const resolvedProfile = config
      ? this.resolveProfileSummary(config, flags.profile)
      : undefined

    if (!flags.json) {
      for (const check of result.checks) {
        this.printCheck(check)
      }

      out.log('')
      const total = result.checks.length
      const summary = `${result.passed}/${total} checks passed`
      if (result.failed > 0) {
        out.error(`${summary} (${result.failed} required ${result.failed === 1 ? 'check' : 'checks'} failed)`)
      } else if (result.warned > 0) {
        out.warn(`${summary} (${result.warned} optional)`)
      } else {
        out.success(summary)
      }

      // Offer to install missing SDK
      if (flags.fix || process.stdout.isTTY) {
        const sdkCheck = result.checks.find(c => c.name === 'Daml SDK' && c.status === 'fail')
        if (sdkCheck) {
          out.log('')
          const shouldInstall = flags.fix || await this.confirm('Daml SDK is missing. Install it now? (y/N) ')
          if (shouldInstall) {
            out.log('')
            out.info('Installing Daml SDK 3.4.11...')
            try {
              execSync('curl -sSL https://get.daml.com/ | sh -s 3.4.11', {
                stdio: 'inherit',
                timeout: 300_000,
              })
              out.success('Daml SDK installed. Run "cantonctl doctor" again to verify.')
            } catch {
              out.error('SDK installation failed. Install manually: curl -sSL https://get.daml.com/ | sh -s 3.4.11')
            }
          }
        }
      }
    }

    if (flags.json) {
      out.result({
        data: {
          checks: result.checks.map(c => ({
            detail: c.detail,
            fix: c.fix,
            name: c.name,
            required: c.required,
            status: c.status,
          })),
          failed: result.failed,
          passed: result.passed,
          profile: resolvedProfile,
          warned: result.warned,
        },
        success: result.failed === 0,
      })
    }

    if (result.failed > 0) {
      this.exit(1)
    }
  }

  private async confirm(message: string): Promise<boolean> {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout})
    return new Promise((resolve) => {
      rl.question(message, (answer) => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected resolveProfileSummary(
    config: CantonctlConfig,
    profileName?: string,
  ): {experimental: boolean; kind: string; name: string} | undefined {
    try {
      const {profile} = resolveProfile(config, profileName)
      return {
        experimental: profile.experimental,
        kind: profile.kind,
        name: profile.name,
      }
    } catch {
      return undefined
    }
  }

  private printCheck(check: CheckResult): void {
    const icon = check.status === 'pass' ? pc.green('✓')
      : check.status === 'warn' ? pc.yellow('⚠')
        : pc.red('✗')
    const label = check.name.padEnd(16)
    const detail = check.status === 'fail' ? pc.red(check.detail) : pc.dim(check.detail)
    const tag = check.required ? '' : pc.dim(' (optional)')

    process.stdout.write(`  ${icon} ${label}${detail}${tag}\n`)

    if (check.fix) {
      process.stdout.write(`    ${pc.dim('→')} ${pc.cyan(check.fix)}\n`)
    }
  }
}
