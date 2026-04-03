import * as net from 'node:net'
import {describe, expect, it, vi} from 'vitest'

import {createDoctor, type DoctorDeps} from './doctor.js'
import type {CantonctlConfig} from './config.js'
import type {OutputWriter} from './output.js'
import type {ProcessResult, ProcessRunner} from './process-runner.js'

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
  runImpl: (cmd: string, args: string[]) => ProcessResult | Promise<ProcessResult> | undefined
  sdkTool: 'daml' | 'dpm' | null
  whichImpl: (cmd: string) => Promise<string | null | undefined> | string | null | undefined
}> = {}): ProcessRunner {
  const settings = {
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
      const overrideResult = await settings.runImpl?.(cmd, args)
      if (overrideResult !== undefined) {
        return overrideResult
      }

      if (cmd === 'java' && args[0] === '-version') {
        return {exitCode: 0, stderr: settings.javaVersion, stdout: ''}
      }

      if (cmd === 'daml' && args[0] === 'version') {
        return {exitCode: 0, stderr: '', stdout: '3.4.11'}
      }

      if (cmd === 'dpm' && args[0] === '--version') {
        return {exitCode: 0, stderr: '', stdout: '1.0.0'}
      }

      if (cmd === 'docker' && args[0] === '--version') {
        if (!settings.dockerAvailable) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
      }

      if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
        if (!settings.dockerAvailable) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: settings.dockerComposeVersion}
      }

      if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
        if (!settings.dockerImageExists) return {exitCode: 1, stderr: '', stdout: ''}
        return {exitCode: 0, stderr: '', stdout: '[]'}
      }

      return {exitCode: 0, stderr: '', stdout: ''}
    }),
    spawn: vi.fn(),
    which: vi.fn().mockImplementation(async (cmd: string) => {
      const overridePath = await settings.whichImpl?.(cmd)
      if (overridePath !== undefined) {
        return overridePath
      }

      if (cmd === 'java') return settings.javaPath
      if (cmd === 'dpm') return settings.sdkTool === 'dpm' ? '/usr/bin/dpm' : null
      if (cmd === 'daml') return settings.sdkTool === 'daml' ? '/usr/bin/daml' : null
      if (cmd === 'docker') return settings.dockerAvailable ? '/usr/bin/docker' : null
      return null
    }),
  }
}

function createProfileConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Doctor', () => {
  describe('check()', () => {
    it('fails the Node.js check when the runtime is below the supported major version', async () => {
      const versionDescriptor = Object.getOwnPropertyDescriptor(process, 'version')
      Object.defineProperty(process, 'version', {configurable: true, value: 'v16.20.0'})

      try {
        const runner = createMockRunner()
        const output = createMockOutput()
        const doctor = createDoctor({checkPort: async () => true, output, runner})

        const result = await doctor.check()

        const nodeCheck = result.checks.find(c => c.name === 'Node.js')
        expect(nodeCheck).toEqual(expect.objectContaining({
          detail: 'v16.20.0 (requires ≥18)',
          fix: 'Upgrade Node.js: https://nodejs.org',
          status: 'fail',
        }))
      } finally {
        if (versionDescriptor) {
          Object.defineProperty(process, 'version', versionDescriptor)
        }
      }
    })

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

    it('detects unsupported Java versions', async () => {
      const runner = createMockRunner({javaVersion: 'openjdk version "17.0.10"'})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const javaCheck = result.checks.find(c => c.name === 'Java 21')
      expect(javaCheck?.status).toBe('fail')
      expect(javaCheck?.detail).toContain('17.0.10')
      expect(javaCheck?.fix).toContain('Upgrade to Java 21')
    })

    it('fails Java checks when probing Java throws', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'java' && args[0] === '-version') {
            throw new Error('java not executable')
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const javaCheck = result.checks.find(c => c.name === 'Java 21')
      expect(javaCheck?.status).toBe('fail')
      expect(javaCheck?.detail).toBe('Not found')
    })

    it('reports an unknown Java version when the probe output is blank', async () => {
      const runner = createMockRunner({javaVersion: ''})
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const javaCheck = result.checks.find(c => c.name === 'Java 21')
      expect(javaCheck?.detail).toBe('Unknown version')
      expect(javaCheck?.status).toBe('fail')
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

    it('falls back to an installed marker when dpm version output is blank', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'dpm' && args[0] === '--version') {
            return {exitCode: 0, stderr: '', stdout: ''}
          }
          return undefined
        },
        sdkTool: 'dpm',
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.detail).toBe('dpm installed')
      expect(sdkCheck?.status).toBe('pass')
    })

    it('falls back from dpm to daml when dpm probing fails', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'dpm' && args[0] === '--version') {
            throw new Error('dpm broken')
          }
          return undefined
        },
        whichImpl: (cmd) => {
          if (cmd === 'dpm') return '/usr/bin/dpm'
          if (cmd === 'daml') return '/usr/bin/daml'
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.status).toBe('pass')
      expect(sdkCheck?.detail).toContain('daml 3.4.11')
    })

    it('fails when daml probing throws after dpm is unavailable', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'daml' && args[0] === 'version') {
            throw new Error('daml broken')
          }
          return undefined
        },
        whichImpl: (cmd) => {
          if (cmd === 'dpm') return null
          if (cmd === 'daml') return '/usr/bin/daml'
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.status).toBe('fail')
      expect(sdkCheck?.detail).toBe('Not found')
    })

    it('falls back to an installed marker when daml version output is blank', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'daml' && args[0] === 'version') {
            return {exitCode: 0, stderr: '', stdout: ''}
          }
          return undefined
        },
        whichImpl: (cmd) => {
          if (cmd === 'dpm') return null
          if (cmd === 'daml') return '/usr/bin/daml'
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const sdkCheck = result.checks.find(c => c.name === 'Daml SDK')
      expect(sdkCheck?.status).toBe('pass')
      expect(sdkCheck?.detail).toBe('daml installed')
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

    it('warns when Docker probing throws', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === '--version') {
            throw new Error('docker not executable')
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const dockerCheck = result.checks.find(c => c.name === 'Docker')
      expect(dockerCheck?.status).toBe('warn')
      expect(dockerCheck?.detail).toBe('Not found')
    })

    it('warns when Docker reports a non-zero exit code after discovery', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === '--version') {
            return {exitCode: 1, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const dockerCheck = result.checks.find(c => c.name === 'Docker')
      expect(dockerCheck?.status).toBe('warn')
      expect(dockerCheck?.detail).toBe('24.0.7')
    })

    it('uses an installed marker when Docker and Compose version output is blank', async () => {
      const runner = createMockRunner({
        dockerComposeVersion: '',
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === '--version') {
            return {exitCode: 0, stderr: '', stdout: ''}
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const dockerCheck = result.checks.find(c => c.name === 'Docker')
      const composeCheck = result.checks.find(c => c.name === 'Docker Compose')
      expect(dockerCheck?.detail).toBe('Installed')
      expect(composeCheck?.detail).toBe('Installed')
    })

    it('warns when Docker Compose exits non-zero', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
            return {exitCode: 1, stderr: '', stdout: ''}
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const composeCheck = result.checks.find(c => c.name === 'Docker Compose')
      expect(composeCheck?.status).toBe('warn')
      expect(composeCheck?.detail).toBe('Not available')
    })

    it('warns when Docker Compose probing throws', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
            throw new Error('compose unavailable')
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const composeCheck = result.checks.find(c => c.name === 'Docker Compose')
      expect(composeCheck?.status).toBe('warn')
      expect(composeCheck?.detail).toBe('Not available')
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

    it('warns when Canton image probing throws', async () => {
      const runner = createMockRunner({
        runImpl: (cmd, args) => {
          if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
            throw new Error('image inspect failed')
          }
          return undefined
        },
      })
      const output = createMockOutput()
      const doctor = createDoctor({checkPort: async () => true, output, runner})

      const result = await doctor.check()

      const imageCheck = result.checks.find(c => c.name === 'Canton image')
      expect(imageCheck?.status).toBe('warn')
      expect(imageCheck?.detail).toBe('Cannot check (Docker not available)')
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

    it('warns when both managed ports are already in use', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({
        checkPort: async () => false,
        output,
        runner,
      })

      const result = await doctor.check()

      const port5001 = result.checks.find(c => c.name === 'Port 5001')
      const port7575 = result.checks.find(c => c.name === 'Port 7575')
      expect(port5001).toEqual(expect.objectContaining({
        detail: 'In use',
        status: 'warn',
      }))
      expect(port7575).toEqual(expect.objectContaining({
        detail: 'In use',
        status: 'warn',
      }))
    })

    it('uses the default port probe when no override is injected', async () => {
      const reservedServers: net.Server[] = []
      for (const port of [5001, 7575]) {
        const server = net.createServer()
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(port, '127.0.0.1', () => resolve())
          })
          reservedServers.push(server)
        } catch {
          try {
            server.close()
          } catch {
            // Ignore close errors for ports already owned by another process.
          }
        }
      }

      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({output, runner})

      try {
        const result = await doctor.check()

        expect(result.checks.find(c => c.name === 'Port 5001')?.status).toBe('warn')
        expect(result.checks.find(c => c.name === 'Port 7575')?.status).toBe('warn')
      } finally {
        await Promise.all(reservedServers.map(server => new Promise<void>((resolve) => {
          server.close(() => resolve())
        })))
      }
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

    it('adds profile and service compatibility checks when config is provided', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({
        checkPort: async () => true,
        config: createProfileConfig(),
        output,
        profileName: 'splice-devnet',
        runner,
      } as DoctorDeps & {config: CantonctlConfig; profileName: string})

      const result = await doctor.check()

      expect(result.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({name: 'Profile', status: 'pass'}),
        expect.objectContaining({name: 'Service ledger', status: 'pass'}),
        expect.objectContaining({name: 'Service scanProxy', status: 'warn'}),
        expect.objectContaining({name: 'Service validator', status: 'warn'}),
      ]))
    })

    it('warns when the resolved profile is experimental', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({
        checkPort: async () => true,
        config: {
          ...createProfileConfig(),
          'default-profile': 'splice-localnet',
          profiles: {
            ...createProfileConfig().profiles!,
            'splice-localnet': {
              experimental: true,
              kind: 'splice-localnet',
              name: 'splice-localnet',
              services: {
                localnet: {distribution: 'splice-localnet', version: '0.5.x'},
                validator: {url: 'https://validator.local'},
              },
            },
          },
        },
        output,
        runner,
      } as DoctorDeps & {config: CantonctlConfig})

      const result = await doctor.check()

      const profileCheck = result.checks.find(c => c.name === 'Profile')
      expect(profileCheck?.status).toBe('warn')
      expect(profileCheck?.detail).toContain('experimental')
    })

    it('skips profile diagnostics when compatibility report resolution fails', async () => {
      const runner = createMockRunner()
      const output = createMockOutput()
      const doctor = createDoctor({
        checkPort: async () => true,
        config: {
          ...createProfileConfig(),
          'default-profile': 'missing-profile',
        },
        output,
        runner,
      } as DoctorDeps & {config: CantonctlConfig})

      const result = await doctor.check()

      expect(result.checks.some(c => c.name === 'Profile')).toBe(false)
      expect(result.checks.some(c => c.name.startsWith('Service '))).toBe(false)
      expect(result.checks).toHaveLength(8)
    })
  })
})
