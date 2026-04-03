/**
 * @module doctor
 *
 * Environment diagnostics for cantonctl. Checks all prerequisites
 * (Node.js, Java, Daml SDK, Docker) and reports their status with
 * actionable fix suggestions.
 *
 * @example
 * ```ts
 * const doctor = createDoctor({ runner, output })
 * const result = await doctor.check()
 * console.log(result.passed) // 7
 * console.log(result.failed) // 1
 * ```
 */

import * as net from 'node:net'

import type {CantonctlConfig} from './config.js'
import {createCompatibilityReport} from './compat.js'
import type {OutputWriter} from './output.js'
import type {ProcessRunner} from './process-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = 'fail' | 'pass' | 'warn'

export interface CheckResult {
  /** Human-readable detail (e.g., version string). */
  detail: string
  /** Fix suggestion if not passing. */
  fix?: string
  /** Check name. */
  name: string
  /** Whether the check is required or optional. */
  required: boolean
  /** Pass, fail, or warn. */
  status: CheckStatus
}

export interface DoctorResult {
  checks: CheckResult[]
  failed: number
  passed: number
  warned: number
}

export interface DoctorDeps {
  config?: CantonctlConfig
  output: OutputWriter
  profileName?: string
  runner: ProcessRunner
  /** Override for testing — check if port is free. */
  checkPort?: (port: number) => Promise<boolean>
}

export interface Doctor {
  check(): Promise<DoctorResult>
}

