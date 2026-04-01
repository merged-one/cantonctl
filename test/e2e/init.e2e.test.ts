/**
 * @module test/e2e/init
 *
 * End-to-end tests for `cantonctl init`. These tests run on real filesystem
 * and invoke the real Daml SDK for compilation and test execution.
 *
 * Prerequisites: daml CLI on PATH, Java 21+
 * Skip condition: Tests are skipped if daml is not available.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {execSync} from 'node:child_process'

import {loadConfig} from '../../src/lib/config.js'
import {scaffoldProject, type Template} from '../../src/lib/scaffold.js'
import {ENV_PATH, hasDaml, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd: string): {stdout: string; stderr: string; exitCode: number} {
  try {
    const stdout = execSync(cmd, {
      cwd,
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
      timeout: 120_000,
    }).toString()
    return {exitCode: 0, stderr: '', stdout}
  } catch (err: unknown) {
    const e = err as {status?: number; stdout?: Buffer; stderr?: Buffer}
    return {
      exitCode: e.status ?? 1,
      stderr: e.stderr?.toString() ?? '',
      stdout: e.stdout?.toString() ?? '',
    }
  }
}

const SDK_AVAILABLE = hasDaml()
const itWithSdk = SDK_AVAILABLE ? it : it.skip

// ---------------------------------------------------------------------------
// Test workspace
// ---------------------------------------------------------------------------

let workDir: string

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-init-'))
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

// ---------------------------------------------------------------------------
// Scaffold tests (no SDK needed)
// ---------------------------------------------------------------------------

describe('init E2E: scaffold', () => {
  const templates: Template[] = ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm']

  for (const template of templates) {
    describe(`template: ${template}`, () => {
      let projectDir: string

      beforeAll(() => {
        projectDir = path.join(workDir, `test-${template}`)
        scaffoldProject({dir: projectDir, name: `test-${template}`, template})
      })

      it('creates project directory', () => {
        expect(fs.existsSync(projectDir)).toBe(true)
      })

      it('creates cantonctl.yaml', () => {
        expect(fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))).toBe(true)
      })

      it('creates daml.yaml', () => {
        expect(fs.existsSync(path.join(projectDir, 'daml.yaml'))).toBe(true)
      })

      it('creates daml/Main.daml', () => {
        expect(fs.existsSync(path.join(projectDir, 'daml', 'Main.daml'))).toBe(true)
      })

      it('creates test/Main.test.daml', () => {
        expect(fs.existsSync(path.join(projectDir, 'test', 'Main.test.daml'))).toBe(true)
      })

      it('creates .gitignore', () => {
        expect(fs.existsSync(path.join(projectDir, '.gitignore'))).toBe(true)
      })

      it('generated cantonctl.yaml passes schema validation', async () => {
        const config = await loadConfig({dir: projectDir})
        expect(config.version).toBe(1)
        expect(config.project.name).toBe(`test-${template}`)
        expect(config.project['sdk-version']).toBeDefined()
        expect(config.parties).toBeDefined()
        expect(config.parties!.length).toBeGreaterThan(0)
      })

      it('generated cantonctl.yaml has correct template', async () => {
        const config = await loadConfig({dir: projectDir})
        expect(config.project.template).toBe(template)
      })
    })
  }

  it('api-service template creates server files', () => {
    const dir = path.join(workDir, 'test-api-service')
    expect(fs.existsSync(path.join(dir, 'server', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'server', 'src', 'server.ts'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'server', 'tsconfig.json'))).toBe(true)
  })

  it('zenith-evm template creates Solidity and Hardhat files', () => {
    const dir = path.join(workDir, 'test-zenith-evm')
    expect(fs.existsSync(path.join(dir, 'contracts', 'Token.sol'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'hardhat.config.ts'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true)
  })

  it('scaffold fails on existing directory', () => {
    const dir = path.join(workDir, 'test-basic') // already exists
    expect(() => scaffoldProject({dir, name: 'test-basic', template: 'basic'})).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Daml compilation tests (SDK required)
// ---------------------------------------------------------------------------

describe('init E2E: Daml compilation', () => {
  // These templates should compile with the real Daml SDK
  const damlTemplates: Template[] = ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm']

  for (const template of damlTemplates) {
    itWithSdk(`${template} template compiles with daml build`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      scaffoldProject({dir: projectDir, name: `compile-${template}`, template})

      // Fix sdk-version to match installed version
      const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
      fs.writeFileSync(
        path.join(projectDir, 'daml.yaml'),
        damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
      )

      const result = run('daml build --no-legacy-assistant-warning', projectDir)
      expect(result.exitCode).toBe(0)
      // Verify .dar was actually created
      const darDir = path.join(projectDir, '.daml', 'dist')
      expect(fs.existsSync(darDir)).toBe(true)
      const dars = fs.readdirSync(darDir).filter(f => f.endsWith('.dar'))
      expect(dars.length).toBeGreaterThan(0)
    })
  }

  for (const template of damlTemplates) {
    itWithSdk(`${template} template tests pass with daml test`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      // Project was already built in the previous test

      const result = run('daml test --no-legacy-assistant-warning', projectDir)
      expect(result.exitCode).toBe(0)
    })
  }
})

// ---------------------------------------------------------------------------
// JSON output test
// ---------------------------------------------------------------------------

describe('init E2E: JSON output', () => {
  it('scaffold returns structured result with files list', () => {
    const dir = path.join(workDir, 'json-test')
    const result = scaffoldProject({dir, name: 'json-test', template: 'basic'})

    expect(result.projectDir).toBe(dir)
    expect(result.template).toBe('basic')
    expect(result.files).toContain('cantonctl.yaml')
    expect(result.files).toContain('daml.yaml')
    expect(result.files).toContain(path.join('daml', 'Main.daml'))
    expect(result.files).toContain(path.join('test', 'Main.test.daml'))
    expect(result.files).toContain('.gitignore')
  })
})
