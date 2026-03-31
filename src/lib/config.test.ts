import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {type CantonctlConfig, type ConfigFileSystem, loadConfig, mergeConfigs, resolveConfig} from './config.js'
import {CantonctlError, ErrorCode} from './errors.js'

/**
 * Creates a mock filesystem for config loading tests.
 * Avoids touching the real filesystem — all reads are stubbed.
 */
function createMockFs(files: Record<string, string> = {}): ConfigFileSystem {
  return {
    existsSync(p: string) {
      return p in files
    },
    readFileSync(p: string, _encoding: string) {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`)
      return files[p]
    },
  }
}

describe('loadConfig', () => {
  it('loads and validates a minimal cantonctl.yaml', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await loadConfig({dir: '/project', fs})
    expect(config.version).toBe(1)
    expect(config.project.name).toBe('my-app')
    expect(config.project['sdk-version']).toBe('3.4.9')
  })

  it('loads config with all optional fields', async () => {
    const yaml = `
version: 1
project:
  name: token-app
  sdk-version: "3.4.9"
  template: token
parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant
networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575
  devnet:
    type: remote
    url: https://devnet.canton.network
    auth: jwt
plugins:
  - "@cantonctl/plugin-zenith"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await loadConfig({dir: '/project', fs})
    expect(config.parties).toHaveLength(2)
    expect(config.parties![0]).toEqual({name: 'Alice', role: 'operator'})
    expect(config.networks!.local.type).toBe('sandbox')
    expect(config.networks!.devnet.url).toBe('https://devnet.canton.network')
    expect(config.plugins).toEqual(['@cantonctl/plugin-zenith'])
  })

  it('searches parent directories for cantonctl.yaml', async () => {
    const yaml = `
version: 1
project:
  name: root-project
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await loadConfig({dir: '/project/src/lib', fs})
    expect(config.project.name).toBe('root-project')
  })

  it('throws CONFIG_NOT_FOUND when no config exists', async () => {
    const fs = createMockFs({})
    await expect(loadConfig({dir: '/empty', fs})).rejects.toThrow(CantonctlError)
    try {
      await loadConfig({dir: '/empty', fs})
    } catch (err) {
      expect(err).toBeInstanceOf(CantonctlError)
      expect((err as CantonctlError).code).toBe(ErrorCode.CONFIG_NOT_FOUND)
      expect((err as CantonctlError).suggestion).toContain('cantonctl init')
    }
  })

  it('throws CONFIG_INVALID_YAML for malformed YAML', async () => {
    const fs = createMockFs({'/project/cantonctl.yaml': '{{{'})
    await expect(loadConfig({dir: '/project', fs})).rejects.toThrow(CantonctlError)
    try {
      await loadConfig({dir: '/project', fs})
    } catch (err) {
      expect((err as CantonctlError).code).toBe(ErrorCode.CONFIG_INVALID_YAML)
    }
  })

  it('throws CONFIG_SCHEMA_VIOLATION with readable messages for invalid config', async () => {
    const yaml = `
version: 1
project:
  name: 42
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    await expect(loadConfig({dir: '/project', fs})).rejects.toThrow(CantonctlError)
    try {
      await loadConfig({dir: '/project', fs})
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      // Should include human-readable field path info
      expect(e.message).toContain('cantonctl.yaml')
      expect(e.context).toBeDefined()
    }
  })

  it('throws CONFIG_SCHEMA_VIOLATION for missing required fields', async () => {
    const yaml = `
version: 1
project:
  name: my-app
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    try {
      await loadConfig({dir: '/project', fs})
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.suggestion).toBeTruthy()
    }
  })

  it('throws CONFIG_SCHEMA_VIOLATION for invalid network type', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
networks:
  bad:
    type: invalid-type
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    try {
      await loadConfig({dir: '/project', fs})
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
    }
  })
})

describe('mergeConfigs', () => {
  const base: CantonctlConfig = {
    project: {name: 'app', 'sdk-version': '3.4.9'},
    version: 1,
  }

  it('returns base when override is empty', () => {
    const merged = mergeConfigs(base, {})
    expect(merged).toEqual(base)
  })

  it('overrides scalar project fields', () => {
    const merged = mergeConfigs(base, {project: {name: 'new-name', 'sdk-version': '3.5.0'}})
    expect(merged.project.name).toBe('new-name')
    expect(merged.project['sdk-version']).toBe('3.5.0')
  })

  it('merges networks (override wins on conflict)', () => {
    const withNetworks: CantonctlConfig = {
      ...base,
      networks: {
        local: {type: 'sandbox', port: 5001, 'json-api-port': 7575},
      },
    }
    const merged = mergeConfigs(withNetworks, {
      networks: {
        local: {type: 'sandbox', port: 6001},
        devnet: {type: 'remote', url: 'https://devnet.example.com'},
      },
    })
    expect(merged.networks!.local.port).toBe(6001)
    // Original json-api-port preserved through merge
    expect(merged.networks!.local['json-api-port']).toBe(7575)
    expect(merged.networks!.devnet.type).toBe('remote')
  })

  it('merges parties (concatenates, no dedup)', () => {
    const withParties: CantonctlConfig = {
      ...base,
      parties: [{name: 'Alice', role: 'operator'}],
    }
    const merged = mergeConfigs(withParties, {
      parties: [{name: 'Bob', role: 'participant'}],
    })
    expect(merged.parties).toHaveLength(2)
    expect(merged.parties![1].name).toBe('Bob')
  })

  it('merges plugins (concatenates, deduplicates)', () => {
    const withPlugins: CantonctlConfig = {
      ...base,
      plugins: ['@cantonctl/plugin-a'],
    }
    const merged = mergeConfigs(withPlugins, {
      plugins: ['@cantonctl/plugin-a', '@cantonctl/plugin-b'],
    })
    expect(merged.plugins).toEqual(['@cantonctl/plugin-a', '@cantonctl/plugin-b'])
  })
})

describe('resolveConfig', () => {
  it('applies env var overrides (CANTONCTL_ prefix)', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await resolveConfig({
      dir: '/project',
      env: {CANTONCTL_PROJECT_NAME: 'env-app'},
      fs,
    })
    expect(config.project.name).toBe('env-app')
  })

  it('applies CLI flag overrides (highest priority)', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await resolveConfig({
      dir: '/project',
      flags: {'project.name': 'flag-app'},
      fs,
    })
    expect(config.project.name).toBe('flag-app')
  })

  it('merges user config from home directory', async () => {
    const projectYaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const userYaml = `
networks:
  devnet:
    type: remote
    url: https://my-devnet.example.com
    auth: jwt
`
    const fs = createMockFs({
      '/home/.config/cantonctl/config.yaml': userYaml,
      '/project/cantonctl.yaml': projectYaml,
    })
    const config = await resolveConfig({
      dir: '/project',
      fs,
      homeDir: '/home',
    })
    expect(config.networks!.devnet.url).toBe('https://my-devnet.example.com')
  })

  it('priority order: flags > env > project > user', async () => {
    const projectYaml = `
version: 1
project:
  name: project-name
  sdk-version: "3.4.9"
`
    const userYaml = `
project:
  name: user-name
`
    const fs = createMockFs({
      '/home/.config/cantonctl/config.yaml': userYaml,
      '/project/cantonctl.yaml': projectYaml,
    })
    // Without overrides, project beats user
    const config1 = await resolveConfig({dir: '/project', fs, homeDir: '/home'})
    expect(config1.project.name).toBe('project-name')

    // Env beats project
    const config2 = await resolveConfig({
      dir: '/project',
      env: {CANTONCTL_PROJECT_NAME: 'env-name'},
      fs,
      homeDir: '/home',
    })
    expect(config2.project.name).toBe('env-name')

    // Flags beat everything
    const config3 = await resolveConfig({
      dir: '/project',
      env: {CANTONCTL_PROJECT_NAME: 'env-name'},
      flags: {'project.name': 'flag-name'},
      fs,
      homeDir: '/home',
    })
    expect(config3.project.name).toBe('flag-name')
  })

  it('ignores missing user config gracefully', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await resolveConfig({dir: '/project', fs, homeDir: '/home'})
    expect(config.project.name).toBe('my-app')
  })

  it('ignores malformed user config gracefully', async () => {
    const projectYaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({
      '/home/.config/cantonctl/config.yaml': '{{{invalid yaml',
      '/project/cantonctl.yaml': projectYaml,
    })
    const config = await resolveConfig({dir: '/project', fs, homeDir: '/home'})
    expect(config.project.name).toBe('my-app')
  })

  it('creates nested objects for dot overrides targeting non-existent paths', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await resolveConfig({
      dir: '/project',
      env: {CANTONCTL_PROJECT_SDK_VERSION: '3.5.0'},
      fs,
    })
    expect(config.project['sdk-version']).toBe('3.5.0')
  })

  it('creates intermediate objects for deeply nested flag overrides', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    // 'custom.deep.value' forces creation of 'custom' and 'custom.deep' objects
    const config = await resolveConfig({
      dir: '/project',
      flags: {'custom.deep.value': 'test'},
      fs,
    }) as Record<string, unknown>
    expect((config.custom as Record<string, Record<string, string>>).deep.value).toBe('test')
  })

  it('creates nested objects for deep dot-notation overrides', async () => {
    const yaml = `
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
`
    const fs = createMockFs({'/project/cantonctl.yaml': yaml})
    const config = await resolveConfig({
      dir: '/project',
      flags: {'project.template': 'token'},
      fs,
    })
    expect(config.project.template).toBe('token')
  })
})
