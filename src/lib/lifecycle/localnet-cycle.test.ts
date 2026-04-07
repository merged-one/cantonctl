import {describe, expect, it, vi} from 'vitest'

import * as localnetModule from '../localnet.js'
import * as localnetWorkspaceModule from '../localnet-workspace.js'
import * as processRunnerModule from '../process-runner.js'
import {
  createDefaultLocalnet,
  cycleLocalnetWorkspace,
  inferLocalnetProfile,
  isLocalnetLifecycleProfile,
} from './localnet-cycle.js'

function createStatusResult(selectedProfile: 'app-provider' | 'app-user' | 'sv' = 'sv') {
  return {
    containers: [],
    health: {
      validatorReadyz: {
        body: 'ok',
        healthy: true,
        status: 200,
        url: 'http://validator.localhost:5003/readyz',
      },
    },
    profiles: {
      'app-provider': {
        health: {validatorReadyz: 'http://validator.localhost:3003/readyz'},
        name: 'app-provider' as const,
        urls: {
          ledger: 'http://ledger.localhost:3001',
          scan: 'http://scan.localhost:3012',
          validator: 'http://validator.localhost:3003',
          wallet: 'http://wallet.localhost:3000',
        },
      },
      'app-user': {
        health: {validatorReadyz: 'http://validator.localhost:2003/readyz'},
        name: 'app-user' as const,
        urls: {
          ledger: 'http://ledger.localhost:2001',
          validator: 'http://validator.localhost:2003',
          wallet: 'http://wallet.localhost:2000',
        },
      },
      sv: {
        health: {validatorReadyz: 'http://validator.localhost:5003/readyz'},
        name: 'sv' as const,
        urls: {
          ledger: 'http://ledger.localhost:5001',
          scan: 'http://scan.localhost:5012',
          validator: 'http://validator.localhost:5003',
          wallet: 'http://wallet.localhost:5000',
        },
      },
    },
    selectedProfile,
    services: {
      ledger: {url: 'http://ledger.localhost:5001'},
      scan: {url: 'http://scan.localhost:5012'},
      validator: {url: 'http://validator.localhost:5003'},
      wallet: {url: 'http://wallet.localhost:5000'},
    },
    workspace: {
      composeFilePath: '/workspace/compose.yaml',
      configDir: '/workspace/docker/modules/localnet/conf',
      env: {SPLICE_VERSION: '0.5.0'},
      localnetDir: '/workspace/docker/modules/localnet',
      makeTargets: {down: 'stop', status: 'status', up: 'start'},
      profiles: {} as never,
      root: '/workspace',
    },
  }
}

describe('localnet lifecycle helper', () => {
  it('wires the default LocalNet factory with the workspace detector and process runner', () => {
    const access = vi.fn()
    const detect = vi.fn()
    const readFile = vi.fn()
    const runner = {run: vi.fn(), spawn: vi.fn(), which: vi.fn()} as never
    const localnet = {down: vi.fn(), status: vi.fn(), up: vi.fn()} as never
    const detectorSpy = vi.spyOn(localnetWorkspaceModule, 'createLocalnetWorkspaceDetector').mockImplementation((deps) => {
      access.mockImplementation(deps.access)
      readFile.mockImplementation(deps.readFile)
      return {detect}
    })
    const runnerSpy = vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner)
    const localnetSpy = vi.spyOn(localnetModule, 'createLocalnet').mockReturnValue(localnet)

    expect(createDefaultLocalnet()).toBe(localnet)
    expect(detectorSpy).toHaveBeenCalledOnce()
    expect(runnerSpy).toHaveBeenCalledOnce()
    expect(localnetSpy).toHaveBeenCalledWith(expect.objectContaining({
      detectWorkspace: expect.any(Function),
      fetch: expect.any(Function),
      runner,
    }))

    const deps = localnetSpy.mock.calls[0]![0]
    void deps.detectWorkspace('/workspace')
    void deps.fetch('data:text/plain,ok')
    expect(detect).toHaveBeenCalledWith('/workspace')
    void access('/workspace/.env')
    void readFile('/workspace/.env')
  })

  it('infers the LocalNet profile from matching profile endpoints and falls back to the selected profile', () => {
    const status = createStatusResult('sv')
    expect(inferLocalnetProfile(status, {
      services: {
        ledger: {url: 'http://ledger.localhost:3001'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    })).toBe('app-provider')

    expect(inferLocalnetProfile(status, {
      services: {
        ledger: {url: 'http://ledger.unknown.local'},
      },
    })).toBe('sv')

    expect(inferLocalnetProfile(status, {
      services: {
        ledger: {url: 'http://ledger.localhost:3001'},
        scan: {url: 'http://scan.mismatch.local'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    })).toBe('sv')

    expect(inferLocalnetProfile(status, {
      services: {
        ledger: {url: 'http://ledger.localhost:3001'},
        validator: {url: 'http://validator.mismatch.local'},
      },
    })).toBe('sv')
  })

  it('cycles the LocalNet workspace using the inferred profile', async () => {
    const status = createStatusResult('sv')
    const upStatus = createStatusResult('app-provider')
    const localnet = {
      down: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(status),
      up: vi.fn().mockResolvedValue(upStatus),
    }

    const result = await cycleLocalnetWorkspace({
      createLocalnet: () => localnet,
      profile: {
        services: {
          ledger: {url: 'http://ledger.localhost:3001'},
          scan: {url: 'http://scan.localhost:3012'},
          validator: {url: 'http://validator.localhost:3003'},
        },
      },
      workspace: '/workspace',
    })

    expect(localnet.status).toHaveBeenCalledWith({workspace: '/workspace'})
    expect(localnet.down).toHaveBeenCalledWith({workspace: '/workspace'})
    expect(localnet.up).toHaveBeenCalledWith({profile: 'app-provider', workspace: '/workspace'})
    expect(result.selectedProfile).toBe('app-provider')
    expect(result.workspace).toBe('/workspace')
  })

  it('uses the default LocalNet factory when no custom factory is supplied', async () => {
    const detect = vi.fn()
    const runner = {run: vi.fn(), spawn: vi.fn(), which: vi.fn()} as never
    const localnet = {
      down: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(createStatusResult('sv')),
      up: vi.fn().mockResolvedValue(createStatusResult('sv')),
    }
    vi.spyOn(localnetWorkspaceModule, 'createLocalnetWorkspaceDetector').mockReturnValue({detect})
    vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner)
    vi.spyOn(localnetModule, 'createLocalnet').mockReturnValue(localnet)

    await cycleLocalnetWorkspace({
      profile: {
        services: {
          ledger: {url: 'http://ledger.localhost:5001'},
        },
      },
      workspace: '/workspace',
    })

    expect(localnet.status).toHaveBeenCalledWith({workspace: '/workspace'})
    expect(localnet.down).toHaveBeenCalledWith({workspace: '/workspace'})
  })

  it('detects LocalNet lifecycle profiles', () => {
    expect(isLocalnetLifecycleProfile({kind: 'splice-localnet'})).toBe(true)
    expect(isLocalnetLifecycleProfile({kind: 'remote-validator'})).toBe(false)
  })
})
