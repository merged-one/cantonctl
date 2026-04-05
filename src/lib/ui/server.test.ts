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
  it('injects the bootstrap token and serves read endpoints when the token is present', async () => {
    const assetsDir = await createAssetsDir()
    const controller = {
      getChecks: async () => ({
        auth: {authenticated: true, envVarName: 'JWT', mode: 'bearer-token', source: 'stored', warnings: []},
        canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
        compatibility: {checks: [], failed: 0, passed: 1, warned: 0},
        doctor: {checks: [], failed: 0, passed: 1, warned: 0},
        preflight: {
          checks: [],
          network: {checklist: [], name: 'devnet', reminders: [], resetExpectation: 'unknown', tier: 'remote'},
          success: true,
        },
        profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      }),
      getOverview: async () => ({advisories: [], environmentPath: [], profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}, readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0}, services: []}),
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
      getSupport: async () => ({defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']}, profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}}),
    }

    const server = createUiServer({
      assetsDir,
      controller,
    })
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    expect(shell.status).toBe(200)
    const html = await shell.text()
    expect(html).toContain('cantonctl ui')
    const sessionToken = extractSessionToken(html)

    const session = await fetch(`${started.url}/ui/session?profile=splice-devnet`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
    })
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({
      data: expect.objectContaining({
        requestedProfile: 'splice-devnet',
        selectedProfile: 'splice-devnet',
      }),
      success: true,
    })

    const doctor = await fetch(`${started.url}/ui/checks/doctor`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
    })
    expect(doctor.status).toBe(200)
    expect(await doctor.json()).toEqual({
      data: {checks: [], failed: 0, passed: 1, warned: 0},
      success: true,
    })
  })

  it('rejects missing tokens, foreign origins, and mutating routes', async () => {
    const assetsDir = await createAssetsDir()
    const controller = {
      getChecks: async () => ({
        auth: {authenticated: true, envVarName: 'JWT', mode: 'bearer-token', source: 'stored', warnings: []},
        canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
        compatibility: {checks: [], failed: 0, passed: 1, warned: 0},
        doctor: {checks: [], failed: 0, passed: 1, warned: 0},
        preflight: {
          checks: [],
          network: {checklist: [], name: 'devnet', reminders: [], resetExpectation: 'unknown', tier: 'remote'},
          success: true,
        },
        profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      }),
      getOverview: async () => ({advisories: [], environmentPath: [], profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}, readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0}, services: []}),
      getProfiles: async () => ({profiles: [], selected: {auth: {authenticated: true, mode: 'bearer-token', source: 'stored', warnings: []}, experimental: false, imports: {}, json: {}, kind: 'remote-validator' as const, name: 'splice-devnet', networkMappings: [], networkName: 'devnet', services: [], validation: {detail: 'valid', valid: true}, yaml: 'profiles: {}'}}),
      getRuntime: async () => ({autoPoll: false, mode: 'remote' as const, profile: {kind: 'remote-validator' as const, name: 'splice-devnet'}}),
      getSession: async () => ({configPath: '/repo/cantonctl.yaml', profiles: [], project: {name: 'demo', sdkVersion: '3.4.11'}, selectedProfile: 'sandbox', storageKey: 'key'}),
      getSupport: async () => ({defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']}, profile: {kind: 'sandbox' as const, name: 'sandbox'}}),
    }

    const server = createUiServer({
      assetsDir,
      controller,
    })
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    const html = await shell.text()
    const sessionToken = extractSessionToken(html)

    const missingToken = await fetch(`${started.url}/ui/session`)
    expect(missingToken.status).toBe(403)

    const foreignOrigin = await fetch(`${started.url}/ui/session`, {
      headers: {
        Origin: 'https://evil.example.com',
        'X-Cantonctl-Ui-Session': sessionToken,
      },
    })
    expect(foreignOrigin.status).toBe(403)

    const mutate = await fetch(`${started.url}/ui/actions/support/discover-network`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
      method: 'POST',
    })
    expect(mutate.status).toBe(405)
  })
})

async function createAssetsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-assets-'))
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>cantonctl ui</body></html>', 'utf8')
  return dir
}

function extractSessionToken(html: string): string {
  const match = html.match(/"sessionToken":"([^"]+)"/)
  if (!match) {
    throw new Error('Expected bootstrap session token in shell HTML')
  }

  return match[1]
}
