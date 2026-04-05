import * as fs from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {CantonctlError, ErrorCode} from '../errors.js'

import {
  contentType,
  createAllowedHostnames,
  createUiServer,
  handleRequest,
  injectBootstrap,
  mapServerError,
  matchesLocalOrigin,
  resolveUiAssetsDir,
  serveStatic,
  toUiApiError,
  validateApiRequest,
  validateLocalRequest,
  type UiRequestPolicy,
} from './server.js'

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
  await Promise.all(servers.splice(0).map(server => server.stop().catch(() => undefined)))
})

describe('ui server', () => {
  it('serves the shell, all read-only API routes, and static assets with a session token', async () => {
    const assetsDir = await createAssetsDir()
    const controller = createControllerStub()

    const server = createUiServer({assetsDir, controller})
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    expect(shell.status).toBe(200)
    const html = await shell.text()
    expect(html).toContain('cantonctl ui')
    const sessionToken = extractSessionToken(html)

    const endpoints = [
      ['/ui/session?profile=splice-devnet', {requestedProfile: 'splice-devnet'}],
      ['/ui/map?profile=splice-devnet', {mode: 'remote'}],
      ['/ui/overview?profile=splice-devnet', {profile: {kind: 'remote-validator', name: 'splice-devnet'}}],
      ['/ui/profiles?profile=splice-devnet', {selected: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'})}],
      ['/ui/runtime?profile=splice-devnet', {mode: 'remote'}],
      ['/ui/checks?profile=splice-devnet', {profile: {kind: 'remote-validator', name: 'splice-devnet'}}],
      ['/ui/checks/auth?profile=splice-devnet', {envVarName: 'JWT'}],
      ['/ui/checks/compatibility?profile=splice-devnet', {failed: 0, passed: 1, warned: 0}],
      ['/ui/checks/preflight?profile=splice-devnet', {success: true}],
      ['/ui/checks/canary?profile=splice-devnet', {success: true}],
      ['/ui/checks/doctor?profile=splice-devnet', {failed: 0, passed: 1, warned: 0}],
      ['/ui/support?profile=splice-devnet', {profile: {kind: 'remote-validator', name: 'splice-devnet'}}],
    ] as const

    for (const [route, expectedData] of endpoints) {
      const response = await fetch(`${started.url}${route}`, {
        headers: {'X-Cantonctl-Ui-Session': sessionToken},
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: expect.objectContaining(expectedData),
        success: true,
      })
    }

    expect(controller.getChecks).toHaveBeenCalledTimes(6)
    expect(controller.getMap).toHaveBeenCalledWith({profileName: 'splice-devnet'})
    expect(controller.getOverview).toHaveBeenCalledWith({profileName: 'splice-devnet'})
    expect(controller.getProfiles).toHaveBeenCalledWith({profileName: 'splice-devnet'})
    expect(controller.getRuntime).toHaveBeenCalledWith({profileName: 'splice-devnet'})
    expect(controller.getSession).toHaveBeenCalledWith({requestedProfile: 'splice-devnet'})
    expect(controller.getSupport).toHaveBeenCalledWith({profileName: 'splice-devnet'})

    const missingRoute = await fetch(`${started.url}/ui/unknown`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
    })
    expect(missingRoute.status).toBe(404)
    expect(await missingRoute.json()).toEqual({
      error: {
        code: ErrorCode.SERVICE_NOT_CONFIGURED,
        message: 'Route not found.',
      },
      success: false,
    })

    const css = await fetch(`${started.url}/app.css`)
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await css.text()).toContain('font-family')

    const js = await fetch(`${started.url}/app.js`)
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await js.text()).toContain('console.log')

    const json = await fetch(`${started.url}/data.json`)
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await json.text()).toContain('"demo":true')

    const svg = await fetch(`${started.url}/icon.svg`)
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(await svg.text()).toContain('<svg')

    const blob = await fetch(`${started.url}/blob.bin`)
    expect(blob.headers.get('content-type')).toBe('application/octet-stream')
    expect(Buffer.from(await blob.arrayBuffer()).toString('utf8')).toBe('binary')

    const fallback = await fetch(`${started.url}/missing/route`)
    expect(fallback.status).toBe(200)
    expect(await fallback.text()).toContain(sessionToken)
  })

  it('rejects missing tokens, foreign origins, and mutating routes', async () => {
    const assetsDir = await createAssetsDir()
    const controller = createControllerStub()

    const server = createUiServer({assetsDir, controller})
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    const html = await shell.text()
    const sessionToken = extractSessionToken(html)

    const missingToken = await fetch(`${started.url}/ui/session`)
    expect(missingToken.status).toBe(403)
    expect(await missingToken.json()).toEqual({
      error: {
        code: 'UI_INVALID_SESSION',
        message: 'Missing or invalid UI session token.',
      },
      success: false,
    })

    const foreignOrigin = await fetch(`${started.url}/ui/session`, {
      headers: {
        Origin: 'https://evil.example.com',
        'X-Cantonctl-Ui-Session': sessionToken,
      },
    })
    expect(foreignOrigin.status).toBe(403)
    expect(await foreignOrigin.json()).toEqual({
      error: {
        code: 'UI_FORBIDDEN_ORIGIN',
        message: 'UI requests must originate from the local control-center origin.',
      },
      success: false,
    })

    const mutate = await fetch(`${started.url}/ui/session`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
      method: 'POST',
    })
    expect(mutate.status).toBe(405)
    expect(await mutate.json()).toEqual({
      error: {
        code: 'UI_METHOD_NOT_ALLOWED',
        message: 'Only GET is supported by the hardened UI bridge.',
      },
      success: false,
    })
  })

  it('returns a structured 500 envelope when a controller read route throws', async () => {
    const assetsDir = await createAssetsDir()
    const controller = createControllerStub()
    controller.getSession.mockRejectedValueOnce(new Error('controller exploded'))

    const server = createUiServer({assetsDir, controller})
    servers.push(server)
    const started = await server.start({host: '127.0.0.1', port: await getFreePort()})

    const shell = await fetch(`${started.url}/`)
    const sessionToken = extractSessionToken(await shell.text())

    const response = await fetch(`${started.url}/ui/session`, {
      headers: {'X-Cantonctl-Ui-Session': sessionToken},
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: 'UNEXPECTED',
        message: 'controller exploded',
      },
      success: false,
    })
  })

  it('covers helper utilities and static traversal guards directly', async () => {
    const policy: UiRequestPolicy = {
      allowedHostnames: new Set(['127.0.0.1', 'localhost']),
      port: 4680,
      sessionToken: 'secret',
    }

    expect(validateLocalRequest({
      headers: {host: '127.0.0.1:4680'},
    } as never, policy)).toBeNull()
    expect(validateLocalRequest({
      headers: {host: 'evil.example.com:4680'},
    } as never, policy)).toEqual({
      code: 'UI_FORBIDDEN_HOST',
      message: 'UI requests must target the local control-center origin.',
    })
    expect(validateLocalRequest({
      headers: {
        host: '127.0.0.1:4680',
        origin: 'https://evil.example.com',
      },
    } as never, policy)).toEqual({
      code: 'UI_FORBIDDEN_ORIGIN',
      message: 'UI requests must originate from the local control-center origin.',
    })

    expect(validateApiRequest({
      headers: {'x-cantonctl-ui-session': ['secret', 'ignored']},
    } as never, policy)).toBeNull()
    expect(validateApiRequest({
      headers: {'x-cantonctl-ui-session': 'wrong'},
    } as never, policy)).toEqual({
      code: 'UI_INVALID_SESSION',
      message: 'Missing or invalid UI session token.',
    })

    expect(matchesLocalOrigin('http://localhost:4680', policy)).toBe(true)
    expect(matchesLocalOrigin('127.0.0.1:4680', policy)).toBe(true)
    expect(matchesLocalOrigin('http://localhost', {...policy, port: 80})).toBe(true)
    expect(matchesLocalOrigin('http://localhost:9999', policy)).toBe(false)
    expect(matchesLocalOrigin('not a host', policy)).toBe(false)
    expect(matchesLocalOrigin(undefined, policy)).toBe(false)

    expect(createAllowedHostnames('127.0.0.1')).toEqual(new Set(['127.0.0.1', 'localhost']))
    expect(createAllowedHostnames('localhost')).toEqual(new Set(['localhost', '127.0.0.1']))
    expect(createAllowedHostnames('0.0.0.0')).toEqual(new Set(['0.0.0.0']))

    expect(injectBootstrap('<html><head></head><body></body></html>', {sessionToken: 'token'}))
      .toContain('window.__CANTONCTL_UI__={"sessionToken":"token"};</script></head>')
    expect(injectBootstrap('<html><body></body></html>', {sessionToken: 'token'}))
      .toContain('<script>window.__CANTONCTL_UI__={"sessionToken":"token"};</script><html>')

    expect(contentType('file.css')).toBe('text/css; charset=utf-8')
    expect(contentType('file.html')).toBe('text/html; charset=utf-8')
    expect(contentType('file.js')).toBe('text/javascript; charset=utf-8')
    expect(contentType('file.json')).toBe('application/json; charset=utf-8')
    expect(contentType('file.svg')).toBe('image/svg+xml')
    expect(contentType('file.bin')).toBe('application/octet-stream')

    expect(mapServerError(Object.assign(new Error('busy'), {code: 'EADDRINUSE'}), 4680)).toMatchObject({
      code: ErrorCode.SANDBOX_PORT_IN_USE,
    })
    expect(mapServerError(new Error('boom'), 4680)).toEqual(expect.objectContaining({message: 'boom'}))
    expect(mapServerError('boom', 4680)).toEqual(expect.objectContaining({message: 'boom'}))

    expect(toUiApiError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'Create config.'}))).toEqual({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: 'No cantonctl.yaml found in this directory or any parent directory.',
      suggestion: 'Create config.',
    })
    expect(toUiApiError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND))).toEqual({
      code: ErrorCode.CONFIG_NOT_FOUND,
      message: 'No cantonctl.yaml found in this directory or any parent directory.',
      suggestion: undefined,
    })
    expect(toUiApiError(new Error('boom'))).toEqual({code: 'UNEXPECTED', message: 'boom'})
    expect(toUiApiError('boom')).toEqual({code: 'UNEXPECTED', message: 'boom'})

    const dirWithDistUi = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-dist-ui-'))
    await nodeFs.mkdir(path.join(dirWithDistUi, 'dist', 'ui'), {recursive: true})
    await nodeFs.writeFile(path.join(dirWithDistUi, 'dist', 'ui', 'index.html'), '<html></html>', 'utf8')
    expect(resolveUiAssetsDir(dirWithDistUi)).toBe(path.join(dirWithDistUi, 'dist', 'ui'))

    const dirWithUiDist = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-ui-dist-'))
    await nodeFs.mkdir(path.join(dirWithUiDist, 'ui', 'dist'), {recursive: true})
    await nodeFs.writeFile(path.join(dirWithUiDist, 'ui', 'dist', 'index.html'), '<html></html>', 'utf8')
    expect(resolveUiAssetsDir(dirWithUiDist)).toBe(path.join(dirWithUiDist, 'ui', 'dist'))

    const dirWithoutAssets = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-none-'))
    expect(resolveUiAssetsDir(dirWithoutAssets)).toBe(path.join(dirWithoutAssets, 'dist', 'ui'))

    const guardedAssetsDir = await createAssetsDir()
    const guardedResponse = createMockResponse()
    await serveStatic('/../secret.txt', guardedResponse.raw, guardedAssetsDir, fs, {sessionToken: 'token'})
    expect(guardedResponse.statusCode).toBe(403)
    expect(guardedResponse.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(guardedResponse.body).toBe('Forbidden')

    const defaultRequestResponse = createMockResponse()
    await handleRequest({
      headers: {
        host: '127.0.0.1:4680',
        'x-cantonctl-ui-session': 'secret',
      },
    } as never, defaultRequestResponse.raw, {
      assetsDir: guardedAssetsDir,
      controller: createControllerStub(),
      fs,
      requestPolicy: policy,
    })
    expect(defaultRequestResponse.statusCode).toBe(200)
    expect(defaultRequestResponse.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(defaultRequestResponse.body).toContain('window.__CANTONCTL_UI__')

    await Promise.all([
      nodeFs.rm(dirWithDistUi, {force: true, recursive: true}),
      nodeFs.rm(dirWithUiDist, {force: true, recursive: true}),
      nodeFs.rm(dirWithoutAssets, {force: true, recursive: true}),
      nodeFs.rm(guardedAssetsDir, {force: true, recursive: true}),
    ])
  })

  it('handles startup and shutdown edge cases without exposing the bridge broadly', async () => {
    const assetsDir = await createAssetsDir()
    const controller = createControllerStub()

    await expect(createUiServer({assetsDir, controller}).stop()).resolves.toBeUndefined()

    const notReadySnapshots: Array<{body: string; statusCode: number}> = []
    let createNotReadyServer: ReturnType<typeof vi.fn> | undefined
    createNotReadyServer = vi.fn((handler) => ({
      address: () => ({address: '127.0.0.1', family: 'IPv4', port: 4680}),
      close: (callback: (error?: Error | undefined) => void) => callback(),
      listen: (_port: number, _host: string, callback: () => void) => {
        const response = createMockResponse()
        void handler({
          headers: {host: '127.0.0.1:4680'},
          method: 'GET',
          url: '/ui/session',
        } as never, response.raw)
        notReadySnapshots.push({body: response.body, statusCode: response.statusCode})
        callback()
      },
      once: (_event: string, _callback: (error: unknown) => void) => undefined,
    }))
    const notReadyServer = createUiServer({
      assetsDir,
      controller,
      createServer: createNotReadyServer as never,
    })
    await expect(notReadyServer.start({host: '127.0.0.1', port: 4680})).resolves.toEqual({
      host: '127.0.0.1',
      port: 4680,
      url: 'http://127.0.0.1:4680',
    })
    expect(notReadySnapshots).toEqual([{
      body: '{"error":{"code":"UI_NOT_READY","message":"UI server is still starting."},"success":false}\n',
      statusCode: 503,
    }])
    await notReadyServer.stop()

    const defaultOptionsServer = createUiServer({
      assetsDir,
      controller,
      createServer: vi.fn(() => ({
        address: () => ({address: '127.0.0.1', family: 'IPv4', port: 4685}),
        close: (callback: (error?: Error | undefined) => void) => callback(),
        listen: (_port: number, _host: string, callback: () => void) => callback(),
        once: (_event: string, _callback: (error: unknown) => void) => undefined,
      })) as never,
    })
    await expect(defaultOptionsServer.start()).resolves.toEqual({
      host: '127.0.0.1',
      port: 4685,
      url: 'http://127.0.0.1:4685',
    })
    await defaultOptionsServer.stop()

    let errorListener: ((error: unknown) => void) | undefined
    const inUseServer = createUiServer({
      assetsDir,
      controller,
      createServer: vi.fn(() => ({
        address: () => ({address: '127.0.0.1', family: 'IPv4', port: 4680}),
        close: (callback: (error?: Error | undefined) => void) => callback(),
        listen: () => errorListener?.(Object.assign(new Error('busy'), {code: 'EADDRINUSE'})),
        once: (_event: string, callback: (error: unknown) => void) => {
          errorListener = callback
        },
      })) as never,
    })
    await expect(inUseServer.start({port: 4680})).rejects.toMatchObject({
      code: ErrorCode.SANDBOX_PORT_IN_USE,
    })

    const noAddressServer = createUiServer({
      assetsDir,
      controller,
      createServer: vi.fn(() => ({
        address: () => 'pipe',
        close: (callback: (error?: Error | undefined) => void) => callback(),
        listen: (_port: number, _host: string, callback: () => void) => callback(),
        once: (_event: string, _callback: (error: unknown) => void) => undefined,
      })) as never,
    })
    await expect(noAddressServer.start({port: 4680})).rejects.toMatchObject({
      code: ErrorCode.SANDBOX_START_FAILED,
    })

    const closeErrorServer = createUiServer({
      assetsDir,
      controller,
      createServer: vi.fn(() => ({
        address: () => ({address: '127.0.0.1', family: 'IPv4', port: 4681}),
        close: (callback: (error?: Error | undefined) => void) => callback(new Error('close failed')),
        listen: (_port: number, _host: string, callback: () => void) => callback(),
        once: (_event: string, _callback: (error: unknown) => void) => undefined,
      })) as never,
    })
    await closeErrorServer.start({port: 4681})
    await expect(closeErrorServer.stop()).rejects.toThrow('close failed')

    const missingAssetsServer = createUiServer({
      assetsDir: path.join(assetsDir, 'missing'),
      controller,
    })
    await expect(missingAssetsServer.start({port: 4682})).rejects.toMatchObject({
      code: ErrorCode.SDK_COMMAND_FAILED,
    })

    await nodeFs.rm(assetsDir, {force: true, recursive: true})
  })
})

