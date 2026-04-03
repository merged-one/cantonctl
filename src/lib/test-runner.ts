/**
 * @module test-runner
 *
 * Test execution orchestration for cantonctl. Wraps `DamlSdk.test()` with
 * structured output, ANSI stripping, and timing.
 *
 * Follows ADR-0012: capture exit code + passthrough output. We don't parse
 * individual test results from the SDK's stderr format (fragile). Instead,
 * we report pass/fail via exit code and forward the full output.
 *
 * @example
 * ```ts
 * const runner = createTestRunner({ sdk })
 * const result = await runner.run({ projectDir: '/my-app', filter: 'testMint' })
 * console.log(result.passed)   // true or false
 * console.log(result.output)   // SDK output with ANSI stripped
 * ```
 */

import type {DamlSdk} from './daml.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {PluginHookManager} from './plugin-hooks.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestRunnerDeps {
  /** Daml SDK abstraction. */
  sdk: DamlSdk
  /** Plugin hook manager for lifecycle events. */
  hooks?: PluginHookManager
}

export interface TestOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Filter test names by pattern. */
  filter?: string
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface TestResult {
  /** True if test command completed (even with failures). False on errors. */
  success: boolean
  /** True if all tests passed (exit code 0). */
  passed: boolean
  /** Combined stdout + stderr output with ANSI codes stripped. */
  output: string
  /** Test execution duration in milliseconds. */
  durationMs: number
}

export interface TestRunner {
  /** Run Daml Script tests. */
  run(opts: TestOptions): Promise<TestResult>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes from a string. */
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g

function formatOutput(stdout?: string, stderr?: string): string {
  return [stdout, stderr].filter(Boolean).join('\n').replace(ANSI_ESCAPE_PATTERN, '')
}

/**
 * Create a TestRunner that wraps DamlSdk.test() with structured results.
 */
export function createTestRunner(deps: TestRunnerDeps): TestRunner {
  return {
    run: (opts) => runTests(deps, opts),
  }
}

async function runTests(deps: TestRunnerDeps, opts: TestOptions): Promise<TestResult> {
  const {hooks, sdk} = deps
  const start = Date.now()

  if (hooks) {
    await hooks.emit('beforeTest', {filter: opts.filter, projectDir: opts.projectDir})
  }

  try {
    const result = await sdk.test({
      filter: opts.filter,
      projectDir: opts.projectDir,
      signal: opts.signal,
    })

    const output = formatOutput(result.stdout, result.stderr)
    const durationMs = Date.now() - start

    if (hooks) {
      await hooks.emit('afterTest', {durationMs, projectDir: opts.projectDir, success: true})
    }

    return {
      durationMs,
      output,
      passed: true,
      success: true,
    }
  } catch (err) {
    // Test failures are E5001 — return as failed result, don't throw
    if (err instanceof CantonctlError && err.code === ErrorCode.TEST_EXECUTION_FAILED) {
      const ctx = err.context as {stderr?: string; stdout?: string}
      const output = formatOutput(ctx.stdout, ctx.stderr)
      const durationMs = Date.now() - start

      if (hooks) {
        await hooks.emit('afterTest', {durationMs, projectDir: opts.projectDir, success: false})
      }

      return {
        durationMs,
        output,
        passed: false,
        success: false,
      }
    }

    // All other errors (SDK_NOT_INSTALLED, AbortError, etc.) propagate
    throw err
  }
}
