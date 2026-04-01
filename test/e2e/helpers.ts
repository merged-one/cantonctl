/**
 * Shared helpers for E2E tests.
 *
 * Centralises SDK version, PATH resolution, and SDK detection so that
 * E2E tests work identically on macOS (Homebrew) and Linux (CI runners).
 */

import * as os from 'node:os'
import * as path from 'node:path'
import {execSync} from 'node:child_process'

/** Pinned SDK version used across all E2E tests. */
export const SDK_VERSION = '3.4.11'

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
