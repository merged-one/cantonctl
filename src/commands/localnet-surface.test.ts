import * as fs from 'node:fs'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {CantonctlError, ErrorCode} from '../lib/errors.js'
import * as localnetModule from '../lib/localnet.js'
import type {Localnet, LocalnetCommandResult, LocalnetDeps, LocalnetStatusResult} from '../lib/localnet.js'
import * as localnetWorkspaceModule from '../lib/localnet-workspace.js'
import type {LocalnetWorkspace, LocalnetWorkspaceDetectorDeps} from '../lib/localnet-workspace.js'
import * as processRunnerModule from '../lib/process-runner.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'

const CLI_ROOT = process.cwd()

function createWorkspace(): LocalnetWorkspace {
  return {
    composeFilePath: '/workspace/compose.yaml',
    configDir: '/workspace/config',
    env: {},
    envFilePaths: ['/workspace/.env'],
    localnetDir: '/workspace/docker/modules/localnet',
    makeTargets: {down: 'stop', status: 'status', up: 'start'},
    makefilePath: '/workspace/Makefile',
    profiles: {
      'app-provider': {
        health: {validatorReadyz: 'http://127.0.0.1:3903/api/validator/readyz'},
        name: 'app-provider',
        urls: {
          ledger: 'http://canton.localhost:3000/v2',
          validator: 'http://wallet.localhost:3000/api/validator',
          wallet: 'http://wallet.localhost:3000',
        },
      },
      'app-user': {
        health: {validatorReadyz: 'http://127.0.0.1:2903/api/validator/readyz'},
        name: 'app-user',
        urls: {
          ledger: 'http://canton.localhost:2000/v2',
          validator: 'http://wallet.localhost:2000/api/validator',
          wallet: 'http://wallet.localhost:2000',
        },
      },
      sv: {
        health: {validatorReadyz: 'http://127.0.0.1:4903/api/validator/readyz'},
        name: 'sv',
        urls: {
          ledger: 'http://canton.localhost:4000/v2',
          scan: 'http://scan.localhost:4000/api/scan',
          validator: 'http://wallet.localhost:4000/api/validator',
          wallet: 'http://wallet.localhost:4000',
        },
      },
    },
    root: '/workspace',
    services: {
      ledger: 'http://canton.localhost:4000/v2',
      scan: 'http://scan.localhost:4000/api/scan',
      validator: 'http://wallet.localhost:4000/api/validator',
      wallet: 'http://wallet.localhost:4000',
    },
  }
}

