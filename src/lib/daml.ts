/**
 * @module daml
 *
 * SDK abstraction for invoking the Canton/Daml toolchain. Wraps the
 * underlying CLI tools (`dpm` current, `daml` legacy fallback) via a
 * {@link ProcessRunner}, enabling testability without subprocess mocking.
 *
 * The module auto-detects which tool is available on PATH, preferring
 * `dpm` (the Canton Package Manager) over the legacy `daml` CLI kept only
 * for older Canton 3.3-era projects.
 *
 * All long-running operations accept an {@link AbortSignal} for graceful
 * cancellation, and all errors are structured {@link CantonctlError} instances.
 *
 * @example
 * ```ts
 * import { createDamlSdk } from './daml.js'
 * import { createProcessRunner } from './process-runner.js'
 *
 * const sdk = createDamlSdk({ runner: createProcessRunner() })
 *
 * const info = await sdk.detect()
 * console.log(`Using ${info.tool} at ${info.path}`)
 *
 * await sdk.build({ projectDir: '/my-project' })
 * const sandbox = await sdk.startSandbox({ port: 5001, jsonApiPort: 7575 })
 * ```
 */

import type {ProcessRunner, SpawnedProcess} from './process-runner.js'
import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which CLI tool was detected. */
export type DamlTool = 'dpm' | 'daml'

/** Result of SDK detection. */
export interface SdkInfo {
  /** Which tool is available. */
  tool: DamlTool
  /** Absolute path to the tool binary. */
  path: string
  /** Version string reported by the tool. */
  version: string
}

/** Result of a build or test operation. */
export interface SdkCommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export interface BuildOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface TestOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Filter test names by pattern. */
  filter?: string
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface CodegenOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Target language for code generation. */
  language: 'ts' | 'java'
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface SandboxOptions {
  /** Canton participant port (default 5001). */
  port?: number
  /** JSON Ledger API port (default 7575). */
  jsonApiPort?: number
  /** Additional CLI arguments. */
  extraArgs?: string[]
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** SDK abstraction for Daml toolchain operations. */
export interface DamlSdk {
  /** Detect which SDK tool is available and return its info. */
  detect(): Promise<SdkInfo>
  /** Compile Daml sources into a DAR archive. */
  build(opts: BuildOptions): Promise<SdkCommandResult>
  /** Run Daml Script tests. */
  test(opts: TestOptions): Promise<SdkCommandResult>
  /** Generate TypeScript or Java bindings from compiled DAR. */
  codegen(opts: CodegenOptions): Promise<SdkCommandResult>
  /** Start a Canton sandbox as a long-running process. */
  startSandbox(opts: SandboxOptions): Promise<SpawnedProcess>
}

export interface DamlSdkOptions {
  /** Process runner for subprocess execution. */
  runner: ProcessRunner
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a {@link DamlSdk} instance backed by a {@link ProcessRunner}.
 *
 * @param options - Configuration including the process runner
 * @returns A DamlSdk that delegates to `dpm` or `daml` CLI tools
 */
export function createDamlSdk(options: DamlSdkOptions): DamlSdk {
  const {runner} = options
  let cachedTool: DamlTool | null = null

  function versionArgsFor(tool: DamlTool): string[] {
    return tool === 'dpm' ? ['version', '--active'] : ['version']
  }

  /** Detect which tool is on PATH, caching the result. */
  async function resolveTool(): Promise<DamlTool> {
    if (cachedTool) return cachedTool

    const dpmPath = await runner.which('dpm')
    if (dpmPath) {
      cachedTool = 'dpm'
      return 'dpm'
    }

    const damlPath = await runner.which('daml')
    if (damlPath) {
      cachedTool = 'daml'
      return 'daml'
    }

    throw new CantonctlError(ErrorCode.SDK_NOT_INSTALLED, {
      suggestion: 'Install DPM: curl https://get.digitalasset.com/install/install.sh | sh\n  Verify with: dpm version --active\n  Legacy Canton 3.3 only: install daml if you must run older projects.',
    })
  }

  return {
    async detect(): Promise<SdkInfo> {
      const tool = await resolveTool()
      const toolPath = (await runner.which(tool))!
      const result = await runner.run(tool, versionArgsFor(tool), {ignoreExitCode: true})
      return {
        path: toolPath,
        tool,
        version: result.stdout.trim() || result.stderr.trim(),
      }
    },

    async build(opts: BuildOptions): Promise<SdkCommandResult> {
      const tool = await resolveTool()
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const result = await runner.run(tool, ['build'], {
        cwd: opts.projectDir,
        ignoreExitCode: true,
      })

      if (result.exitCode !== 0) {
        throw new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {
          context: {exitCode: result.exitCode, stderr: result.stderr},
          suggestion: 'Check the Daml source files for compilation errors.',
        })
      }

      return {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        success: true,
      }
    },

    async test(opts: TestOptions): Promise<SdkCommandResult> {
      const tool = await resolveTool()
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const args = ['test']
      if (opts.filter) {
        args.push('--test-pattern', opts.filter)
      }

      const result = await runner.run(tool, args, {
        cwd: opts.projectDir,
        ignoreExitCode: true,
      })

      if (result.exitCode !== 0) {
        throw new CantonctlError(ErrorCode.TEST_EXECUTION_FAILED, {
          context: {exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout},
          suggestion: 'Review failing test output above.',
        })
      }

      return {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        success: true,
      }
    },

    async codegen(opts: CodegenOptions): Promise<SdkCommandResult> {
      const tool = await resolveTool()
      if (opts.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const result = await runner.run(tool, ['codegen', opts.language], {
        cwd: opts.projectDir,
        ignoreExitCode: true,
      })

      if (result.exitCode !== 0) {
        throw new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
          context: {command: `${tool} codegen ${opts.language}`, exitCode: result.exitCode, stderr: result.stderr},
          suggestion: `Code generation failed. Ensure the project builds successfully first with "${tool} build".`,
        })
      }

      return {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        success: true,
      }
    },

    async startSandbox(opts: SandboxOptions): Promise<SpawnedProcess> {
      const tool = await resolveTool()
      const port = opts.port ?? 5001
      const jsonApiPort = opts.jsonApiPort ?? 7575

      const args = tool === 'dpm'
        ? ['sandbox', '--ledger-api-port', String(port), '--json-api-port', String(jsonApiPort)]
        : ['sandbox', '--port', String(port), '--json-api-port', String(jsonApiPort)]
      if (opts.extraArgs) {
        args.push(...opts.extraArgs)
      }

      return runner.spawn(tool, args, {})
    },
  }
}
