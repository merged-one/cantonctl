import {randomUUID} from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import {CantonctlError, ErrorCode} from '../errors.js'

import type {UiApiEnvelope, UiBootstrapData} from './contracts.js'
import type {UiController} from './controller.js'

const API_PREFIX = '/ui'
const SESSION_HEADER = 'x-cantonctl-ui-session'

export interface UiRequestPolicy {
  allowedHostnames: Set<string>
  port: number
  sessionToken: string
}

export interface UiServer {
  start(options?: {host?: string; port?: number}): Promise<{host: string; port: number; url: string}>
  stop(): Promise<void>
}

export interface UiServerDeps {
  assetsDir: string
  controller: UiController
  createServer?: typeof http.createServer
  fs?: typeof fs
}

export function createUiServer(deps: UiServerDeps): UiServer {
  const assetsDir = deps.assetsDir
  const controller = deps.controller
  const createServerImpl = deps.createServer ?? http.createServer
  const fsImpl = deps.fs ?? fs
  let requestPolicy: UiRequestPolicy | undefined
  let server: http.Server | undefined

  return {
    async start(options = {}) {
      ensureAssetsDir(assetsDir, fsImpl)

      server = createServerImpl((request, response) => {
        void handleRequest(request, response, {
          assetsDir,
          controller,
          fs: fsImpl,
          requestPolicy,
        })
      })

      const host = options.host ?? '127.0.0.1'
      const requestedPort = options.port ?? 4680

      await new Promise<void>((resolve, reject) => {
        server!.once('error', (error) => {
          reject(mapServerError(error, requestedPort))
        })
        server!.listen(requestedPort, host, () => resolve())
      })

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new CantonctlError(ErrorCode.SANDBOX_START_FAILED, {
          suggestion: 'The UI server did not bind to a TCP port.',
        })
      }

      requestPolicy = {
        allowedHostnames: createAllowedHostnames(host),
        port: address.port,
        sessionToken: randomUUID(),
      }

      return {
        host,
        port: address.port,
        url: `http://${host}:${address.port}`,
      }
    },

    async stop() {
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
      requestPolicy = undefined
      server = undefined
    },
  }
}

export async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  deps: {
    assetsDir: string
    controller: UiController
    fs: typeof fs
    requestPolicy?: UiRequestPolicy
  },
): Promise<void> {
  try {
    if (!deps.requestPolicy) {
      writeJson(response, 503, {
        error: {code: 'UI_NOT_READY', message: 'UI server is still starting.'},
        success: false,
      })
      return
    }

    const hostError = validateLocalRequest(request, deps.requestPolicy)
    if (hostError) {
      writeJson(response, 403, {
        error: hostError,
        success: false,
      })
      return
    }

    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname.startsWith(API_PREFIX)) {
      const apiError = validateApiRequest(request, deps.requestPolicy)
      if (apiError) {
        writeJson(response, 403, {
          error: apiError,
          success: false,
        })
        return
      }

      await handleApiRequest(method, url, response, deps.controller)
      return
    }

    await serveStatic(url.pathname, response, deps.assetsDir, deps.fs, {
      sessionToken: deps.requestPolicy.sessionToken,
    })
  } catch (error) {
    writeJson(response, 500, {
      error: toUiApiError(error),
      success: false,
    })
  }
}

async function handleApiRequest(
  method: string,
  url: URL,
  response: http.ServerResponse,
  controller: UiController,
): Promise<void> {
  const profileName = url.searchParams.get('profile') ?? undefined

  if (method !== 'GET') {
    writeJson(response, 405, {
      error: {
        code: 'UI_METHOD_NOT_ALLOWED',
        message: 'Only GET is supported by the hardened UI bridge.',
      },
      success: false,
    })
    return
  }

  switch (url.pathname) {
    case '/ui/session':
      writeJson(response, 200, {data: await controller.getSession({requestedProfile: profileName}), success: true})
      return
    case '/ui/overview':
      writeJson(response, 200, {data: await controller.getOverview({profileName}), success: true})
      return
    case '/ui/profiles':
      writeJson(response, 200, {data: await controller.getProfiles({profileName}), success: true})
      return
    case '/ui/runtime':
      writeJson(response, 200, {data: await controller.getRuntime({profileName}), success: true})
      return
    case '/ui/checks':
      writeJson(response, 200, {data: await controller.getChecks({profileName}), success: true})
      return
    case '/ui/checks/auth': {
      const checks = await controller.getChecks({profileName})
      writeJson(response, 200, {data: checks.auth, success: true})
      return
    }
    case '/ui/checks/compatibility': {
      const checks = await controller.getChecks({profileName})
      writeJson(response, 200, {data: checks.compatibility, success: true})
      return
    }
    case '/ui/checks/preflight': {
      const checks = await controller.getChecks({profileName})
      writeJson(response, 200, {data: checks.preflight, success: true})
      return
    }
    case '/ui/checks/canary': {
      const checks = await controller.getChecks({profileName})
      writeJson(response, 200, {data: checks.canary, success: true})
      return
    }
    case '/ui/checks/doctor': {
      const checks = await controller.getChecks({profileName})
      writeJson(response, 200, {data: checks.doctor, success: true})
      return
    }
    case '/ui/support':
      writeJson(response, 200, {data: await controller.getSupport({profileName}), success: true})
      return
    default:
      writeJson(response, 404, {
        error: {
          code: ErrorCode.SERVICE_NOT_CONFIGURED,
          message: 'Route not found.',
        },
        success: false,
      })
  }
}

