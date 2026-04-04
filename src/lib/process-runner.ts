/**
 * @module process-runner
 *
 * Abstraction over subprocess execution. Every cantonctl module that needs
 * to shell out to external tools (dpm, daml, docker) uses this interface
 * rather than calling execa directly. This enables:
 *
 * 1. **Testability** — Tests inject mock runners instead of mocking execa globally
 * 2. **Consistent error handling** — All subprocess errors wrapped in CantonctlError
 * 3. **Logging** — Subprocess invocations can be traced for debugging
 *
 * @example
 * ```ts
 * const runner = createProcessRunner()
 * const result = await runner.run('dpm', ['build'])
 * console.log(result.stdout)
 *
 * // For long-running processes (sandbox, dev server):
 * const proc = runner.spawn('dpm', ['sandbox', '--port', '5001'])
 * proc.onExit((code) => console.log(`Exited with ${code}`))
 * ```
 */

import {existsSync} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {execSync} from 'node:child_process'
import {execa, type Options as ExecaOptions, type ResultPromise} from 'execa'

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SpawnedProcess {
  pid: number | undefined
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): void
  onExit(callback: (code: number | null) => void): void
  /** Wait for the process to exit after kill(). Resolves with exit code. */
  waitForExit(): Promise<number | null>
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  /** If true, don't throw on non-zero exit code. */
  ignoreExitCode?: boolean
}

export interface ProcessRunner {
  /** Execute a command and wait for completion. */
  run(cmd: string, args: string[], opts?: RunOptions): Promise<ProcessResult>
  /** Start a long-running process. */
  spawn(cmd: string, args: string[], opts?: RunOptions): SpawnedProcess
  /** Check if a command exists on PATH. Returns the path or null. */
  which(cmd: string): Promise<string | null>
}

export interface ProcessRunnerDeps {
  env?: NodeJS.ProcessEnv
  execa?: typeof execa
  execSync?: typeof execSync
  existsSync?: typeof existsSync
  homedir?: typeof os.homedir
  platform?: typeof os.platform
  processKill?: typeof process.kill
}

// ---------------------------------------------------------------------------
// Java discovery
// ---------------------------------------------------------------------------

/**
 * Resolve JAVA_HOME through standard discovery mechanisms.
 *
 * Every JVM-based tool (Gradle, Maven, IntelliJ, the `daml` CLI itself) must
 * solve this problem. The resolution order mirrors industry convention:
 *
 *   1. `JAVA_HOME` env var — set by CI (actions/setup-java), sdkman, asdf, SDKMAN
 *   2. `/usr/libexec/java_home -v 21` — macOS Java registry (Apple, Adoptium installers)
 *   3. Well-known Homebrew paths — `/opt/homebrew/opt/openjdk@21` (ARM) and
 *      `/usr/local/opt/openjdk@21` (Intel). Homebrew installs don't register with
 *      the macOS java_home framework, so explicit probing is necessary.
 *   4. Fall through — Java must already be on PATH (Linux package managers put
 *      java in /usr/bin which is always on PATH).
 *
 * Returns the path to `JAVA_HOME/bin`, or null if Java cannot be found.
 *
 * This function runs once at module init (not per-subprocess), so the cost of
 * the fallback probes is paid only once.
 */
function resolveJavaBinDir(deps: ProcessRunnerDeps): string | null {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? os.platform
  const execaExistsSync = deps.existsSync ?? existsSync
  const execSyncImpl = deps.execSync ?? execSync

  // 1. JAVA_HOME (CI, sdkman, asdf, manual export)
  if (env.JAVA_HOME) {
    return path.join(env.JAVA_HOME, 'bin')
  }

  // 2. macOS java_home utility (Apple/Adoptium installers register here)
  if (platform() === 'darwin') {
    try {
      const home = execSyncImpl('/usr/libexec/java_home -v 21', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5_000,
      }).toString().trim()
      if (home && execaExistsSync(path.join(home, 'bin', 'java'))) {
        return path.join(home, 'bin')
      }
    } catch {
      // java_home not available or no JDK registered — fall through
    }
  }

  // 3. Homebrew well-known paths (Homebrew doesn't register with java_home)
  //    These paths are stable across Homebrew versions and are the documented
  //    install locations: https://formulae.brew.sh/formula/openjdk@21
  const homebrewPaths = platform() === 'darwin' ? [
    '/opt/homebrew/opt/openjdk@21',   // ARM (Apple Silicon)
    '/usr/local/opt/openjdk@21',      // Intel
  ] : []

  for (const brewPath of homebrewPaths) {
    const binDir = path.join(brewPath, 'bin')
    if (execaExistsSync(path.join(binDir, 'java'))) {
      return binDir
    }
  }

  // 4. Fall through — java must already be on PATH
  return null
}

