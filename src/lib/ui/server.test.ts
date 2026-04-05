import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterEach, describe, expect, it} from 'vitest'

import {createUiServer} from './server.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Expected numeric port'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

const servers: Array<ReturnType<typeof createUiServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

describe('ui server', () => {
  it('serves the static shell and routes view requests to the controller', async () => {
    const assetsDir = await createAssetsDir()
    const controller = {
      getChecks: async () => ({
        auth: {authenticated: true, envVarName: 'JWT', mode: 'bearer-token', source: 'stored', warnings: []},
        canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
        compatibility: {checks: [], failed: 0, passed: 1, warned: 0},
        doctor: {checks: [], failed: 0, passed: 1, warned: 0},
        preflight: {
          checks: [],
          network: {checklist: [], name: 'devnet', reminders: [], resetExpectation: 'n/a', tier: 'remote'},
          success: true,
        },
        profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      }),
      getJob: (id: string) => ({
        action: 'support/discover-network' as const,
        createdAt: '2026-04-04T00:00:00.000Z',
        id,
        mutating: false,
        preview: 'preview',
        status: 'success' as const,
        updatedAt: '2026-04-04T00:00:00.000Z',
      }),
      getOverview: async () => ({advisories: [], environmentPath: [], profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}, readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0}, recentOutputs: {}, services: []}),
      getProfiles: async () => ({profiles: [], selected: {auth: {authenticated: true, mode: 'bearer-token', source: 'stored', warnings: []}, experimental: false, imports: {}, json: {}, kind: 'remote-validator' as const, name: 'splice-devnet', networkMappings: [], networkName: 'devnet', services: [], validation: {detail: 'valid', valid: true}, yaml: 'profiles: {}'}}),
      getRuntime: async () => ({autoPoll: false, mode: 'remote' as const, profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}}),
      getSession: async ({requestedProfile}: {requestedProfile?: string} = {}) => ({
        configPath: '/repo/cantonctl.yaml',
        defaultProfile: 'sandbox',
        profiles: [],
        project: {name: 'demo', sdkVersion: '3.4.11'},
        requestedProfile,
        selectedProfile: requestedProfile ?? 'sandbox',
        storageKey: 'cantonctl-ui:/repo/cantonctl.yaml',
      }),
      getSupport: async () => ({activity: [], defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']}, profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}}),
      startAction: async () => ({jobId: 'job-123'}),
    }

    const server = createUiServer({
      assetsDir,
      controller,
    })
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    expect(shell.status).toBe(200)
    expect(await shell.text()).toContain('cantonctl ui')

    const session = await fetch(`${started.url}/ui/session?profile=splice-devnet`)
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({
      data: expect.objectContaining({
        requestedProfile: 'splice-devnet',
        selectedProfile: 'splice-devnet',
      }),
      success: true,
    })

    const doctor = await fetch(`${started.url}/ui/checks/doctor`)
    expect(doctor.status).toBe(200)
    expect(await doctor.json()).toEqual({
      data: {checks: [], failed: 0, passed: 1, warned: 0},
      success: true,
    })
  })

  it('starts actions as jobs and exposes job status routes', async () => {
    const assetsDir = await createAssetsDir()
    const controller = {
      getChecks: async () => { throw new Error('unused') },
      getJob: (id: string) => ({
        action: 'support/discover-network' as const,
        createdAt: '2026-04-04T00:00:00.000Z',
        id,
        mutating: false,
        preview: 'preview',
        status: 'running' as const,
        updatedAt: '2026-04-04T00:00:00.000Z',
      }),
      getOverview: async () => { throw new Error('unused') },
      getProfiles: async () => { throw new Error('unused') },
      getRuntime: async () => { throw new Error('unused') },
      getSession: async () => ({configPath: '/repo/cantonctl.yaml', profiles: [], project: {name: 'demo', sdkVersion: '3.4.11'}, selectedProfile: 'sandbox', storageKey: 'key'}),
      getSupport: async () => ({activity: [], defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']}, profile: {kind: 'sandbox' as const, name: 'sandbox'}}),
      startAction: async (kind: string, options: {payload?: Record<string, unknown>; profileName?: string}) => {
        expect(kind).toBe('support/discover-network')
        expect(options.profileName).toBe('splice-devnet')
        expect(options.payload).toEqual({scanUrl: 'https://scan.example.com'})
        return {jobId: 'job-123'}
      },
    }

    const server = createUiServer({
      assetsDir,
      controller,
    })
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const action = await fetch(`${started.url}/ui/actions/support/discover-network?profile=splice-devnet`, {
      body: JSON.stringify({scanUrl: 'https://scan.example.com'}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
    })
    expect(action.status).toBe(202)
    expect(await action.json()).toEqual({
      data: {jobId: 'job-123'},
      success: true,
    })

    const job = await fetch(`${started.url}/ui/jobs/job-123`)
    expect(job.status).toBe(200)
    expect(await job.json()).toEqual({
      data: expect.objectContaining({id: 'job-123', status: 'running'}),
      success: true,
    })
  })
})

async function createAssetsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-assets-'))
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body>cantonctl ui</body></html>', 'utf8')
  return dir
}
