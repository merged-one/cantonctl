/**
 * @module serve
 *
 * Canton IDE Protocol Server — the generic backend that any IDE client
 * (browser playground, VS Code extension, Neovim plugin) connects to.
 *
 * Exposes a REST + WebSocket API backed by existing cantonctl libraries
 * (builder, test-runner, ledger-client, dev-server). The protocol is
 * documented at docs/reference/serve.md.
 *
 * Clients:
 * - `cantonctl playground` — serves the browser UI + starts this server
 * - `cantonctl serve` — headless mode (no UI, just the API)
 * - VS Code extension — connects to a running serve instance
 *
 * @example
 * ```ts
 * const server = createServeServer(deps)
 * await server.start({ port: 4000, projectDir: '/my-app' })
 * // Any IDE client connects to http://localhost:4000
 * ```
 */

import cors from 'cors'
import express, {type Request, type Response} from 'express'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import {WebSocketServer, type WebSocket} from 'ws'

import type {Builder} from './builder.js'
import {parseDamlSource, type DamlTemplate} from './daml-parser.js'
import type {OutputWriter} from './output.js'
import type {TestRunner} from './test-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServeServerDeps {
  builder: Builder
  output: OutputWriter
  testRunner: TestRunner
  /** Factory for creating ledger clients — called with baseUrl + token. */
  createLedgerClient: (opts: {baseUrl: string; token: string}) => LedgerClientLike
  /** Factory for creating sandbox JWTs. */
  createToken: (opts: {actAs: string[]; admin: boolean; applicationId: string; readAs: string[]}) => Promise<string>
}

export interface LedgerClientLike {
  getVersion(signal?: AbortSignal): Promise<Record<string, unknown>>
  getParties(signal?: AbortSignal): Promise<{partyDetails: Array<Record<string, unknown>>}>
  getActiveContracts(params: {filter: {party: string; templateIds?: string[]}}, signal?: AbortSignal): Promise<{activeContracts: Array<Record<string, unknown>>}>
  submitAndWait(request: {actAs: string[]; commandId?: string; commands: unknown[]}, signal?: AbortSignal): Promise<{transaction: Record<string, unknown>}>
  allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal): Promise<{partyDetails: Record<string, unknown>}>
}

export interface ServeEvent {
  type: string
  [key: string]: unknown
}

export interface ServeServer {
  start(opts: {port: number; projectDir: string; ledgerUrl: string; staticDir?: string}): Promise<void>
  stop(): Promise<void>
  broadcast(event: ServeEvent): void
}

// ---------------------------------------------------------------------------
// File tree helper
// ---------------------------------------------------------------------------

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

async function buildFileTree(dir: string, relativeTo: string): Promise<FileNode[]> {
  const entries = await fs.promises.readdir(dir, {withFileTypes: true})
  const nodes: FileNode[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Skip hidden dirs and build artifacts
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(relativeTo, fullPath)

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, relativeTo)
      nodes.push({children, name: entry.name, path: relPath, type: 'directory'})
    } else {
      nodes.push({name: entry.name, path: relPath, type: 'file'})
    }
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Template discovery — scans .daml files and parses templates
// ---------------------------------------------------------------------------

