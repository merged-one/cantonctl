import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import ExportSdkConfig from '../../src/commands/export/sdk-config.js'
import {createSdkConfigExporter} from '../../src/lib/export/sdk-config.js'
import {createInMemoryBackend} from '../../src/lib/credential-store.js'
import {createProfileRuntimeResolver} from '../../src/lib/profile-runtime.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

async function runInProject(
  projectDir: string,
  command: typeof ExportSdkConfig,
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

function createHarness(env: Record<string, string | undefined>): typeof ExportSdkConfig {
  return class TestExportSdkConfig extends ExportSdkConfig {
    protected override createExporter() {
      return createSdkConfigExporter({
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
      })
    }
  }
}

describe('sdk config export E2E', () => {
  let projectDir: string
  let workDir: string

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-export-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), `version: 1

project:
  name: export-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: https://auth.example.com
    ledger:
      url: https://ledger.example.com
    scan:
      url: https://scan.example.com
    tokenStandard:
      url: https://tokens.example.com
    validator:
      url: https://validator.example.com
`, 'utf8')
  })

  afterAll(() => {
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('exports dapp-sdk, wallet-sdk, and dapp-api configs with auth placeholders', async () => {
    const Harness = createHarness({CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token'})

    const dappSdk = parseJson((await runInProject(projectDir, Harness, [
      '--profile',
      'splice-devnet',
      '--target',
      'dapp-sdk',
      '--format',
      'json',
      '--json',
    ])).stdout)
    const walletSdk = await runInProject(projectDir, Harness, [
      '--profile',
      'splice-devnet',
      '--target',
      'wallet-sdk',
      '--format',
      'env',
    ])
    const dappApi = parseJson((await runInProject(projectDir, Harness, [
      '--profile',
      'splice-devnet',
      '--target',
      'dapp-api',
      '--format',
      'json',
      '--json',
    ])).stdout)

    expect(dappSdk.data).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        cip: 'CIP-0103',
        target: 'dapp-sdk',
      }),
    }))
    expect(walletSdk.stdout).toContain('CANTONCTL_CIP_STANDARD=CIP-0103')
    expect(walletSdk.stdout).toContain('SPLICE_AUTH_TOKEN_PLACEHOLDER=${CANTONCTL_JWT_SPLICE_DEVNET}')
    expect(dappApi.data).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        target: 'dapp-api',
      }),
    }))
  })
})