/**
 * Create a ProcessRunner backed by execa.
 * In production, call with no arguments. In tests, provide a mock implementation.
 */
export function createProcessRunner(deps: ProcessRunnerDeps = {}): ProcessRunner {
  const baseEnv = deps.env ?? process.env
  const execaImpl = deps.execa ?? execa
  const homedir = deps.homedir ?? os.homedir
  const javaBinDir = resolveJavaBinDir(deps)
  const processKill = deps.processKill ?? process.kill
  const platform = deps.platform ?? os.platform

  const defaultToolPaths = [
    path.join(homedir(), '.daml', 'bin'),
    ...(javaBinDir ? [javaBinDir] : []),
  ]

  function resolveEnv(overrides?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {}

    for (const [key, value] of Object.entries(baseEnv)) {
      if (typeof value === 'string') {
        env[key] = value
      }
    }

    for (const [key, value] of Object.entries(overrides ?? {})) {
      env[key] = value
    }

    const currentPath = env.PATH ?? ''
    const pathEntries = currentPath.split(path.delimiter).filter(Boolean)
    const extras = defaultToolPaths.filter(entry => !pathEntries.includes(entry))
    env.PATH = [...extras, ...pathEntries].join(path.delimiter)

    return env
  }

  function normalizeOutput(value: string | string[] | unknown[] | Uint8Array | undefined): string {
    if (typeof value === 'string') {
      return value
    }

    if (value instanceof Uint8Array) {
      return Buffer.from(value).toString('utf8')
    }

    if (Array.isArray(value)) {
      return value.map(part => typeof part === 'string' ? part : String(part)).join('')
    }

    return ''
  }

  return {
    async run(cmd: string, args: string[], opts?: RunOptions): Promise<ProcessResult> {
      const execaOpts: ExecaOptions = {
        cwd: opts?.cwd,
        env: resolveEnv(opts?.env),
        reject: !opts?.ignoreExitCode,
        timeout: opts?.timeout,
      }

      try {
        const result = await execaImpl(cmd, args, execaOpts)
        return {
          exitCode: result.exitCode ?? 0,
          stderr: normalizeOutput(result.stderr),
          stdout: normalizeOutput(result.stdout),
        }
      } catch (error: unknown) {
        // execa throws an error object with stdout/stderr/exitCode
        const execaError = error as {exitCode?: number; stderr?: string; stdout?: string}
        if (execaError.exitCode !== undefined) {
          return {
            exitCode: execaError.exitCode ?? 1,
            stderr: execaError.stderr ?? '',
            stdout: execaError.stdout ?? '',
          }
        }

        throw error
      }
    },

    spawn(cmd: string, args: string[], opts?: RunOptions): SpawnedProcess {
      const supportsProcessGroups = platform() !== 'win32'
      const proc: ResultPromise = execaImpl(cmd, args, {
        cleanup: true,
        cwd: opts?.cwd,
        detached: supportsProcessGroups,
        env: resolveEnv(opts?.env),
        forceKillAfterDelay: 5000,
        reject: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const exitCallbacks: Array<(code: number | null) => void> = []
      const exitPromise = proc.then(result => {
        const code = result.exitCode ?? null
        for (const cb of exitCallbacks) cb(code)
        return code
      }).catch(() => {
        for (const cb of exitCallbacks) cb(1)
        return 1 as number | null
      })

      return {
        kill(signal: NodeJS.Signals = 'SIGTERM') {
          if (supportsProcessGroups && typeof proc.pid === 'number') {
            try {
              processKill(-proc.pid, signal)
            } catch {
              // Fall through to direct child kill when process-group signaling fails.
            }
          }

          proc.kill(signal)
        },
        onExit(callback: (code: number | null) => void) {
          exitCallbacks.push(callback)
        },
        waitForExit() {
          return exitPromise
        },
        get pid() {
          return proc.pid
        },
        get stderr() {
          return proc.stderr
        },
        get stdout() {
          return proc.stdout
        },
      }
    },

    async which(cmd: string): Promise<string | null> {
      try {
        const result = await execaImpl('which', [cmd], {
          env: resolveEnv(),
          reject: false,
        })
        if (result.exitCode === 0 && result.stdout.trim()) {
          return result.stdout.trim()
        }

        return null
      } catch {
        return null
      }
    },
  }
}
