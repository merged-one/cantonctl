import {captureOutput} from '@oclif/test'

export const CLI_ROOT = process.cwd()

export async function runCommand<T extends {run(args: string[], options?: {root: string}): Promise<unknown>}>(
  command: T,
  args: string[],
): Promise<{error?: Error; json?: Record<string, unknown>; stderr: string; stdout: string}> {
  const result = await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  return {
    error: result.error,
    json: result.stdout.trim().length > 0 ? JSON.parse(result.stdout.trim()) as Record<string, unknown> : undefined,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}