export async function serveStatic(
  pathname: string,
  response: http.ServerResponse,
  assetsDir: string,
  fsImpl: typeof fs,
  bootstrap: UiBootstrapData,
): Promise<void> {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname
  const filePath = path.join(assetsDir, normalizedPath.replace(/^\/+/, ''))
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(assetsDir))) {
    writeText(response, 403, 'Forbidden')
    return
  }

  const targetPath = fsImpl.existsSync(resolved)
    ? resolved
    : path.join(assetsDir, 'index.html')

  if (path.basename(targetPath) === 'index.html') {
    const html = await fsImpl.promises.readFile(targetPath, 'utf8')
    writeHtml(response, 200, injectBootstrap(html, bootstrap))
    return
  }

  const body = await fsImpl.promises.readFile(targetPath)
  setCommonHeaders(response)
  response.setHeader('Content-Type', contentType(targetPath))
  response.statusCode = 200
  response.end(body)
}

export function validateLocalRequest(
  request: http.IncomingMessage,
  policy: UiRequestPolicy,
): {code: string; message: string} | null {
  if (!matchesLocalOrigin(request.headers.host, policy)) {
    return {
      code: 'UI_FORBIDDEN_HOST',
      message: 'UI requests must target the local control-center origin.',
    }
  }

  const origin = request.headers.origin
  if (origin && !matchesLocalOrigin(origin, policy)) {
    return {
      code: 'UI_FORBIDDEN_ORIGIN',
      message: 'UI requests must originate from the local control-center origin.',
    }
  }

  return null
}

export function validateApiRequest(
  request: http.IncomingMessage,
  policy: UiRequestPolicy,
): {code: string; message: string} | null {
  const token = request.headers[SESSION_HEADER]
  const sessionToken = Array.isArray(token) ? token[0] : token
  if (sessionToken !== policy.sessionToken) {
    return {
      code: 'UI_INVALID_SESSION',
      message: 'Missing or invalid UI session token.',
    }
  }

  return null
}

export function matchesLocalOrigin(value: string | undefined, policy: UiRequestPolicy): boolean {
  if (!value) return false

  try {
    const target = value.includes('://')
      ? new URL(value)
      : new URL(`http://${value}`)
    const port = target.port ? Number(target.port) : 80
    return policy.allowedHostnames.has(target.hostname) && port === policy.port
  } catch {
    return false
  }
}

export function createAllowedHostnames(host: string): Set<string> {
  const allowed = new Set<string>([host])
  if (host === '127.0.0.1') {
    allowed.add('localhost')
  }
  if (host === 'localhost') {
    allowed.add('127.0.0.1')
  }
  return allowed
}

export function injectBootstrap(html: string, bootstrap: UiBootstrapData): string {
  const script = `<script>window.__CANTONCTL_UI__=${JSON.stringify(bootstrap)};</script>`
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`)
  }

  return `${script}${html}`
}

function writeJson<T>(
  response: http.ServerResponse,
  statusCode: number,
  payload: UiApiEnvelope<T>,
): void {
  setCommonHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

function writeHtml(response: http.ServerResponse, statusCode: number, body: string): void {
  setCommonHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(body)
}

function writeText(response: http.ServerResponse, statusCode: number, body: string): void {
  setCommonHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end(body)
}

function setCommonHeaders(response: http.ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

export function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function ensureAssetsDir(assetsDir: string, fsImpl: typeof fs): void {
  const indexPath = path.join(assetsDir, 'index.html')
  if (fsImpl.existsSync(indexPath)) {
    return
  }

  throw new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
    suggestion: `Build the UI bundle first so ${indexPath} exists.`,
  })
}

export function mapServerError(error: unknown, port: number): Error {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    return new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
      suggestion: `Port ${port} is already in use. Re-run with --port <n>.`,
    })
  }

  return error instanceof Error ? error : new Error(String(error))
}

export function toUiApiError(error: unknown): {code: string; message: string; suggestion?: string} {
  if (error instanceof CantonctlError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: error.suggestion || undefined,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED',
      message: error.message,
    }
  }

  return {
    code: 'UNEXPECTED',
    message: String(error),
  }
}

export function resolveUiAssetsDir(cwd = process.cwd()): string {
  const candidates = [
    path.resolve(cwd, 'dist', 'ui'),
    path.resolve(cwd, 'ui', 'dist'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate
    }
  }

  return candidates[0]
}
