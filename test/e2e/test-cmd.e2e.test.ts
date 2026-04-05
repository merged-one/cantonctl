/**
 * E2E tests for `cantonctl test` (TestRunner module).
 * Tests run against real Daml SDK.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {execSync} from 'node:child_process'

import {createDamlSdk} from '../../src/lib/daml.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {createTestRunner} from '../../src/lib/test-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {ENV_PATH, hasSdk, SDK_COMMAND, SDK_VERSION} from './helpers.js'

const SDK_AVAILABLE = hasSdk()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip
const SDK_BUILD_COMMAND = SDK_COMMAND === 'daml'
  ? 'daml build --no-legacy-assistant-warning'
  : 'dpm build'

let workDir: string

beforeAll(() => { workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-test-')) })
afterAll(() => { fs.rmSync(workDir, {recursive: true, force: true}) })

describeWithSdk('test E2E', () => {
  let projectDir: string

  beforeAll(() => {
    // Scaffold and build a token-style companion project
    projectDir = path.join(workDir, 'test-token')
    scaffoldProject({dir: projectDir, name: 'test-token', template: 'splice-token-app'})

    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(path.join(projectDir, 'daml.yaml'), damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`))

    // Build first (tests require compiled project)
    execSync(SDK_BUILD_COMMAND, {
      cwd: projectDir,
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
    })
  }, 60_000)

  it('runs tests and reports success', async () => {
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const testRunner = createTestRunner({sdk})

    const result = await testRunner.run({projectDir})

    expect(result.passed).toBe(true)
    expect(result.success).toBe(true)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.output).toBeTruthy()
  }, 60_000)

  it('output contains test summary (ANSI stripped)', async () => {
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const testRunner = createTestRunner({sdk})

    const result = await testRunner.run({projectDir})

    // Should not contain ANSI escape codes
    expect(result.output).not.toContain('\u001b')
    // Should contain some test-related output
    expect(result.output.length).toBeGreaterThan(0)
  }, 60_000)
})
