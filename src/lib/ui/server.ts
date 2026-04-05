import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import {CantonctlError, ErrorCode} from '../errors.js'

import type {UiApiEnvelope} from './contracts.js'
import type {UiController} from './controller.js'
import {toUiApiError} from './jobs.js'

const API_PREFIX = '/ui'

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
  let server: http.Server | undefined

  return {
    async start(options = {}) {
      ensureAssetsDir(assetsDir, fsImpl)

      server = createServerImpl((request, response) => {
        void handleRequest(request, response, {assetsDir, controller, fs: fsImpl})
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
      server = undefined
    },
  }
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  deps: {
    assetsDir: string
    controller: UiController
    fs: typeof fs
  },
): Promise<void> {
  try {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (url.pathname.startsWith(API_PREFIX)) {
      await handleApiRequest(method, url, request, response, deps.controller)
      return
    }

    await serveStatic(url.pathname, response, deps.assetsDir, deps.fs)
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
  request: http.IncomingMessage,
  response: http.ServerResponse,
  controller: UiController,
): Promise<void> {
  const profileName = url.searchParams.get('profile') ?? undefined

  if (method === 'GET') {
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
      case '/ui/checks': {
        writeJson(response, 200, {data: await controller.getChecks({profileName}), success: true})
        return
      }

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
        break
    }

    if (url.pathname.startsWith('/ui/jobs/')) {
      const id = url.pathname.slice('/ui/jobs/'.length)
      const job = controller.getJob(id)
      if (!job) {
        writeJson(response, 404, {
          error: {
            code: ErrorCode.SERVICE_NOT_CONFIGURED,
            message: 'Job not found.',
          },
          success: false,
        })
        return
      }

      writeJson(response, 200, {data: job, success: true})
      return
    }
  }

  if (method === 'POST' && url.pathname.startsWith('/ui/actions/')) {
    const payload = await readJsonBody(request)
    const action = url.pathname.slice('/ui/actions/'.length) as Parameters<UiController['startAction']>[0]
    const started = await controller.startAction(action, {payload, profileName})
    writeJson(response, 202, {data: started, success: true})
    return
  }

  writeJson(response, 404, {
    error: {
      code: ErrorCode.SERVICE_NOT_CONFIGURED,
      message: 'Route not found.',
    },
    success: false,
  })
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  const body = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(body) as Record<string, unknown>
}

async function serveStatic(
  pathname: string,
  response: http.ServerResponse,
  assetsDir: string,
  fsImpl: typeof fs,
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

  const body = await fsImpl.promises.readFile(targetPath)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', contentType(targetPath))
  response.statusCode = 200
  response.end(body)
}

function writeJson<T>(
  response: http.ServerResponse,
  statusCode: number,
  payload: UiApiEnvelope<T>,
): void {
  response.statusCode = statusCode
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

function writeText(response: http.ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end(body)
}

function contentType(filePath: string): string {
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

function mapServerError(error: unknown, port: number): Error {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    return new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
      suggestion: `Port ${port} is already in use. Re-run with --port <n>.`,
    })
  }

  return error instanceof Error ? error : new Error(String(error))
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