async function scanDamlTemplates(projectDir: string): Promise<DamlTemplate[]> {
  const damlDir = path.join(projectDir, 'daml')
  const templates: DamlTemplate[] = []

  try {
    const entries = await fs.promises.readdir(damlDir, {recursive: true})
    for (const entry of entries) {
      const entryStr = String(entry)
      if (!entryStr.endsWith('.daml')) continue

      const filePath = path.join(damlDir, entryStr)
      const source = await fs.promises.readFile(filePath, 'utf-8')
      const result = parseDamlSource(source)
      templates.push(...result.templates)
    }
  } catch {
    // daml/ directory doesn't exist or can't be read
  }

  return templates
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createServeServer(deps: ServeServerDeps): ServeServer {
  const {builder, createLedgerClient, createToken, output, testRunner} = deps

  let httpServer: http.Server | null = null
  let wss: WebSocketServer | null = null
  const clients = new Set<WebSocket>()

  function broadcast(event: ServeEvent): void {
    const msg = JSON.stringify(event)
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg)
      }
    }
  }

  return {
    broadcast,

    async start(opts) {
      const {ledgerUrl, port, projectDir, staticDir} = opts

      // Create JWT for sandbox
      const token = await createToken({
        actAs: ['Alice', 'Bob'],
        admin: true,
        applicationId: 'cantonctl-playground',
        readAs: ['Alice', 'Bob'],
      })

      const client = createLedgerClient({baseUrl: ledgerUrl, token})

      // Express app
      const app = express()
      app.use(cors())
      app.use(express.json())

      // ── REST API ────────────────────────────────────────────────

      app.get('/api/health', async (_req: Request, res: Response) => {
        try {
          const version = await client.getVersion()
          res.json({healthy: true, ...version})
        } catch {
          res.json({healthy: false})
        }
      })

      app.get('/api/files', async (_req: Request, res: Response) => {
        try {
          const tree = await buildFileTree(projectDir, projectDir)
          res.json(tree)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // File operations — use middleware to handle subpaths (Express 5 compat)
      app.use('/api/files', async (req: Request, res: Response, next) => {
        // GET /api/files with no subpath → return file tree (handled above)
        if (req.path === '/' || req.path === '') {
          next()
          return
        }

        const reqPath = decodeURIComponent(req.path.slice(1))
        const filePath = path.join(projectDir, reqPath)
        if (!filePath.startsWith(projectDir)) {
          res.status(403).json({error: 'Path traversal not allowed'})
          return
        }

        if (req.method === 'GET') {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8')
            res.json({content, path: reqPath})
          } catch {
            res.status(404).json({error: 'File not found'})
          }

          return
        }

        if (req.method === 'PUT') {
          try {
            await fs.promises.mkdir(path.dirname(filePath), {recursive: true})
            await fs.promises.writeFile(filePath, req.body.content, 'utf-8')
            res.json({saved: true, path: reqPath})

            // Auto-build on .daml file save
            if (filePath.endsWith('.daml')) {
              broadcast({type: 'build:start'})
              try {
                const result = await builder.build({projectDir})
                broadcast({
                  dar: result.darPath,
                  durationMs: result.durationMs,
                  type: result.cached ? 'build:cached' : 'build:success',
                })
              } catch (err) {
                broadcast({output: String(err), type: 'build:error'})
              }
            }
          } catch (err) {
            res.status(500).json({error: String(err)})
          }

          return
        }

        next()
      })

      app.get('/api/parties', async (_req: Request, res: Response) => {
        try {
          const result = await client.getParties()
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/parties', async (req: Request, res: Response) => {
        try {
          const result = await client.allocateParty({
            displayName: req.body.displayName,
            identifierHint: req.body.identifierHint,
          })
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Template Discovery ──────────────────────────────────────

      app.get('/api/templates', async (_req: Request, res: Response) => {
        try {
          const templates = await scanDamlTemplates(projectDir)
          res.json({templates})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.get('/api/templates/:name', async (req: Request, res: Response) => {
        try {
          const templates = await scanDamlTemplates(projectDir)
          const template = templates.find(t => t.name === String(req.params.name))
          if (!template) {
            res.status(404).json({error: `Template "${req.params.name}" not found`})
            return
          }

          res.json(template)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Multi-Party Contracts ─────────────────────────────────

      app.get('/api/contracts/multi', async (req: Request, res: Response) => {
        const partiesParam = req.query.parties as string
        if (!partiesParam) {
          res.status(400).json({error: 'parties query parameter required (comma-separated)'})
          return
        }

        const partyIds = partiesParam.split(',').map(p => p.trim()).filter(Boolean)
        try {
          const results: Record<string, Array<Record<string, unknown>>> = {}
          await Promise.all(
            partyIds.map(async (party) => {
              try {
                const result = await client.getActiveContracts({filter: {party}})
                results[party] = result.activeContracts
              } catch {
                results[party] = []
              }
            }),
          )
          res.json({contracts: results})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Single-Party Contracts ────────────────────────────────

      app.get('/api/contracts', async (req: Request, res: Response) => {
        const party = req.query.party as string
        const templateId = req.query.templateId as string | undefined
        if (!party) {
          res.status(400).json({error: 'party query parameter required'})
          return
        }

        try {
          const result = await client.getActiveContracts({
            filter: {
              party,
              ...(templateId ? {templateIds: [templateId]} : {}),
            },
          })
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/commands', async (req: Request, res: Response) => {
        try {
          const result = await client.submitAndWait({
            actAs: req.body.actAs,
            commandId: `playground-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            commands: req.body.commands,
          })
          res.json(result)
          broadcast({type: 'contracts:update'})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/build', async (_req: Request, res: Response) => {
        broadcast({type: 'build:start'})
        try {
          const result = await builder.build({force: true, projectDir})
          broadcast({dar: result.darPath, durationMs: result.durationMs, type: 'build:success'})
          res.json(result)
        } catch (err) {
          broadcast({output: String(err), type: 'build:error'})
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/test', async (_req: Request, res: Response) => {
        broadcast({type: 'test:start'})
        try {
          const result = await testRunner.run({projectDir})
          broadcast({output: result.output, passed: result.passed, type: 'test:result'})
          res.json(result)
        } catch (err) {
          broadcast({output: String(err), passed: false, type: 'test:result'})
          res.status(500).json({error: String(err)})
        }
      })

      // Serve playground static files
      if (staticDir) {
        app.use(express.static(staticDir))
        app.use((_req: Request, res: Response) => {
          res.sendFile(path.join(staticDir, 'index.html'))
        })
      }

      // ── HTTP + WebSocket Server ─────────────────────────────────

      httpServer = http.createServer(app)
      wss = new WebSocketServer({server: httpServer})

      wss.on('connection', (ws: WebSocket) => {
        clients.add(ws)
        ws.on('close', () => clients.delete(ws))
        // Send initial status
        ws.send(JSON.stringify({type: 'connected'}))
      })

      return new Promise<void>((resolve) => {
        httpServer!.listen(port, () => {
          output.success(`Canton IDE server running at http://localhost:${port}`)
          resolve()
        })
      })
    },

    async stop() {
      for (const ws of clients) ws.close()
      clients.clear()
      wss?.close()
      return new Promise<void>((resolve) => {
        if (httpServer) {
          httpServer.close(() => resolve())
        } else {
          resolve()
        }
      })
    },
  }
}