function createStatusResult(healthy: boolean): LocalnetStatusResult {
  const workspace = createWorkspace()
  return {
    containers: [{
      healthy,
      name: 'splice',
      ports: '0.0.0.0:4903->4903/tcp',
      service: 'splice',
      status: healthy ? 'Up (healthy)' : 'Up (unhealthy)',
    }],
    health: {
      validatorReadyz: {
        body: healthy ? 'ready' : 'not ready',
        healthy,
        status: healthy ? 200 : 503,
        url: workspace.profiles.sv.health.validatorReadyz,
      },
    },
    profiles: workspace.profiles,
    selectedProfile: 'sv',
    services: {
      ledger: {url: workspace.services.ledger},
      scan: {url: workspace.services.scan},
      validator: {url: workspace.services.validator},
      wallet: {url: workspace.services.wallet},
    },
    workspace,
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('localnet command surface', () => {
  it('wires the default localnet factories for up, status, and down commands', async () => {
    const accessSpy = vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined)
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue('ROOT=1')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ready',
    } as Response)

    const runner = {
      run: vi.fn(),
      spawn: vi.fn(),
      which: vi.fn(),
    } satisfies ProcessRunner
    vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner)

    const detectorDeps: LocalnetWorkspaceDetectorDeps[] = []
    const localnetDeps: LocalnetDeps[] = []
    const detector = {detect: vi.fn().mockResolvedValue(createWorkspace())}
    const localnet = {
      down: vi.fn(),
      status: vi.fn(),
      up: vi.fn(),
    } satisfies Localnet

    vi.spyOn(localnetWorkspaceModule, 'createLocalnetWorkspaceDetector').mockImplementation(deps => {
      detectorDeps.push(deps)
      return detector
    })
    vi.spyOn(localnetModule, 'createLocalnet').mockImplementation(deps => {
      localnetDeps.push(deps)
      return localnet
    })

    class UpHarness extends LocalnetUp {
      public callCreateLocalnet(): Localnet {
        return this.createLocalnet()
      }
    }

    class StatusHarness extends LocalnetStatus {
      public callCreateLocalnet(): Localnet {
        return this.createLocalnet()
      }
    }

    class DownHarness extends LocalnetDown {
      public callCreateLocalnet(): Localnet {
        return this.createLocalnet()
      }
    }

    const commands = [
      new UpHarness([], {} as never),
      new StatusHarness([], {} as never),
      new DownHarness([], {} as never),
    ]

    for (const command of commands) {
      expect(command.callCreateLocalnet()).toBe(localnet)
    }

    expect(detectorDeps).toHaveLength(3)
    expect(localnetDeps).toHaveLength(3)
    expect(localnetDeps.map(entry => entry.runner)).toEqual([runner, runner, runner])

    for (const deps of detectorDeps) {
      await deps.access('/workspace/Makefile')
      await deps.readFile('/workspace/.env')
    }

    for (const deps of localnetDeps) {
      await deps.detectWorkspace('/workspace')
      await deps.fetch('https://validator.example.com/readyz')
    }

    expect(accessSpy).toHaveBeenCalledTimes(3)
    expect(accessSpy).toHaveBeenCalledWith('/workspace/Makefile')
    expect(readFileSpy).toHaveBeenCalledTimes(3)
    expect(readFileSpy).toHaveBeenCalledWith('/workspace/.env', 'utf8')
    expect(detector.detect).toHaveBeenCalledTimes(3)
    expect(detector.detect).toHaveBeenCalledWith('/workspace')
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy).toHaveBeenCalledWith('https://validator.example.com/readyz')
  })

  it('emits localnet up status in json mode', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => createStatusResult(true),
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      drift: [],
      inventory: expect.objectContaining({
        mode: 'localnet-workspace',
        profile: expect.objectContaining({kind: 'splice-localnet', name: 'sv'}),
        schemaVersion: 1,
      }),
      reconcile: expect.objectContaining({
        supportedActions: [],
      }),
      selectedProfile: 'sv',
      services: expect.objectContaining({
        validator: expect.objectContaining({url: 'http://wallet.localhost:4000/api/validator'}),
      }),
      workspace: '/workspace',
    }))
  })

  it('renders localnet status in human mode', async () => {
    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => createStatusResult(true),
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetStatus.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Workspace: /workspace')
    expect(result.stdout).toContain('Health profile: sv')
    expect(result.stdout).toContain('validator readyz')
    expect(result.stdout).toContain('app-provider')
  })

  it('fails localnet status when validator readyz is unhealthy', async () => {
    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => createStatusResult(false),
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetStatus.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      drift: expect.arrayContaining([
        expect.objectContaining({code: 'service-unreachable', target: 'validator'}),
      ]),
      health: expect.objectContaining({
        validatorReadyz: expect.objectContaining({healthy: false, status: 503}),
      }),
      inventory: expect.objectContaining({
        services: expect.arrayContaining([
          expect.objectContaining({name: 'validator', status: 'unreachable'}),
        ]),
      }),
      reconcile: expect.objectContaining({
        supportedActions: expect.arrayContaining([
          expect.objectContaining({command: 'cantonctl localnet up --workspace /workspace --profile sv'}),
        ]),
      }),
    }))
  })

  it('renders localnet status without a container table when none are present', async () => {
    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => ({
            ...createStatusResult(true),
            containers: [],
          }),
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetStatus.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Workspace: /workspace')
    expect(result.stdout).toContain('validator readyz')
    expect(result.stdout).not.toContain('Container')
  })

  it('renders localnet down summaries in human mode', async () => {
    class TestLocalnetDown extends LocalnetDown {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => ({
            target: 'stop',
            workspace: createWorkspace(),
          } satisfies LocalnetCommandResult),
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetDown.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Upstream LocalNet workspace stopped')
    expect(result.stdout).toContain('Workspace: /workspace')
  })

  it('emits localnet down summaries in json mode', async () => {
    class TestLocalnetDown extends LocalnetDown {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => ({
            target: 'stop',
            workspace: createWorkspace(),
          } satisfies LocalnetCommandResult),
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetDown.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      target: 'stop',
      workspace: '/workspace',
    })
  })

  it('renders localnet up summaries in human mode', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => createStatusResult(true),
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Upstream LocalNet workspace started')
    expect(result.stdout).toContain('validator readyz')
    expect(result.stdout).toContain('splice')
  })

  it('renders placeholder ports for localnet up containers without published bindings', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => ({
            ...createStatusResult(true),
            containers: [{
              healthy: true,
              name: 'splice',
              service: 'splice',
              status: 'Up (healthy)',
            }],
          }),
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Up (healthy)')
    expect(result.stdout).toContain('-')
  })

  it('fails localnet up in human mode when validator health degrades before containers start', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => ({
            ...createStatusResult(false),
            containers: [],
            health: {
              validatorReadyz: {
                ...createStatusResult(false).health.validatorReadyz,
                status: 0,
              },
            },
          }),
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stdout).toContain('Upstream LocalNet workspace started')
    expect(result.stdout).toContain('validator readyz')
    expect(result.stdout).toContain('unreachable (error)')
    expect(result.stdout).not.toContain('Container')
  })

  it('renders localnet status container placeholders and error readyz output in human mode', async () => {
    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => ({
            ...createStatusResult(false),
            containers: [{
              healthy: false,
              name: 'splice',
              service: 'splice',
              status: 'Up (unhealthy)',
            }],
            health: {
              validatorReadyz: {
                ...createStatusResult(false).health.validatorReadyz,
                status: 0,
              },
            },
          }),
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetStatus.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stdout).toContain('unreachable (error)')
    expect(result.stdout).toContain('Up (unhealthy)')
    expect(result.stdout).toContain('-')
  })

  it('serializes CantonctlError failures for localnet commands', async () => {
    class TestLocalnetDown extends LocalnetDown {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new CantonctlError(ErrorCode.LOCALNET_COMMAND_FAILED, {
              suggestion: 'Run make status',
            })
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetDown.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.LOCALNET_COMMAND_FAILED,
      suggestion: 'Run make status',
    }))
  })

  it('serializes CantonctlError failures for localnet up', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new CantonctlError(ErrorCode.LOCALNET_COMMAND_FAILED, {
              suggestion: 'Retry make start',
            })
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.LOCALNET_COMMAND_FAILED,
      suggestion: 'Retry make start',
    }))
  })

  it('serializes CantonctlError failures for localnet status', async () => {
    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new CantonctlError(ErrorCode.LOCALNET_COMMAND_FAILED, {
              suggestion: 'Run make status',
            })
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    const result = await captureOutput(() => TestLocalnetStatus.run([
      '--json',
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.LOCALNET_COMMAND_FAILED,
      suggestion: 'Run make status',
    }))
  })

  it('rethrows unexpected localnet command failures', async () => {
    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new Error('boom up')
          },
        }
      }
    }

    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('unused')
          },
          status: async () => {
            throw new Error('boom status')
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    class TestLocalnetDown extends LocalnetDown {
      protected override createLocalnet(): Localnet {
        return {
          down: async () => {
            throw new Error('boom down')
          },
          status: async () => {
            throw new Error('unused')
          },
          up: async () => {
            throw new Error('unused')
          },
        }
      }
    }

    await expect(TestLocalnetUp.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT})).rejects.toThrow('boom up')
    await expect(TestLocalnetStatus.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT})).rejects.toThrow('boom status')
    await expect(TestLocalnetDown.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT})).rejects.toThrow('boom down')
  })
})