function createControllerStub() {
  return {
    getChecks: vi.fn(async () => ({
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
    })),
    getMap: vi.fn(async () => ({
      autoPoll: false,
      edges: [],
      findings: [],
      groups: [],
      mode: 'remote' as const,
      nodes: [],
      overlays: ['health', 'parties', 'ports', 'auth', 'checks'] as never,
      profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
      summary: {
        detail: 'Remote service graph on devnet.',
        headline: 'Mapped surfaces healthy',
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      },
    })),
    getOverview: vi.fn(async () => ({
      advisories: [],
      environmentPath: [],
      profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
      readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      services: [],
    })),
    getProfiles: vi.fn(async () => ({
      profiles: [],
      selected: {
        auth: {authenticated: true, mode: 'bearer-token', source: 'stored', warnings: []},
        experimental: false,
        imports: {},
        json: {},
        kind: 'remote-validator' as const,
        name: 'splice-devnet',
        networkMappings: [],
        networkName: 'devnet',
        services: [],
        validation: {detail: 'valid', valid: true},
        yaml: 'profiles: {}',
      },
    })),
    getRuntime: vi.fn(async () => ({
      autoPoll: false,
      mode: 'remote' as const,
      profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
    })),
    getSession: vi.fn(async ({requestedProfile}: {requestedProfile?: string} = {}) => ({
      configPath: '/repo/cantonctl.yaml',
      defaultProfile: 'sandbox',
      profiles: [],
      project: {name: 'demo', sdkVersion: '3.4.11'},
      requestedProfile,
      selectedProfile: requestedProfile ?? 'sandbox',
      storageKey: 'cantonctl-ui:/repo/cantonctl.yaml',
    })),
    getSupport: vi.fn(async () => ({
      defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']},
      profile: {kind: 'remote-validator' as const, name: 'splice-devnet'},
    })),
  }
}

