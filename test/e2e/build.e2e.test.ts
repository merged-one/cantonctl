/**
 * E2E tests for `cantonctl build` (Builder module).
 * Tests run against real Daml SDK.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {createBuilder} from '../../src/lib/builder.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject, type Template} from '../../src/lib/scaffold.js'
import {hasDaml, SDK_VERSION} from './helpers.js'

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

const SDK_AVAILABLE = hasDaml()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

let workDir: string

beforeAll(() => { workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-build-')) })
afterAll(() => { fs.rmSync(workDir, {recursive: true, force: true}) })

describeWithSdk('build E2E', () => {
  const templates: Template[] = ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm']

  for (const template of templates) {
    it(`builds ${template} template and produces .dar`, async () => {
      const projectDir = path.join(workDir, `build-${template}`)
      scaffoldProject({dir: projectDir, name: `build-${template}`, template})

      // Fix SDK version
      const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
      fs.writeFileSync(path.join(projectDir, 'daml.yaml'), damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`))

      const runner = createProcessRunner()
      const sdk = createDamlSdk({runner})
      const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})

      const result = await builder.build({projectDir})

      expect(result.success).toBe(true)
      expect(result.darPath).toBeTruthy()
      expect(fs.existsSync(result.darPath!)).toBe(true)
      expect(result.darPath!.endsWith('.dar')).toBe(true)
    }, 60_000)
  }

  it('cache hit on second build (no source changes)', async () => {
    const projectDir = path.join(workDir, 'build-basic') // Already built above
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})

    const result = await builder.build({projectDir})

    expect(result.success).toBe(true)
    expect(result.cached).toBe(true)
  }, 30_000)

  it('rebuilds after source modification', async () => {
    const projectDir = path.join(workDir, 'build-basic')
    // Touch a source file to make it newer
    const mainDaml = path.join(projectDir, 'daml', 'Main.daml')
    const content = fs.readFileSync(mainDaml, 'utf8')
    fs.writeFileSync(mainDaml, content + '\n-- touched\n')

    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})

    const result = await builder.build({projectDir})

    expect(result.success).toBe(true)
    expect(result.cached).toBeFalsy()
  }, 60_000)
})
