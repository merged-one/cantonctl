import {captureOutput} from '@oclif/test'
import {describe, expect, it} from 'vitest'

import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {Localnet, LocalnetCommandResult, LocalnetStatusResult} from '../lib/localnet.js'
import type {LocalnetWorkspace} from '../lib/localnet-workspace.js'
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

describe('localnet command surface', () => {
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
      health: expect.objectContaining({
        validatorReadyz: expect.objectContaining({healthy: false, status: 503}),
      }),
    }))
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
})
