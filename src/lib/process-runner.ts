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

/**
 * Create a ProcessRunner backed by execa.
 * In production, call with no arguments. In tests, provide a mock implementation.
 */
export function createProcessRunner(): ProcessRunner {
  return {
    async run(cmd: string, args: string[], opts?: RunOptions): Promise<ProcessResult> {
      const execaOpts: ExecaOptions = {
        cwd: opts?.cwd,
        env: opts?.env,
        reject: !opts?.ignoreExitCode,
        timeout: opts?.timeout,
      }

      try {
        const result = await execa(cmd, args, execaOpts)
        return {
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
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
      const proc: ResultPromise = execa(cmd, args, {
        cwd: opts?.cwd,
        env: opts?.env,
        reject: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const exitCallbacks: Array<(code: number | null) => void> = []
      proc.then(result => {
        for (const cb of exitCallbacks) cb(result.exitCode)
      }).catch(() => {
        for (const cb of exitCallbacks) cb(1)
      })

      return {
        kill(signal: NodeJS.Signals = 'SIGTERM') {
          proc.kill(signal)
        },
        onExit(callback: (code: number | null) => void) {
          exitCallbacks.push(callback)
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
        const result = await execa('which', [cmd], {reject: false})
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