// ---------------------------------------------------------------------------
// Port check utility
// ---------------------------------------------------------------------------

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDoctor(deps: DoctorDeps): Doctor {
  const {checkPort = isPortFree, config, output, profileName, runner} = deps

  return {
    async check(): Promise<DoctorResult> {
      const checks: CheckResult[] = []

      // 1. Node.js
      const nodeVersion = process.version
      const nodeMajor = Number.parseInt(nodeVersion.slice(1), 10)
      checks.push({
        detail: `${nodeVersion} ${nodeMajor >= 18 ? '' : '(requires ≥18)'}`.trim(),
        fix: nodeMajor < 18 ? 'Upgrade Node.js: https://nodejs.org' : undefined,
        name: 'Node.js',
        required: true,
        status: nodeMajor >= 18 ? 'pass' : 'fail',
      })

      // 2. Java 21
      const javaCheck = await checkJava(runner)
      checks.push(javaCheck)

      // 3. Daml SDK (dpm or daml)
      const sdkCheck = await checkSdk(runner)
      checks.push(sdkCheck)

      // 4. Docker
      const dockerCheck = await checkDocker(runner)
      checks.push(dockerCheck)

      // 5. Docker Compose
      const composeCheck = await checkDockerCompose(runner)
      checks.push(composeCheck)

      // 6. Canton Docker image
      const imageCheck = await checkCantonImage(runner)
      checks.push(imageCheck)

      // 7. Port 5001
      const port5001Free = await checkPort(5001)
      checks.push({
        detail: port5001Free ? 'Available' : 'In use',
        fix: port5001Free ? undefined : 'Another process is using port 5001. Use --port to specify a different port.',
        name: 'Port 5001',
        required: false,
        status: port5001Free ? 'pass' : 'warn',
      })

      // 8. Port 7575
      const port7575Free = await checkPort(7575)
      checks.push({
        detail: port7575Free ? 'Available' : 'In use',
        fix: port7575Free ? undefined : 'Another process is using port 7575. Use --json-api-port to specify a different port.',
        name: 'Port 7575',
        required: false,
        status: port7575Free ? 'pass' : 'warn',
      })

      if (config) {
        try {
          const report = createCompatibilityReport(config, profileName)
          checks.push({
            detail: `${report.profile.name} (${report.profile.kind})${report.profile.experimental ? ', experimental' : ''}`,
            name: 'Profile',
            required: false,
            status: report.profile.experimental ? 'warn' : 'pass',
          })

          for (const check of report.checks) {
            checks.push({
              detail: check.detail,
              fix: undefined,
              name: check.name,
              required: false,
              status: check.status,
            })
          }
        } catch {
          // Profile diagnostics are best-effort. Doctor should still report the
          // environment even when no resolvable profile is available.
        }
      }

      const passed = checks.filter(c => c.status === 'pass').length
      const failed = checks.filter(c => c.status === 'fail').length
      const warned = checks.filter(c => c.status === 'warn').length

      return {checks, failed, passed, warned}
    },
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkJava(runner: ProcessRunner): Promise<CheckResult> {
  try {
    const javaPath = await runner.which('java')
    if (!javaPath) {
      return {
        detail: 'Not found',
        fix: 'Install Java 21: brew install openjdk@21 (macOS) or sdk install java 21.0.5-tem',
        name: 'Java 21',
        required: true,
        status: 'fail',
      }
    }

    const result = await runner.run('java', ['-version'], {ignoreExitCode: true})
    const output = result.stderr || result.stdout
    const versionMatch = output.match(/version "(\d+)/)
    const majorVersion = versionMatch ? Number.parseInt(versionMatch[1], 10) : 0

    return {
      detail: output.split('\n')[0]?.trim() || 'Unknown version',
      fix: majorVersion < 21 ? 'Upgrade to Java 21: brew install openjdk@21' : undefined,
      name: 'Java 21',
      required: true,
      status: majorVersion >= 21 ? 'pass' : 'fail',
    }
  } catch {
    return {
      detail: 'Not found',
      fix: 'Install Java 21: brew install openjdk@21 (macOS) or sdk install java 21.0.5-tem',
      name: 'Java 21',
      required: true,
      status: 'fail',
    }
  }
}

async function checkSdk(runner: ProcessRunner): Promise<CheckResult> {
  // Try dpm first (preferred)
  const dpmPath = await runner.which('dpm')
  if (dpmPath) {
    try {
      const result = await runner.run('dpm', ['--version'], {ignoreExitCode: true})
      return {
        detail: `dpm ${result.stdout.trim() || 'installed'}`,
        name: 'Daml SDK',
        required: true,
        status: 'pass',
      }
    } catch { /* fall through */ }
  }

  // Try daml (legacy)
  const damlPath = await runner.which('daml')
  if (damlPath) {
    try {
      const result = await runner.run('daml', ['version'], {ignoreExitCode: true})
      const version = result.stdout.trim() || result.stderr.trim()
      return {
        detail: `daml ${version.split('\n')[0] || 'installed'}`,
        name: 'Daml SDK',
        required: true,
        status: 'pass',
      }
    } catch { /* fall through */ }
  }

  return {
    detail: 'Not found',
    fix: 'Install Daml SDK: curl -sSL https://get.daml.com/ | sh -s 3.4.11',
    name: 'Daml SDK',
    required: true,
    status: 'fail',
  }
}

async function checkDocker(runner: ProcessRunner): Promise<CheckResult> {
  try {
    const dockerPath = await runner.which('docker')
    if (!dockerPath) {
      return {
        detail: 'Not found',
        fix: 'Install Docker: https://docs.docker.com/get-docker/',
        name: 'Docker',
        required: false,
        status: 'warn',
      }
    }

    const result = await runner.run('docker', ['--version'], {ignoreExitCode: true})
    const detail = result.stdout.trim().replace('Docker version ', '').split(',')[0] || 'Installed'
    return {
      detail,
      name: 'Docker',
      required: false,
      status: result.exitCode === 0 ? 'pass' : 'warn',
    }
  } catch {
    return {
      detail: 'Not found',
      fix: 'Install Docker: https://docs.docker.com/get-docker/',
      name: 'Docker',
      required: false,
      status: 'warn',
    }
  }
}

async function checkDockerCompose(runner: ProcessRunner): Promise<CheckResult> {
  try {
    const result = await runner.run('docker', ['compose', 'version'], {ignoreExitCode: true})
    if (result.exitCode !== 0) {
      return {
        detail: 'Not available',
        fix: 'Install Docker Desktop (includes Compose): https://docs.docker.com/get-docker/',
        name: 'Docker Compose',
        required: false,
        status: 'warn',
      }
    }

    return {
      detail: result.stdout.trim().replace('Docker Compose version ', '') || 'Installed',
      name: 'Docker Compose',
      required: false,
      status: 'pass',
    }
  } catch {
    return {
      detail: 'Not available',
      fix: 'Install Docker Desktop (includes Compose): https://docs.docker.com/get-docker/',
      name: 'Docker Compose',
      required: false,
      status: 'warn',
    }
  }
}

async function checkCantonImage(runner: ProcessRunner): Promise<CheckResult> {
  const imageName = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton'
  const imageTag = '0.5.3'
  try {
    const result = await runner.run('docker', ['image', 'inspect', `${imageName}:${imageTag}`], {ignoreExitCode: true})
    if (result.exitCode === 0) {
      return {
        detail: `${imageTag}`,
        name: 'Canton image',
        required: false,
        status: 'pass',
      }
    }

    return {
      detail: 'Not found',
      fix: `docker pull ${imageName}:${imageTag}`,
      name: 'Canton image',
      required: false,
      status: 'warn',
    }
  } catch {
    return {
      detail: 'Cannot check (Docker not available)',
      name: 'Canton image',
      required: false,
      status: 'warn',
    }
  }
}