async function createAssetsDir(): Promise<string> {
  const dir = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-assets-'))
  await nodeFs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>cantonctl ui</body></html>', 'utf8')
  await nodeFs.writeFile(path.join(dir, 'app.css'), 'body { font-family: serif; }', 'utf8')
  await nodeFs.writeFile(path.join(dir, 'app.js'), 'console.log("ui")', 'utf8')
  await nodeFs.writeFile(path.join(dir, 'data.json'), '{"demo":true}', 'utf8')
  await nodeFs.writeFile(path.join(dir, 'icon.svg'), '<svg viewBox="0 0 10 10"></svg>', 'utf8')
  await nodeFs.writeFile(path.join(dir, 'blob.bin'), 'binary', 'utf8')
  return dir
}

function createMockResponse() {
  const headers = new Map<string, string>()
  let body = ''
  const raw = {
    end(chunk?: Buffer | string) {
      if (chunk) {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      }
    },
    setHeader(name: string, value: number | string | string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
    },
    statusCode: 200,
  } as unknown as net.Server

  return {
    get body() {
      return body
    },
    headers,
    raw: raw as never,
    get statusCode() {
      return (raw as unknown as {statusCode: number}).statusCode
    },
  }
}

function extractSessionToken(html: string): string {
  const match = html.match(/"sessionToken":"([^"]+)"/)
  if (!match) {
    throw new Error('Expected bootstrap session token in shell HTML')
  }

  return match[1]
}
