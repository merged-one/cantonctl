/**
 * Shared helpers for E2E tests.
 *
 * Centralises SDK version, PATH resolution, SDK detection, and Docker
 * detection so that E2E tests work identically on macOS and Linux CI runners.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import {execSync} from 'node:child_process'

/** Pinned SDK version used across all E2E tests. */
export const SDK_VERSION = '3.4.11'

/** Canton Docker image used by `dev --full` and Docker E2E tests. */
export const CANTON_IMAGE = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'

/**
 * Build a PATH that includes the Daml SDK and Java 21, resolving
 * platform-specific install locations automatically.
 *
 * Resolution order for Java:
 *   1. JAVA_HOME/bin  (set by actions/setup-java, sdkman, asdf)
 *   2. /opt/homebrew/opt/openjdk@21/bin  (macOS ARM Homebrew)
 *   3. /usr/local/opt/openjdk@21/bin     (macOS Intel Homebrew)
 *   4. Whatever is already on PATH       (Linux package managers)
 */
export function resolveE2ePath(): string {
  const damlPath = path.join(os.homedir(), '.daml', 'bin')

  const javaPaths: string[] = []
  if (process.env.JAVA_HOME) {
    javaPaths.push(path.join(process.env.JAVA_HOME, 'bin'))
  }
  javaPaths.push(
    '/opt/homebrew/opt/openjdk@21/bin',
    '/usr/local/opt/openjdk@21/bin',
  )

  return [...javaPaths, damlPath, process.env.PATH].filter(Boolean).join(path.delimiter)
}

/** The resolved PATH for subprocess execution. */
export const ENV_PATH = resolveE2ePath()

/** Check if the Daml SDK is available on the resolved PATH. */
export function hasDaml(): boolean {
  try {
    execSync('daml version --no-legacy-assistant-warning', {
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
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
