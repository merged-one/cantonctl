/**
 * Shared helpers for E2E tests.
 *
 * Centralises SDK version, PATH resolution, SDK detection, and Docker
 * detection so that E2E tests work identically on macOS and Linux CI runners.
 */

import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {execSync} from 'node:child_process'

import {CI_TOOLCHAIN} from '../../scripts/ci/manifest.js'

/** Pinned SDK version used across all E2E tests. */
export const SDK_VERSION = CI_TOOLCHAIN.damlSdkVersion

/** Canton Docker image used by `dev --net` and Docker E2E tests. */
export const CANTON_IMAGE = CI_TOOLCHAIN.cantonImage

/**
 * Build a PATH that includes the current SDK CLI and Java 21.
 *
 * Uses the same Java discovery logic as `createProcessRunner()` in
 * `src/lib/process-runner.ts` — see `resolveJavaBinDir()` there for the
 * full resolution algorithm and justification.
 *
 * This function is used by `execSync`-based helpers (`hasSdk()` and
 * `resolveSdkCommand()`) which
 * need a plain string PATH. The actual E2E tests use `createProcessRunner()`
 * directly, so Java discovery is exercised through the same production path.
 *
 * Resolution order (mirrors process-runner.ts):
 *   1. JAVA_HOME/bin (CI, sdkman, asdf)
 *   2. /usr/libexec/java_home -v 21 (macOS Apple/Adoptium installers)
 *   3. Homebrew openjdk@21 well-known paths (ARM + Intel, existence-checked)
 *   4. ~/.dpm/bin
 *   5. ~/.daml/bin
 *   6. System PATH
 */
export function resolveE2ePath(): string {
  const fs = require('fs') as typeof import('fs')
  const dpmPath = path.join(os.homedir(), '.dpm', 'bin')
  const damlPath = path.join(os.homedir(), '.daml', 'bin')

  const javaPaths: string[] = []

  // 1. JAVA_HOME
  if (process.env.JAVA_HOME) {
    javaPaths.push(path.join(process.env.JAVA_HOME, 'bin'))
  }

  // 2. macOS java_home utility
  if (process.platform === 'darwin') {
    try {
      const home = execSync('/usr/libexec/java_home -v 21', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      }).toString().trim()
      if (home && fs.existsSync(path.join(home, 'bin', 'java'))) {
        javaPaths.push(path.join(home, 'bin'))
      }
    } catch { /* not registered — fall through */ }
  }

  // 3. Homebrew well-known paths (existence-checked, not blindly added)
  if (process.platform === 'darwin') {
    for (const brewBase of ['/opt/homebrew/opt/openjdk@21', '/usr/local/opt/openjdk@21']) {
      const binDir = path.join(brewBase, 'bin')
      if (fs.existsSync(path.join(binDir, 'java'))) {
        javaPaths.push(binDir)
      }
    }
  }

  return [...javaPaths, dpmPath, damlPath, process.env.PATH].filter(Boolean).join(path.delimiter)
}

/** The resolved PATH for subprocess execution. */
export const ENV_PATH = resolveE2ePath()

export type E2eSdkCommand = 'daml' | 'dpm'

/** Resolve the current SDK command for E2E subprocesses. */
export function resolveSdkCommand(): E2eSdkCommand | null {
  try {
    execSync('dpm version --active', {
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
    })
    return 'dpm'
  } catch {
    // fall through to legacy `daml` detection
  }

  try {
    execSync('daml version --no-legacy-assistant-warning', {
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
    })
    return 'daml'
  } catch {
    return null
  }
}

/** The SDK command available to E2E subprocesses, if any. */
export const SDK_COMMAND = resolveSdkCommand()

/** Check if a supported SDK CLI is available on the resolved PATH. */
export function hasSdk(): boolean {
  return SDK_COMMAND !== null
}

/**
 * Check if Docker and Docker Compose (v2) are available.
 * Mirrors the check in `src/lib/docker.ts` DockerManager.checkAvailable().
 */
export function hasDocker(): boolean {
  try {
    execSync('docker compose version', {stdio: 'pipe', timeout: 10_000})
    return true
  } catch {
    return false
  }
}

/**
 * Check if the Canton Docker image is available locally.
 * Does NOT pull — only checks the local image cache.
 * The CI job pre-pulls the image; local devs must have pulled it previously.
 */
export function hasCantonImage(): boolean {
  try {
    const result = execSync(`docker image inspect ${CANTON_IMAGE}`, {
      stdio: 'pipe',
      timeout: 10_000,
    })
    return result.length > 0
  } catch {
    return false
  }
}

/**
 * Create an E2E temp directory.
 *
 * `dev --net` writes Docker bind-mounted config files into this directory.
 * When local CI parity runs inside a container with the host Docker socket,
 * those bind mounts must point at a host-backed path rather than container-
 * private `/tmp`, so the Docker daemon can see the generated files.
 */
export function createE2eTempDir(prefix: string): string {
  const tempRoot = process.env.CANTONCTL_E2E_TMPDIR

  if (tempRoot) {
    fs.mkdirSync(tempRoot, {recursive: true})
    return fs.mkdtempSync(path.join(tempRoot, prefix))
  }

  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

async function canBindE2ePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}

function getAllocatedDockerHostPorts(): Set<number> {
  try {
    const output = execSync("docker ps --format '{{.Ports}}'", {
      stdio: 'pipe',
      timeout: 10_000,
    }).toString()

    const ports = new Set<number>()
    for (const match of output.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
      const start = Number.parseInt(match[1] ?? '0', 10)
      const end = Number.parseInt(match[2] ?? match[1] ?? '0', 10)

      for (let port = start; port <= end; port += 1) {
        ports.add(port)
      }
    }

    return ports
  } catch {
    return new Set<number>()
  }
}

/**
 * Find a free consecutive host port block for Docker-backed E2E suites.
 *
 * Docker E2E jobs reuse the host Docker daemon across suites and Node versions,
 * so fixed host ports can collide with stale containers from earlier runs.
 * Reserving a free block up front keeps each suite isolated while preserving
 * the stable offset layout expected by the topology fixtures.
 */
export async function findAvailableE2ePortBase(
  span: number,
  options: {end?: number; start?: number; step?: number} = {},
): Promise<number> {
  const start = options.start ?? 20_000
  const end = options.end ?? 40_000
  const step = options.step ?? 100
  const dockerHostPorts = getAllocatedDockerHostPorts()

  for (let base = start; base + span <= end; base += step) {
    const ports = Array.from({length: span}, (_, index) => base + index)

    if (ports.some(port => dockerHostPorts.has(port))) {
      continue
    }

    const availability = await Promise.all(ports.map(port => canBindE2ePort(port)))

    if (availability.every(Boolean)) {
      return base
    }
  }

  throw new Error(`Could not find a free E2E port block of size ${span} between ${start} and ${end}.`)
}
