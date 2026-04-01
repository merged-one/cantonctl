/**
 * @module docker
 *
 * Manages Docker Compose lifecycle for multi-node Canton topologies.
 * All subprocess calls go through an injected {@link ProcessRunner},
 * enabling full testability without Docker installed.
 *
 * Responsibilities:
 * - Check Docker availability (`docker compose version`)
 * - Start topology (`docker compose up -d`)
 * - Stop topology (`docker compose down`)
 * - Retrieve logs (`docker compose logs`)
 *
 * @example
 * ```ts
 * import { createDockerManager } from './docker.js'
 *
 * const docker = createDockerManager({ runner, output })
 * await docker.checkAvailable()
 * await docker.composeUp({ composeFile: '/path/to/docker-compose.yml' })
 * await docker.composeDown({ composeFile: '/path/to/docker-compose.yml' })
 * ```
 */

import {CantonctlError, ErrorCode} from './errors.js'
import type {OutputWriter} from './output.js'
import type {ProcessRunner} from './process-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DockerManagerDeps {
  /** Process runner for subprocess execution. */
  runner: ProcessRunner
  /** Output writer for status messages. */
  output: OutputWriter
}

export interface ComposeOptions {
  /** Absolute path to the Docker Compose file. */
  composeFile: string
  /** Working directory for Docker Compose commands. */
  cwd: string
}

export interface DockerManager {
  /** Check that Docker and Docker Compose are available. */
  checkAvailable(): Promise<void>
  /** Start the topology with `docker compose up -d`. */
  composeUp(opts: ComposeOptions): Promise<void>
  /** Stop and remove the topology with `docker compose down`. */
  composeDown(opts: ComposeOptions): Promise<void>
  /** Get logs from the canton service. */
  composeLogs(opts: ComposeOptions): Promise<string>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDockerManager(deps: DockerManagerDeps): DockerManager {
  const {output, runner} = deps

  return {
    async checkAvailable(): Promise<void> {
      try {
        const result = await runner.run('docker', ['compose', 'version'], {ignoreExitCode: true})
        if (result.exitCode !== 0) {
          throw new CantonctlError(ErrorCode.DOCKER_NOT_AVAILABLE, {
            suggestion: 'Install Docker Desktop: https://docs.docker.com/get-docker/\nEnsure Docker is running and "docker compose version" works.',
          })
        }

        output.info(`Docker Compose: ${result.stdout.trim()}`)
      } catch (err) {
        if (err instanceof CantonctlError) throw err
        throw new CantonctlError(ErrorCode.DOCKER_NOT_AVAILABLE, {
          cause: err instanceof Error ? err : undefined,
          suggestion: 'Install Docker Desktop: https://docs.docker.com/get-docker/\nEnsure Docker is running and "docker compose version" works.',
        })
      }
    },

    async composeUp(opts: ComposeOptions): Promise<void> {
      output.info('Starting multi-node Canton topology...')

      const result = await runner.run(
        'docker',
        ['compose', '-f', opts.composeFile, 'up', '-d', '--wait'],
        {cwd: opts.cwd, ignoreExitCode: true},
      )

      if (result.exitCode !== 0) {
        throw new CantonctlError(ErrorCode.DOCKER_COMPOSE_FAILED, {
          context: {exitCode: result.exitCode, stderr: result.stderr},
          suggestion: `Docker Compose failed to start the topology.\n${result.stderr}`,
        })
      }
    },

    async composeDown(opts: ComposeOptions): Promise<void> {
      output.info('Stopping multi-node Canton topology...')

      const result = await runner.run(
        'docker',
        ['compose', '-f', opts.composeFile, 'down', '--remove-orphans'],
        {cwd: opts.cwd, ignoreExitCode: true},
      )

      if (result.exitCode !== 0) {
        // Non-fatal: log warning but don't throw
        output.warn(`Docker Compose down returned exit code ${result.exitCode}: ${result.stderr}`)
      }
    },

    async composeLogs(opts: ComposeOptions): Promise<string> {
      const result = await runner.run(
        'docker',
        ['compose', '-f', opts.composeFile, 'logs', '--no-color', 'canton'],
        {cwd: opts.cwd, ignoreExitCode: true},
      )

      return result.stdout
    },
  }
}
