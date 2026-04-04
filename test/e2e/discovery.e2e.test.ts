import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import DiscoverNetwork from '../../src/commands/discover/network.js'
import ProfilesImportScan from '../../src/commands/profiles/import-scan.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

async function startServer(): Promise<{close(): Promise<void>; url: string}> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let body: unknown = {error: 'not found'}
    let status = 404

    if (url.pathname === '/v0/dso') {
      body = {
        auth_url: 'https://auth.example.com',
        ledger_url: 'https://ledger.example.com',
        validator_url: 'https://validator.example.com',
      }
      status = 200
    } else if (url.pathname === '/v0/scans') {
      body = {scans: [{name: 'sv', url: 'https://scan.example.com'}]}
      status = 200
    } else if (url.pathname === '/v0/dso-sequencers') {
      body = {synchronizers: [{sequencers: [{sequencer_id: 'seq::1'}], synchronizer_id: 'sync::1'}]}
      status = 200
    }

    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
    url: `http://127.0.0.1:${address.port}`,
  }
}

async function runInProject<T extends typeof DiscoverNetwork | typeof ProfilesImportScan>(
  projectDir: string,
  command: T,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwd = process.cwd
  Object.defineProperty(process, 'cwd', {
    configurable: true,
    value: () => projectDir,
  })

  try {
    return await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  } finally {
    Object.defineProperty(process, 'cwd', {
      configurable: true,
      value: cwd.bind(process),
    })
  }
}

describe('discovery E2E', () => {
  let projectDir: string
  let scanServer: {close(): Promise<void>; url: string}
  let workDir: string

  beforeAll(async () => {
    scanServer = await startServer()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-discovery-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), `version: 1

project:
  name: discovery-e2e
  sdk-version: "3.4.11"
`, 'utf8')
  })

  afterAll(async () => {
    await scanServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('discovers scan network metadata from stable/public endpoints', async () => {
    const result = await runInProject(projectDir, DiscoverNetwork, ['--scan-url', scanServer.url, '--json'])
    expect(result.error).toBeUndefined()
    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      scanUrl: scanServer.url,
      scans: expect.any(Array),
      sequencers: expect.any(Array),
    }))
  })

  it('generates a remote-sv-network profile from scan discovery', async () => {
    const result = await runInProject(projectDir, ProfilesImportScan, [
      '--scan-url',
      scanServer.url,
      '--kind',
      'remote-sv-network',
      '--name',
      'sv-profile',
      '--json',
    ])
    expect(result.error).toBeUndefined()
    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      profileName: 'sv-profile',
      profile: expect.objectContaining({
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        kind: 'remote-sv-network',
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: scanServer.url},
      }),
    }))
  })

  it('writes a remote-validator profile block into cantonctl.yaml without removing unrelated config', async () => {
    const result = await runInProject(projectDir, ProfilesImportScan, [
      '--scan-url',
      scanServer.url,
      '--kind',
      'remote-validator',
      '--name',
      'validator-profile',
      '--write',
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    const written = fs.readFileSync(path.join(projectDir, 'cantonctl.yaml'), 'utf8')
    expect(written).toContain('validator-profile:')
    expect(written).toContain('https://validator.example.com')
    expect(written).toContain('project:')
    expect(json.data).toEqual(expect.objectContaining({
      profileName: 'validator-profile',
      write: true,
    }))
  })
})

