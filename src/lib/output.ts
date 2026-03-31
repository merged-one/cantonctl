/**
 * @module output
 *
 * Structured output system for cantonctl. Provides a unified interface for
 * all CLI output, supporting two modes:
 *
 * - **Human mode** (default): Colored text, spinners, tables, progress indicators
 * - **JSON mode** (`--json`): Machine-readable JSON to stdout, no ANSI codes
 *
 * The output writer respects the `NO_COLOR` environment variable and non-TTY
 * detection per the CLI UX best practices spec (https://no-color.org/).
 *
 * @example
 * ```ts
 * const out = createOutput({ json: false })
 * out.success('Build complete')
 * out.table([{ name: 'Alice', role: 'operator' }])
 *
 * const jsonOut = createOutput({ json: true })
 * jsonOut.result({ success: true, data: { packageId: 'abc123' } })
 * // Outputs: {"success":true,"data":{"packageId":"abc123"}}
 * ```
 */

import Table from 'cli-table3'
import ora, {type Ora} from 'ora'
import pc from 'picocolors'

export interface OutputOptions {
  /** Emit JSON to stdout instead of human-formatted output. */
  json?: boolean
  /** Suppress all non-error output. */
  quiet?: boolean
  /** Force disable colors (also set by NO_COLOR env var). */
  noColor?: boolean
}

export interface CommandResult<T = unknown> {
  success: boolean
  data?: T
  error?: {code: string; message: string; suggestion?: string}
  warnings?: string[]
  timing?: {durationMs: number}
}

export interface OutputWriter {
  /** Print an error message to stderr. */
  error(msg: string): void
  /** Print an informational message. */
  info(msg: string): void
  /** Print a plain message to stdout. */
  log(msg: string): void
  /** Emit a structured result (JSON in json mode, formatted in human mode). */
  result<T>(result: CommandResult<T>): void
  /** Start a spinner (returns no-op in json/quiet mode). */
  spinner(msg: string): Ora
  /** Print a success message with checkmark. */
  success(msg: string): void
  /** Render data as a table. */
  table(headers: string[], rows: string[][]): void
  /** Print a warning message. */
  warn(msg: string): void
}

/**
 * Create an OutputWriter configured for the current environment.
 *
 * @param options - Output configuration
 * @returns A configured OutputWriter instance
 */
export function createOutput(options: OutputOptions = {}): OutputWriter {
  const isJson = options.json ?? false
  const isQuiet = options.quiet ?? false
  const useColor = !options.noColor && !process.env.NO_COLOR && process.stdout.isTTY !== false

  const color = useColor ? pc : {
    bold: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  }

  return {
    error(msg: string) {
      if (isJson) return
      process.stderr.write(`${color.red('Error:')} ${msg}\n`)
    },

    info(msg: string) {
      if (isJson || isQuiet) return
      process.stdout.write(`${color.dim(msg)}\n`)
    },

    log(msg: string) {
      if (isJson || isQuiet) return
      process.stdout.write(`${msg}\n`)
    },

    result<T>(result: CommandResult<T>) {
      if (isJson) {
        process.stdout.write(JSON.stringify(result) + '\n')
        return
      }

      if (result.success && result.data) {
        if (typeof result.data === 'string') {
          process.stdout.write(`${result.data}\n`)
        } else {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n')
        }
      }

      if (result.warnings) {
        for (const w of result.warnings) {
          process.stdout.write(`${color.yellow('Warning:')} ${w}\n`)
        }
      }

      if (!result.success && result.error) {
        process.stderr.write(`${color.red(`Error ${result.error.code}:`)} ${result.error.message}\n`)
        if (result.error.suggestion) {
          process.stderr.write(`  ${color.dim('Suggestion:')} ${result.error.suggestion}\n`)
        }
      }

      if (result.timing) {
        process.stdout.write(`${color.dim(`Done in ${(result.timing.durationMs / 1000).toFixed(1)}s`)}\n`)
      }
    },

    spinner(msg: string): Ora {
      if (isJson || isQuiet || !useColor) {
        // Return a no-op spinner that won't corrupt output
        return ora({isEnabled: false, text: msg})
      }

      return ora(msg).start()
    },

    success(msg: string) {
      if (isJson || isQuiet) return
      process.stdout.write(`${color.green('✓')} ${msg}\n`)
    },

    table(headers: string[], rows: string[][]) {
      if (isJson) {
        const objects = rows.map(row =>
          Object.fromEntries(headers.map((h, i) => [h, row[i]])),
        )
        process.stdout.write(JSON.stringify(objects) + '\n')
        return
      }

      if (isQuiet) return

      const table = new Table({
        head: headers.map(h => color.bold(h)),
        style: {'padding-left': 1, 'padding-right': 1},
      })
      for (const row of rows) {
        table.push(row)
      }

      process.stdout.write(table.toString() + '\n')
    },

    warn(msg: string) {
      if (isJson || isQuiet) return
      process.stderr.write(`${color.yellow('Warning:')} ${msg}\n`)
    },
  }
}
