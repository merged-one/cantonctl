/**
 * Tests for Docker Compose lifecycle manager.
 *
 * All tests use a mock ProcessRunner — no Docker required.
 */

import {describe, expect, it, vi} from 'vitest'
import {createDockerManager} from './docker.js'
import {CantonctlError} from './errors.js'
import type {OutputWriter} from './output.js'
import type {ProcessRunner} from './process-runner.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRunner(): ProcessRunner {
  return {
    run: vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: ''}),
    spawn: vi.fn(),
    which: vi.fn(),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), start: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

const composeOpts = {
  composeFile: '/project/.cantonctl/docker-compose.yml',
  cwd: '/project/.cantonctl',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DockerManager', () => {
  describe('checkAvailable', () => {
    it('succeeds when docker compose version returns 0', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: 'Docker Compose version v2.24.0',
      })

      const docker = createDockerManager({output, runner})
      await expect(docker.checkAvailable()).resolves.toBeUndefined()

      expect(runner.run).toHaveBeenCalledWith(
        'docker',
        ['compose', 'version'],
        {ignoreExitCode: true},
      )
      expect(output.info).toHaveBeenCalledWith(
        'Docker Compose: Docker Compose version v2.24.0',
      )
    })

    it('throws DOCKER_NOT_AVAILABLE when docker compose fails', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stderr: 'command not found',
        stdout: '',
      })

      const docker = createDockerManager({output, runner})
      await expect(docker.checkAvailable()).rejects.toThrow(CantonctlError)
      await expect(docker.checkAvailable()).rejects.toMatchObject({
        code: 'E3004',
      })
    })

    it('throws DOCKER_NOT_AVAILABLE when runner throws', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ENOENT: docker not found'),
      )

      const docker = createDockerManager({output, runner})
      await expect(docker.checkAvailable()).rejects.toThrow(CantonctlError)
      await expect(docker.checkAvailable()).rejects.toMatchObject({
        code: 'E3004',
      })
    })
  })

  describe('composeUp', () => {
    it('runs docker compose up -d --wait', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const docker = createDockerManager({output, runner})

      await docker.composeUp(composeOpts)

      expect(runner.run).toHaveBeenCalledWith(
        'docker',
        ['compose', '-f', composeOpts.composeFile, 'up', '-d', '--wait'],
        {cwd: composeOpts.cwd, ignoreExitCode: true},
      )
    })

    it('outputs info message on start', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const docker = createDockerManager({output, runner})

      await docker.composeUp(composeOpts)

      expect(output.info).toHaveBeenCalledWith(
        'Starting multi-node Canton topology...',
      )
    })

    it('throws DOCKER_COMPOSE_FAILED on non-zero exit', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stderr: 'no such image',
        stdout: '',
      })

      const docker = createDockerManager({output, runner})
      await expect(docker.composeUp(composeOpts)).rejects.toThrow(CantonctlError)
      await expect(docker.composeUp(composeOpts)).rejects.toMatchObject({
        code: 'E3005',
      })
    })
  })

  describe('composeDown', () => {
    it('runs docker compose down --remove-orphans', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const docker = createDockerManager({output, runner})

      await docker.composeDown(composeOpts)

      expect(runner.run).toHaveBeenCalledWith(
        'docker',
        ['compose', '-f', composeOpts.composeFile, 'down', '--remove-orphans'],
        {cwd: composeOpts.cwd, ignoreExitCode: true},
      )
    })

    it('warns but does not throw on non-zero exit', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stderr: 'something went wrong',
        stdout: '',
      })

      const docker = createDockerManager({output, runner})
      await expect(docker.composeDown(composeOpts)).resolves.toBeUndefined()
      expect(output.warn).toHaveBeenCalled()
    })
  })

  describe('composeLogs', () => {
    it('returns logs from canton service', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stderr: '',
        stdout: 'Canton node started successfully',
      })

      const docker = createDockerManager({output, runner})
      const logs = await docker.composeLogs(composeOpts)

      expect(logs).toBe('Canton node started successfully')
      expect(runner.run).toHaveBeenCalledWith(
        'docker',
        ['compose', '-f', composeOpts.composeFile, 'logs', '--no-color', 'canton'],
        {cwd: composeOpts.cwd, ignoreExitCode: true},
      )
    })
  })
})
