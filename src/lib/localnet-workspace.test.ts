import {describe, expect, it} from 'vitest'

import {createLocalnetWorkspaceDetector} from './localnet-workspace.js'
import {ErrorCode} from './errors.js'

function createAccess(files: Record<string, string>) {
  return async (filePath: string) => {
    if (!(filePath in files)) {
      throw new Error(`ENOENT: ${filePath}`)
    }
  }
}

function createReadFile(files: Record<string, string>) {
  return async (filePath: string) => {
    const value = files[filePath]
    if (value === undefined) {
      throw new Error(`ENOENT: ${filePath}`)
    }

    return value
  }
}

describe('createLocalnetWorkspaceDetector', () => {
  it('detects an official workspace and expands env values across layered files', async () => {
    const files = {
      '/workspace/.env': [
        'HOST_BIND_IP=0.0.0.0',
        'CUSTOM_PROVIDER_PORT=3300',
        'APP_PROVIDER_UI_PORT=${CUSTOM_PROVIDER_PORT:-3000}',
        'COMMENTED_VALUE=value # remove this',
        'EMPTY_COMMENT=# remove everything',
        'EXPANDED_EMPTY=${MISSING_ALIAS}',
        'FRAGMENT_VALUE=http://example.com/#anchor',
        'DOUBLE_QUOTED="hash # stays"',
        'INVALID LINE WITHOUT EQUALS',
        'SHORT_EMPTY=$MISSING_SHORT',
        'SINGLE_QUOTED=\'quoted value\'',
        '',
      ].join('\n'),
      '/workspace/Makefile': [
        'start:',
        '\t@echo start',
        'status:',
        '\t@echo status',
        'stop:',
        '\t@echo stop',
      ].join('\n'),
      '/workspace/compose.yaml': 'services: {}',
      '/workspace/config': '',
      '/workspace/config/app.conf': '',
      '/workspace/docker/modules/localnet': '',
      '/workspace/docker/modules/localnet/compose.env': [
        'APP_USER_UI_PORT=2100',
        'CHAINED_VALUE=$COMMENTED_VALUE',
      ].join('\n'),
      '/workspace/docker/modules/localnet/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/env/common.env': [
        'SV_UI_PORT=4100',
        'VALIDATOR_ADMIN_API_PORT_SUFFIX=904',
        'DEFAULTED_VALUE=${MISSING_ENV:-fallback}',
      ].join('\n'),
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    const workspace = await detector.detect('/workspace')

    expect(workspace.makeTargets).toEqual({down: 'stop', status: 'status', up: 'start'})
    expect(workspace.env).toEqual(expect.objectContaining({
      APP_PROVIDER_UI_PORT: '3300',
      APP_USER_UI_PORT: '2100',
      CHAINED_VALUE: 'value',
      COMMENTED_VALUE: 'value',
      DEFAULTED_VALUE: 'fallback',
      DOUBLE_QUOTED: 'hash # stays',
      EMPTY_COMMENT: '',
      EXPANDED_EMPTY: '',
      FRAGMENT_VALUE: 'http://example.com/#anchor',
      HOST_BIND_IP: '0.0.0.0',
      SHORT_EMPTY: '',
      SINGLE_QUOTED: 'quoted value',
      SV_UI_PORT: '4100',
      VALIDATOR_ADMIN_API_PORT_SUFFIX: '904',
    }))
    expect(workspace.profiles['app-provider']).toEqual(expect.objectContaining({
      health: {validatorReadyz: 'http://0.0.0.0:3904/api/validator/readyz'},
      urls: expect.objectContaining({
        ledger: 'http://canton.localhost:3300/v2',
        validator: 'http://wallet.localhost:3300/api/validator',
      }),
    }))
    expect(workspace.profiles['app-user'].urls.wallet).toBe('http://wallet.localhost:2100')
    expect(workspace.profiles.sv.urls.scan).toBe('http://scan.localhost:4100/api/scan')
    expect(workspace.services.scan).toBe('http://scan.localhost:4100/api/scan')
  })

  it('supports alternate workspace layouts and fallback make targets', async () => {
    const files = {
      '/workspace/.env': '',
      '/workspace/Makefile': [
        'up:',
        '\t@echo up',
        'ps:',
        '\t@echo ps',
        'down:',
        '\t@echo down',
      ].join('\n'),
      '/workspace/cluster/compose/localnet': '',
      '/workspace/cluster/compose/localnet/compose.env': '',
      '/workspace/cluster/compose/localnet/compose.yaml': 'services: {}',
      '/workspace/cluster/compose/localnet/conf': '',
      '/workspace/cluster/compose/localnet/conf/app.conf': '',
      '/workspace/cluster/compose/localnet/env/common.env': '',
      '/workspace/compose.yml': 'services: {}',
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    const workspace = await detector.detect('/workspace')

    expect(workspace.localnetDir).toBe('/workspace/cluster/compose/localnet')
    expect(workspace.configDir).toBe('/workspace/cluster/compose/localnet/conf')
    expect(workspace.makeTargets).toEqual({down: 'down', status: 'ps', up: 'up'})
  })

  it('reports missing required child paths relative to the workspace root', async () => {
    const files = {
      '/workspace/.env': '',
      '/workspace/Makefile': [
        'start:',
        '\t@echo start',
        'status:',
        '\t@echo status',
        'stop:',
        '\t@echo stop',
      ].join('\n'),
      '/workspace/compose.yaml': 'services: {}',
      '/workspace/config': '',
      '/workspace/docker/modules/localnet': '',
      '/workspace/docker/modules/localnet/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/env/common.env': '',
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    await expect(detector.detect('/workspace')).rejects.toMatchObject({
      code: ErrorCode.LOCALNET_WORKSPACE_INVALID,
      context: expect.objectContaining({
        missing: expect.arrayContaining(['docker/modules/localnet/compose.env']),
      }),
    })
  })

  it('expands ${NAME} values from the current environment context', async () => {
    const files = {
      '/workspace/.env': [
        'HOST_BIND_IP=10.0.0.5',
        'HOST_BIND_ALIAS=${HOST_BIND_IP}',
      ].join('\n'),
      '/workspace/Makefile': [
        'start:',
        '\t@echo start',
        'status:',
        '\t@echo status',
        'stop:',
        '\t@echo stop',
      ].join('\n'),
      '/workspace/compose.yaml': 'services: {}',
      '/workspace/config': '',
      '/workspace/docker/modules/localnet': '',
      '/workspace/docker/modules/localnet/compose.env': '',
      '/workspace/docker/modules/localnet/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/env/common.env': '',
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    const workspace = await detector.detect('/workspace')

    expect(workspace.env).toEqual(expect.objectContaining({
      HOST_BIND_ALIAS: '10.0.0.5',
      HOST_BIND_IP: '10.0.0.5',
    }))
  })

  it('fails when required make targets are absent even in an otherwise valid workspace', async () => {
    const files = {
      '/workspace/.env': '',
      '/workspace/Makefile': [
        'start:',
        '\t@echo start',
      ].join('\n'),
      '/workspace/compose.yaml': 'services: {}',
      '/workspace/config': '',
      '/workspace/docker/modules/localnet': '',
      '/workspace/docker/modules/localnet/compose.env': '',
      '/workspace/docker/modules/localnet/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/env/common.env': '',
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    await expect(detector.detect('/workspace')).rejects.toMatchObject({
      code: ErrorCode.LOCALNET_WORKSPACE_INVALID,
      suggestion: expect.stringContaining('stop, down'),
    })
  })

  it('fails with a structured error when required files or targets are missing', async () => {
    const files = {
      '/workspace/.env': '',
      '/workspace/Makefile': [
        'start:',
        '\t@echo start',
      ].join('\n'),
      '/workspace/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/compose.env': '',
      '/workspace/docker/modules/localnet/compose.yaml': 'services: {}',
      '/workspace/docker/modules/localnet/env/common.env': '',
    }

    const detector = createLocalnetWorkspaceDetector({
      access: createAccess(files),
      readFile: createReadFile(files),
    })

    await expect(detector.detect('/workspace')).rejects.toMatchObject({
      code: ErrorCode.LOCALNET_WORKSPACE_INVALID,
    })
  })
})
