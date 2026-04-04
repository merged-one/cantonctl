import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import CompatCheck from '../../src/commands/compat/check.js'
import CodegenSync from '../../src/commands/codegen/sync.js'
import ProfilesShow from '../../src/commands/profiles/show.js'
import {getPinnedCantonSdkVersion} from '../../src/lib/upstream/manifest.js'
import type {ProcessRunner} from '../../src/lib/process-runner.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function writeConfig(projectDir: string, contents: string): void {
  fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), contents)
}

async function runInProject<T extends typeof CompatCheck | typeof ProfilesShow>(
  command: T,
  projectDir: string,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir)

  try {
    return await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  } finally {
    cwdSpy.mockRestore()
  }
}

describe('compat and migration E2E', () => {
  let workDir: string

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-compat-'))
  })

  afterAll(() => {
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('migrates a legacy sandbox networks config into a default local profile for compatibility checks', async () => {
    const projectDir = path.join(workDir, 'legacy-sandbox')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

project:
  name: legacy-sandbox
  sdk-version: "${getPinnedCantonSdkVersion()}"

networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575
`,
    )

    const result = await runInProject(CompatCheck, projectDir, ['--json'])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      failed: 0,
      profile: {
        experimental: false,
        kind: 'sandbox',
        name: 'local',
      },
    }))
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'Project SDK', status: 'pass'}),
        expect.objectContaining({name: 'Service ledger', status: 'pass'}),
      ]),
    }))
  })

  it('keeps legacy docker config mapped to canton-multi rather than splice-localnet', async () => {
    const projectDir = path.join(workDir, 'legacy-full')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

project:
  name: legacy-full
  sdk-version: "${getPinnedCantonSdkVersion()}"

networks:
  local:
    type: docker
    port: 10001
    json-api-port: 10757
`,
    )

    const result = await runInProject(ProfilesShow, projectDir, ['local', '--json'])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      profile: expect.objectContaining({
        kind: 'canton-multi',
        name: 'local',
      }),
    }))
    expect(json.data).not.toEqual(expect.objectContaining({
      profile: expect.objectContaining({kind: 'splice-localnet'}),
    }))
  })

  it('fails compat when the project SDK falls outside the pinned support baseline', async () => {
    const projectDir = path.join(workDir, 'unsupported-sdk')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: unsupported-sdk
  sdk-version: "0.0.1"

profiles:
  splice-devnet:
    experimental: false
    kind: remote-validator
    scan:
      url: https://scan.example.com
`,
    )

    const result = await runInProject(CompatCheck, projectDir, ['--json'])

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      failed: 1,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
      },
    }))
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'Project SDK', status: 'fail'}),
        expect.objectContaining({name: 'Service scan', status: 'pass'}),
      ]),
    }))
  })

  it('runs codegen sync as fetch then generate without changing the command contract', async () => {
    const runner: ProcessRunner = {
      run: vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: 'ok'}),
      spawn: vi.fn(),
      which: vi.fn(),
    }

    class TestCodegenSync extends CodegenSync {
      protected override createRunner(): ProcessRunner {
        return runner
      }

      protected override getCommandCwd(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestCodegenSync.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      steps: [
        expect.objectContaining({command: 'npm run codegen:fetch-specs', success: true}),
        expect.objectContaining({command: 'npm run codegen:generate-types', success: true}),
      ],
    }))
    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['run', 'codegen:fetch-specs'],
      expect.objectContaining({cwd: '/repo', ignoreExitCode: true}),
    )
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['run', 'codegen:generate-types'],
      expect.objectContaining({cwd: '/repo', ignoreExitCode: true}),
    )
  })
})
