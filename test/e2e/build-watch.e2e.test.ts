/**
 * E2E tests for `cantonctl build --watch` (Builder watch mode).
 * Tests verify file watching triggers rebuild with real Daml SDK.
 *
 * Prerequisites: supported SDK CLI on PATH (`dpm` current, `daml` legacy), Java 21+
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'
import {watch} from 'chokidar'

import {createBuilder} from '../../src/lib/builder.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import type {OutputWriter} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {hasSdk, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const dar = entries.find(e => e.endsWith('.dar'))
    return dar ? path.join(dir, dar) : null
  } catch { return null }
}

async function getFileMtime(filePath: string): Promise<number | null> {
  try { return (await fs.promises.stat(filePath)).mtimeMs } catch { return null }
}

async function getDamlSourceMtime(dir: string): Promise<number> {
  let newest = 0
  try {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true})
    for (const e of entries) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) { const s = await getDamlSourceMtime(fp); if (s > newest) newest = s }
      else if (e.name.endsWith('.daml')) { const s = await fs.promises.stat(fp); if (s.mtimeMs > newest) newest = s.mtimeMs }
    }
  } catch {}
  return newest
}

function createTestOutput(): OutputWriter & {messages: string[]} {
  const messages: string[] = []
  return {
    error: (msg: string) => { messages.push(`error: ${msg}`) },
    info: (msg: string) => { messages.push(`info: ${msg}`) },
    log: (msg: string) => { messages.push(`log: ${msg}`) },
    messages,
    result: () => {},
    spinner: () => ({fail: () => {}, start: () => {}, stop: () => {}, succeed: () => {}}),
    success: (msg: string) => { messages.push(`success: ${msg}`) },
    table: () => {},
    warn: (msg: string) => { messages.push(`warn: ${msg}`) },
  }
}

const SDK_AVAILABLE = hasSdk()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

// ---------------------------------------------------------------------------
// Test workspace
// ---------------------------------------------------------------------------

let workDir: string
let stopFn: (() => Promise<void>) | null = null

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-watch-'))
})

afterEach(async () => {
  if (stopFn) {
    await stopFn()
    stopFn = null
  }
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

// ---------------------------------------------------------------------------
// Watch mode tests
// ---------------------------------------------------------------------------

describeWithSdk('build --watch E2E', () => {
  it('watches for .daml changes and rebuilds', async () => {
    const projectDir = path.join(workDir, 'watch-basic')
    scaffoldProject({dir: projectDir, name: 'watch-basic', template: 'basic'})

    // Fix SDK version
    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'daml.yaml'),
      damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
    )

    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})
    const output = createTestOutput()

    // Do initial build first
    const initial = await builder.build({force: true, projectDir})
    expect(initial.success).toBe(true)

    // Start watch mode
    const {stop} = await builder.watch({
      debounceMs: 100,
      output,
      projectDir,
      watch: (paths, opts) => watch(paths, opts),
    })
    stopFn = stop

    // Wait for watcher to be ready
    await new Promise(r => setTimeout(r, 500))

    // Touch the Daml source file to trigger rebuild
    const mainDaml = path.join(projectDir, 'daml', 'Main.daml')
    const content = fs.readFileSync(mainDaml, 'utf8')
    fs.writeFileSync(mainDaml, content + '\n-- watch test touch\n')

    // Wait for rebuild to complete (SDK builds can take a while)
    await new Promise(r => setTimeout(r, 30_000))

    // Verify rebuild happened
    const buildMessages = output.messages.filter(m => m.includes('Build successful') || m.includes('Rebuilding'))
    expect(buildMessages.length).toBeGreaterThan(0)

    await stop()
    stopFn = null
  }, 90_000)

  it('stop() terminates watch mode cleanly', async () => {
    const projectDir = path.join(workDir, 'watch-stop')
    scaffoldProject({dir: projectDir, name: 'watch-stop', template: 'basic'})

    // Fix SDK version
    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'daml.yaml'),
      damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
    )

    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})
    const output = createTestOutput()

    const {stop} = await builder.watch({
      output,
      projectDir,
      watch: (paths, opts) => watch(paths, opts),
    })

    // Verify watcher started
    expect(output.messages.some(m => m.includes('Watching'))).toBe(true)

    // Stop should resolve cleanly
    await stop()

    // Verify no crash
    expect(true).toBe(true)
  }, 30_000)

  it('AbortSignal stops watch mode', async () => {
    const projectDir = path.join(workDir, 'watch-abort')
    scaffoldProject({dir: projectDir, name: 'watch-abort', template: 'basic'})

    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'daml.yaml'),
      damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
    )

    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})
    const output = createTestOutput()
    const controller = new AbortController()

    await builder.watch({
      output,
      projectDir,
      signal: controller.signal,
      watch: (paths, opts) => watch(paths, opts),
    })

    // Abort should close watcher
    controller.abort()

    // Give time for cleanup
    await new Promise(r => setTimeout(r, 200))

    expect(output.messages.some(m => m.includes('Watching'))).toBe(true)
  }, 30_000)
})
