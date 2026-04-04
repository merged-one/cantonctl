/**
 * @module test/e2e/init
 *
 * End-to-end tests for `cantonctl init`. These tests run on real filesystem
 * and invoke the real Daml SDK for compilation and test execution.
 *
 * Prerequisites: supported SDK CLI on PATH (`dpm` current, `daml` legacy), Java 21+
 * Skip condition: Tests are skipped if no supported SDK CLI is available.
 */

import {execSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {loadConfig} from '../../src/lib/config.js'
import {scaffoldProject, type Template} from '../../src/lib/scaffold.js'
import {getUpstreamSource} from '../../src/lib/upstream/manifest.js'
import {ENV_PATH, hasSdk, SDK_COMMAND, SDK_VERSION} from './helpers.js'

const BUILTIN_TEMPLATES: Template[] = [
  'splice-dapp-sdk',
  'splice-scan-reader',
  'splice-token-app',
  'basic',
  'token',
  'defi-amm',
  'api-service',
  'zenith-evm',
]

const PINNED_SDK_VERSION = (() => {
  const source = getUpstreamSource('canton-json-ledger-api-openapi').source
  const version = source.kind === 'git' ? source.ref : source.version
  return version.replace(/^v/, '').split('-')[0]
})()

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

const SDK_AVAILABLE = hasSdk()
const itWithSdk = SDK_AVAILABLE ? it : it.skip
const SDK_BUILD_COMMAND = SDK_COMMAND === 'daml'
  ? 'daml build --no-legacy-assistant-warning'
  : 'dpm build'
const SDK_TEST_COMMAND = SDK_COMMAND === 'daml'
  ? 'daml test --no-legacy-assistant-warning'
  : 'dpm test'

let workDir: string

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-init-'))
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

describe('init E2E: scaffold', () => {
  for (const template of BUILTIN_TEMPLATES) {
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

      it('generated cantonctl.yaml passes schema validation and normalizes profiles', async () => {
        const config = await loadConfig({dir: projectDir})
        expect(config.version).toBe(1)
        expect(config.project.name).toBe(`test-${template}`)
        expect(config.project['sdk-version']).toBe(PINNED_SDK_VERSION)
        expect(config.project.template).toBe(template)
        expect(config['default-profile']).toBe('sandbox')
        expect(config.networkProfiles?.local).toBe('sandbox')
        expect(config.profiles?.sandbox.kind).toBe('sandbox')
        expect(config.profiles?.sandbox.services.ledger).toEqual({
          port: 5001,
          'json-api-port': 7575,
        })
        expect(config.parties).toBeDefined()
        expect(config.parties!.length).toBeGreaterThan(0)
      })

      it('writes profile-based runtime config to disk', () => {
        const raw = fs.readFileSync(path.join(projectDir, 'cantonctl.yaml'), 'utf8')
        expect(raw).toContain('default-profile: sandbox')
        expect(raw).toContain('profiles:')
        expect(raw).toContain('profile: sandbox')
        expect(raw).toContain(`sdk-version: "${PINNED_SDK_VERSION}"`)
      })

      it('adds a splice devnet profile for Splice-aware templates', async () => {
        const config = await loadConfig({dir: projectDir})
        if (template.startsWith('splice-')) {
          expect(config.networkProfiles?.devnet).toBe('splice-devnet')
          expect(config.profiles?.['splice-devnet']).toMatchObject({
            kind: 'remote-validator',
            services: {
              auth: {kind: 'oidc'},
            },
          })
          return
        }

        expect(config.networkProfiles?.devnet).toBeUndefined()
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

  it('splice-token-app creates stable token starter files', () => {
    const dir = path.join(workDir, 'test-splice-token-app')
    expect(fs.existsSync(path.join(dir, 'frontend', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'frontend', 'src', 'token-client.ts'))).toBe(true)

    const tokenClient = fs.readFileSync(path.join(dir, 'frontend', 'src', 'token-client.ts'), 'utf8')
    expect(tokenClient).toContain('transfer-instruction')
    expect(tokenClient).not.toContain('burn-mint')
    expect(tokenClient).not.toContain('validator-internal')
  })

  it('splice-scan-reader creates stable scan reader files', () => {
    const dir = path.join(workDir, 'test-splice-scan-reader')
    expect(fs.existsSync(path.join(dir, 'scripts', 'read-scan-updates.mjs'))).toBe(true)

    const reader = fs.readFileSync(path.join(dir, 'scripts', 'read-scan-updates.mjs'), 'utf8')
    expect(reader).toContain('/v2/updates')
    expect(reader).not.toContain('validator-internal')
  })

  it('splice-dapp-sdk creates public SDK starter files', () => {
    const dir = path.join(workDir, 'test-splice-dapp-sdk')
    expect(fs.existsSync(path.join(dir, 'frontend', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'frontend', 'src', 'wallet.ts'))).toBe(true)

    const packageJson = fs.readFileSync(path.join(dir, 'frontend', 'package.json'), 'utf8')
    expect(packageJson).toContain('@canton-network/dapp-sdk')
    expect(packageJson).toContain('@canton-network/wallet-sdk')
  })

  it('scaffold fails on existing directory', () => {
    const dir = path.join(workDir, 'test-basic')
    expect(() => scaffoldProject({dir, name: 'test-basic', template: 'basic'})).toThrow()
  })
})

describe('init E2E: Daml compilation', () => {
  for (const template of BUILTIN_TEMPLATES) {
    itWithSdk(`${template} template compiles with the SDK build command`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      scaffoldProject({dir: projectDir, name: `compile-${template}`, template})

      const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
      fs.writeFileSync(
        path.join(projectDir, 'daml.yaml'),
        damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
      )

      const result = run(SDK_BUILD_COMMAND, projectDir)
      expect(result.exitCode).toBe(0)

      const darDir = path.join(projectDir, '.daml', 'dist')
      expect(fs.existsSync(darDir)).toBe(true)
      const dars = fs.readdirSync(darDir).filter(f => f.endsWith('.dar'))
      expect(dars.length).toBeGreaterThan(0)
    })
  }

  for (const template of BUILTIN_TEMPLATES) {
    itWithSdk(`${template} template tests pass with the SDK test command`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      const result = run(SDK_TEST_COMMAND, projectDir)
      expect(result.exitCode).toBe(0)
    })
  }
})

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
