import type {PathLike} from 'node:fs'

import {describe, expect, it, vi} from 'vitest'

import {createProcessRunner} from './process-runner.js'

function createSpawnProcess(result: {exitCode?: number}, overrides: Record<string, unknown> = {}) {
  return Object.assign(Promise.resolve(result), {
    kill: vi.fn(),
    pid: 4242,
    stderr: {label: 'stderr'},
    stdout: {label: 'stdout'},
    ...overrides,
  })
}

describe('createProcessRunner', () => {
  it('prepends daml and java paths when executing commands', async () => {
    const execa = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: new Uint8Array(Buffer.from('warn')),
      stdout: ['build', '-', 'ok'],
    })

    const runner = createProcessRunner({
      env: {
        JAVA_HOME: '/jdk-21',
        PATH: '/usr/local/bin:/usr/bin',
      },
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    const result = await runner.run('dpm', ['build'], {
      cwd: '/repo',
      env: {DEBUG: '1'},
      ignoreExitCode: true,
      timeout: 5000,
    })

    expect(result).toEqual({
      exitCode: 0,
      stderr: 'warn',
      stdout: 'build-ok',
    })
    expect(execa).toHaveBeenCalledWith(
      'dpm',
      ['build'],
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({
          DEBUG: '1',
          PATH: `/home/tester/.daml/bin:/jdk-21/bin:/usr/local/bin:/usr/bin`,
        }),
        reject: false,
        timeout: 5000,
      }),
    )
  })

  it('builds a PATH from tool extras when the base environment omits PATH', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: ''})

    const runner = createProcessRunner({
      env: {},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await runner.which('daml')

    expect(execa).toHaveBeenCalledWith(
      'which',
      ['daml'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/home/tester/.daml/bin',
        }),
      }),
    )
  })

  it('falls back to macOS java_home discovery when JAVA_HOME is unset', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: '/usr/bin/java'})
    const execSync = vi.fn().mockReturnValue(Buffer.from('/Library/Java/JavaVirtualMachines/jdk-21/Contents/Home\n'))
    const existsSync = vi.fn((filePath: PathLike) =>
      String(filePath) === '/Library/Java/JavaVirtualMachines/jdk-21/Contents/Home/bin/java',
    )

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      execSync,
      existsSync,
      homedir: () => '/home/tester',
      platform: () => 'darwin',
    })

    await runner.which('java')

    expect(execSync).toHaveBeenCalledWith(
      '/usr/libexec/java_home -v 21',
      expect.objectContaining({timeout: 5000}),
    )
    expect(execa).toHaveBeenCalledWith(
      'which',
      ['java'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: `/home/tester/.daml/bin:/Library/Java/JavaVirtualMachines/jdk-21/Contents/Home/bin:/usr/bin`,
        }),
      }),
    )
  })

  it('falls back to Homebrew Java paths when java_home is unavailable', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 1, stderr: '', stdout: ''})
    const execSync = vi.fn(() => {
      throw new Error('java_home not configured')
    })
    const existsSync = vi.fn((filePath: PathLike) => String(filePath) === '/opt/homebrew/opt/openjdk@21/bin/java')

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      execSync,
      existsSync,
      homedir: () => '/home/tester',
      platform: () => 'darwin',
    })

    const result = await runner.which('java')

    expect(result).toBeNull()
    expect(execa).toHaveBeenCalledWith(
      'which',
      ['java'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: `/home/tester/.daml/bin:/opt/homebrew/opt/openjdk@21/bin:/usr/bin`,
        }),
      }),
    )
  })

  it('returns execa error output when a command exits non-zero', async () => {
    const execa = vi.fn().mockRejectedValue({
      exitCode: 17,
      stderr: 'bad stderr',
      stdout: 'bad stdout',
    })

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['test'])).resolves.toEqual({
      exitCode: 17,
      stderr: 'bad stderr',
      stdout: 'bad stdout',
    })
  })

  it('normalizes string and empty outputs from execa', async () => {
    const execa = vi
      .fn()
      .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'plain text'})
      .mockResolvedValueOnce({exitCode: 0, stderr: undefined, stdout: undefined})
      .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: ['a', 1]})

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'plain text',
    })
    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: '',
    })
    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'a1',
    })
  })

  it('rethrows non-execa failures', async () => {
    const error = new Error('boom')
    const execa = vi.fn().mockRejectedValue(error)

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['test'])).rejects.toThrow('boom')
  })

  it('spawns long-running processes and relays exit callbacks', async () => {
    const execa = vi.fn().mockReturnValue(createSpawnProcess({exitCode: 0}))
    const processKill = vi.fn()

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
      processKill,
    })

    const proc = runner.spawn('dpm', ['sandbox'], {cwd: '/repo'})
    const onExit = vi.fn()
    proc.onExit(onExit)
    proc.kill('SIGINT')

    await expect(proc.waitForExit()).resolves.toBe(0)
    expect(onExit).toHaveBeenCalledWith(0)
    expect(processKill).toHaveBeenCalledWith(-4242, 'SIGINT')
    expect((execa.mock.results[0]?.value as {kill: ReturnType<typeof vi.fn>}).kill).toHaveBeenCalledWith('SIGINT')
    expect(proc.pid).toBe(4242)
    expect(proc.stdout).toEqual({label: 'stdout'})
    expect(proc.stderr).toEqual({label: 'stderr'})
    expect(execa).toHaveBeenCalledWith(
      'dpm',
      ['sandbox'],
      expect.objectContaining({
        cleanup: true,
        cwd: '/repo',
        detached: true,
        forceKillAfterDelay: 5000,
        reject: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )
  })

  it('uses the default SIGTERM signal when spawn.kill is called without arguments', async () => {
    const execa = vi.fn().mockReturnValue(createSpawnProcess({}))
    const processKill = vi.fn()

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
      processKill,
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    proc.kill()

    await expect(proc.waitForExit()).resolves.toBeNull()
    expect(processKill).toHaveBeenCalledWith(-4242, 'SIGTERM')
    expect((execa.mock.results[0]?.value as {kill: ReturnType<typeof vi.fn>}).kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('falls back to direct child kill when process-group signaling fails', async () => {
    const spawned = createSpawnProcess({})
    const execa = vi.fn().mockReturnValue(spawned)
    const processKill = vi.fn(() => {
      throw new Error('no such process group')
    })

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
      processKill,
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    proc.kill('SIGINT')

    expect(processKill).toHaveBeenCalledWith(-4242, 'SIGINT')
    expect(spawned.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('uses direct child kill on platforms without process groups', async () => {
    const spawned = createSpawnProcess({})
    const execa = vi.fn().mockReturnValue(spawned)
    const processKill = vi.fn()

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'win32',
      processKill,
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    proc.kill('SIGINT')

    expect(processKill).not.toHaveBeenCalled()
    expect(spawned.kill).toHaveBeenCalledWith('SIGINT')
    expect(execa).toHaveBeenCalledWith(
      'dpm',
      ['sandbox'],
      expect.objectContaining({
        detached: false,
      }),
    )
  })

  it('normalizes spawn failures to exit code 1', async () => {
    const failingProc = Object.assign(Promise.reject(new Error('spawn failed')), {
      kill: vi.fn(),
      pid: 1001,
      stderr: null,
      stdout: null,
    })
    const execa = vi.fn().mockReturnValue(failingProc)

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    const onExit = vi.fn()
    proc.onExit(onExit)

    await expect(proc.waitForExit()).resolves.toBe(1)
    expect(onExit).toHaveBeenCalledWith(1)
  })

  it('returns null when which lookup throws', async () => {
    const execa = vi.fn().mockRejectedValue(new Error('missing which'))

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.which('java')).resolves.toBeNull()
  })

  it('uses default dependencies when no overrides are supplied', async () => {
    const runner = createProcessRunner()

    await expect(runner.which('node')).resolves.toContain('node')
    await expect(runner.run(process.execPath, ['-e', 'process.stdout.write("ok")'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'ok',
    })
  })

  it('skips macOS java_home results when the reported java binary is missing', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: '/usr/bin/java'})
    const execSync = vi.fn().mockReturnValue(Buffer.from('/Library/Java/JavaVirtualMachines/jdk-21/Contents/Home\n'))
    const existsSync = vi.fn().mockReturnValue(false)

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      execSync,
      existsSync,
      homedir: () => '/home/tester',
      platform: () => 'darwin',
    })

    await runner.which('java')

    expect(execa).toHaveBeenCalledWith(
      'which',
      ['java'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/home/tester/.daml/bin:/usr/bin',
        }),
      }),
    )
  })

  it('deduplicates PATH entries and treats blank which output as not found', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: '   '})

    const runner = createProcessRunner({
      env: {
        JAVA_HOME: '/jdk-21',
        PATH: '/home/tester/.daml/bin:/jdk-21/bin:/usr/bin',
      },
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.which('java')).resolves.toBeNull()
    expect(execa).toHaveBeenCalledWith(
      'which',
      ['java'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: '/home/tester/.daml/bin:/jdk-21/bin:/usr/bin',
        }),
      }),
    )
  })

  it('filters out undefined env entries before rebuilding PATH', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: '/usr/bin/java'})

    const runner = createProcessRunner({
      env: {
        HOME: undefined,
        PATH: '/usr/bin',
      },
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await runner.which('java')

    expect(execa).toHaveBeenCalledWith(
      'which',
      ['java'],
      expect.objectContaining({
        env: expect.not.objectContaining({HOME: undefined}),
      }),
    )
  })

  it('normalizes undefined exit codes from successful executions', async () => {
    const execa = vi.fn().mockResolvedValue({exitCode: undefined, stderr: '', stdout: ''})

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: '',
    })
  })

  it('normalizes missing stderr/stdout on execa exit-code failures', async () => {
    const execa = vi.fn().mockRejectedValue({exitCode: 0})

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 0,
      stderr: '',
      stdout: '',
    })
  })

  it('normalizes null exit codes on execa failures to one', async () => {
    const execa = vi.fn().mockRejectedValue({exitCode: null})

    const runner = createProcessRunner({
      env: {PATH: '/usr/bin'},
      execa,
      homedir: () => '/home/tester',
      platform: () => 'linux',
    })

    await expect(runner.run('daml', ['version'])).resolves.toEqual({
      exitCode: 1,
      stderr: '',
      stdout: '',
    })
  })
})
