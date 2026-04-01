import {describe, expect, it, vi} from 'vitest'

import {createDoctor, type DoctorDeps} from './doctor.js'
import type {OutputWriter} from './output.js'
import type {ProcessRunner} from './process-runner.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

function createMockRunner(overrides: Partial<{
  dockerAvailable: boolean
  dockerComposeVersion: string
  dockerImageExists: boolean
  javaPath: string | null
  javaVersion: string
  sdkTool: 'daml' | 'dpm' | null
}> = {}): ProcessRunner {
  const opts = {
    dockerAvailable: true,
    dockerComposeVersion: 'Docker Compose version v2.40.3',
    dockerImageExists: true,
    javaPath: '/usr/bin/java',
    javaVersion: 'openjdk version "21.0.10"',
    sdkTool: 'daml' as const,
    ...overrides,
  }

  return {
    run: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'java' && args[0] === '-version') {
        return {exitCode: 0, stderr: opts.javaVersion, stdout: ''}
      }

      if (cmd === 'daml' && args[0] === 'version') {
        return {exitCode: 0, stderr: '', stdout: '3.4.11'}
      }

      if (cmd === 'dpm' && args[0] === '--version') {
        return {exitCode: 0, stderr: '', stdout: '1.0.0'}
      }

      if (cmd === 'docker' && args[0] === '--version') {
        if (!opts.dockerAvailable) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
      }

      if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
        if (!opts.dockerAvailable) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: opts.dockerComposeVersion}
      }

      if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
        if (!opts.dockerImageExists) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: '[]'}
      }

      return {exitCode: 0, stderr: '', stdout: ''}
    }),
    spawn: vi.fn(),
    which: vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'java') return opts.javaPath
      if (cmd === 'dpm') return opts.sdkTool === 'dpm' ? '/usr/bin/dpm' : null
      if (cmd === 'daml') return opts.sdkTool === 'daml' ? '/usr/bin/daml' : null
      if (cmd === 'docker') return opts.dockerAvailable ? '/usr/bin/docker' : null
      return null
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Doctor', () => {
  describe('check()', () => {
    it('reports all checks passing when everything is installed', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      expect(result.failed).toBe(0)
      expect(result.passed).toBe(8)
      expect(result.checks).toHaveLength(8)
      expect(result.checks.map(c => c.name)).toEqual([
        'Node.js', 'Java 21', 'Daml SDK', 'Docker',
        'Docker Compose', 'Canton image', 'Port 5001', 'Port 7575',
      ])
    })

    it('detects missing Java', async () => {
      const runner = createMockRunner({javaPath: null})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const javaCheck = result.checks.find(c => c.name === 'Java 21')
      expect(javaCheck?.status).toBe('fail')
      expect(javaCheck?.fix).toContain('Install Java 21')
      expect(result.failed).toBe(1)
    })

    it('detects missing Daml SDK', async () => {
      const runner = createMockRunner({sdkTool: null})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.status).toBe('fail')
      expect(sdkCheck?.fix).toContain('curl')
      expect(result.failed).toBe(1)
    })

    it('prefers dpm over daml', async () => {
      const runner = createMockRunner({sdkTool: 'dpm'})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.status).toBe('pass')
      expect(sdkCheck?.detail).toContain('dpm')
    })

    it('warns when Docker is not available', async () => {
      const runner = createMockRunner({dockerAvailable: false})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const dockerCheck = result.checks.find(c => c.name === 'Docker')
      expect(dockerCheck?.status).toBe('warn')
      expect(dockerCheck?.required).toBe(false)
      expect(result.failed).toBe(0) // Docker is optional
      expect(result.warned).toBeGreaterThan(0)
    })

    it('warns when Canton Docker image is missing', async () => {
      const runner = createMockRunner({dockerImageExists: false})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const imageCheck = result.checks.find(c => c.name === 'Canton image')
      expect(imageCheck?.status).toBe('warn')
      expect(imageCheck?.fix).toContain('docker pull')
    })

    it('warns when ports are in use', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({
        checkPort: async (port) => port !== 5001, // 5001 is in use
        output,
        runner,
      })

      const result = await doctor.check()

      const port5001 = result.checks.find(c => c.name === 'Port 5001')
      expect(port5001?.status).toBe('warn')
      expect(port5001?.detail).toBe('In use')

      const port7575 = result.checks.find(c => c.name === 'Port 7575')
      expect(port7575?.status).toBe('pass')
    })

    it('reports correct counts', async () => {
      const runner = createMockRunner({javaPath: null, sdkTool: null})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      expect(result.failed).toBe(2)  // Java + SDK
      expect(result.passed).toBe(6)  // Node, Docker, Compose, Image, Port 5001, Port 7575
    })

    it('all checks have required field', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const required = result.checks.filter(c => c.required)
      const optional = result.checks.filter(c => !c.required)

      expect(required.map(c => c.name)).toEqual(['Node.js', 'Java 21', 'Daml SDK'])
      expect(optional.map(c => c.name)).toEqual(['Docker', 'Docker Compose', 'Canton image', 'Port 5001', 'Port 7575'])
    })
  })
})
