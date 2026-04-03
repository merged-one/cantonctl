import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  findDarFile,
  getFileMtime,
  getNewestDamlSourceMtime,
  isTcpPortInUse,
  openBrowserUrl,
} from './runtime-support.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runtime-support', () => {
  it('finds the first dar file in a directory', async () => {
    const readdir = vi.fn().mockResolvedValue(['demo.txt', 'demo.dar'])

    await expect(findDarFile('/repo/.daml/dist', {readdir})).resolves.toBe('/repo/.daml/dist/demo.dar')
  })

  it('returns null when no dar file exists or the directory is unreadable', async () => {
    await expect(findDarFile('/repo/.daml/dist', {
      readdir: vi.fn().mockResolvedValue(['demo.txt']),
    })).resolves.toBeNull()

    await expect(findDarFile('/repo/.daml/dist', {
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
    })).resolves.toBeNull()
  })

  it('returns file mtimes and falls back to null when stat fails', async () => {
    await expect(getFileMtime('/repo/file.dar', {
      stat: vi.fn().mockResolvedValue({mtimeMs: 42}),
    })).resolves.toBe(42)

    await expect(getFileMtime('/repo/file.dar', {
      stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
    })).resolves.toBeNull()
  })

  it('walks nested daml trees and returns the newest source mtime', async () => {
    const readdir = vi.fn().mockImplementation(async (dir: string) => {
      if (dir === '/repo/daml') {
        return [
          {isDirectory: () => true, name: 'subdir'},
          {isDirectory: () => false, name: 'Main.daml'},
        ]
      }

      if (dir === '/repo/daml/subdir') {
        return [
          {isDirectory: () => false, name: 'Nested.daml'},
        ]
      }

      return []
    })
    const stat = vi.fn().mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('Main.daml')) {
        return {mtimeMs: 10}
      }

      return {mtimeMs: 50}
    })

    await expect(getNewestDamlSourceMtime('/repo/daml', {readdir, stat})).resolves.toBe(50)
  })

  it('returns zero when the source tree cannot be read', async () => {
    await expect(getNewestDamlSourceMtime('/repo/daml', {
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
    })).resolves.toBe(0)
  })

  it('detects occupied and free tcp ports', async () => {
    const occupiedServer = {
      close: vi.fn(),
      listen: vi.fn((_port: number, _host: string) => {
        setTimeout(() => errorHandler?.({code: 'EADDRINUSE', message: 'in use', name: 'Error'}), 0)
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'error') {
          errorHandler = handler
        }

        if (event === 'listening') {
          listeningHandler = handler
        }

        return occupiedServer
      }),
    }
    let errorHandler: ((err: NodeJS.ErrnoException) => void) | undefined
    let listeningHandler: (() => void) | undefined

    await expect(isTcpPortInUse(5001, {
      createServer: vi.fn(() => occupiedServer as never),
    })).resolves.toBe(true)

    const freeServer = {
      close: vi.fn((callback: () => void) => callback()),
      listen: vi.fn((_port: number, _host: string) => {
        setTimeout(() => listeningHandler?.(), 0)
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'error') {
          errorHandler = handler
        }

        if (event === 'listening') {
          listeningHandler = handler
        }

        return freeServer
      }),
    }

    await expect(isTcpPortInUse(5002, {
      createServer: vi.fn(() => freeServer as never),
    })).resolves.toBe(false)
  })

  it('handles non-address-in-use socket errors', async () => {
    let errorHandler: ((err: NodeJS.ErrnoException) => void) | undefined
    const failingServer = {
      close: vi.fn(),
      listen: vi.fn(() => {
        setTimeout(() => errorHandler?.({code: 'EACCES', message: 'denied', name: 'Error'}), 0)
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'error') {
          errorHandler = handler as (err: NodeJS.ErrnoException) => void
        }

        return failingServer
      }),
    }

    await expect(isTcpPortInUse(5003, {
      createServer: vi.fn(() => failingServer as never),
    })).resolves.toBe(false)
  })

  it('opens the browser with the platform-specific command', () => {
    const exec = vi.fn() as unknown as typeof import('node:child_process').exec

    openBrowserUrl('http://localhost:4000', {exec, platform: 'darwin'})
    openBrowserUrl('http://localhost:4000', {exec, platform: 'linux'})
    openBrowserUrl('http://localhost:4000', {exec, platform: 'win32'})

    expect(exec).toHaveBeenNthCalledWith(1, 'open http://localhost:4000')
    expect(exec).toHaveBeenNthCalledWith(2, 'xdg-open http://localhost:4000')
    expect(exec).toHaveBeenNthCalledWith(3, 'start http://localhost:4000')
  })

  it('covers the default dependency paths with real filesystem and socket state', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-support-'))

    try {
      await fs.mkdir(path.join(tempDir, 'daml', 'nested'), {recursive: true})
      await fs.mkdir(path.join(tempDir, '.daml', 'dist'), {recursive: true})
      const darPath = path.join(tempDir, '.daml', 'dist', 'demo.dar')
      const olderDaml = path.join(tempDir, 'daml', 'Older.daml')
      const newerDaml = path.join(tempDir, 'daml', 'nested', 'Newer.daml')
      await fs.writeFile(darPath, 'dar', 'utf8')
      await fs.writeFile(olderDaml, 'module Older where\n', 'utf8')
      await fs.writeFile(newerDaml, 'module Newer where\n', 'utf8')
      await fs.utimes(olderDaml, new Date(10_000), new Date(10_000))
      await fs.utimes(newerDaml, new Date(20_000), new Date(20_000))

      await expect(findDarFile(path.join(tempDir, '.daml', 'dist'))).resolves.toBe(darPath)
      await expect(getFileMtime(olderDaml)).resolves.toBeGreaterThan(0)
      await expect(getNewestDamlSourceMtime(path.join(tempDir, 'daml'))).resolves.toBe(20_000)

      const server = net.createServer()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected numeric test port')
      }

      await expect(isTcpPortInUse(address.port)).resolves.toBe(true)
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await expect(isTcpPortInUse(address.port)).resolves.toBe(false)

    } finally {
      await fs.rm(tempDir, {force: true, recursive: true})
    }
  })

  it('keeps the newest daml mtime when later entries are older', async () => {
    const readdir = vi.fn().mockImplementation(async (dir: string) => {
      if (dir === '/repo/daml') {
        return [
          {isDirectory: () => false, name: 'Newest.daml'},
          {isDirectory: () => true, name: 'subdir'},
          {isDirectory: () => false, name: 'Older.daml'},
        ]
      }

      return [{isDirectory: () => false, name: 'Nested.daml'}]
    })
    const stat = vi.fn().mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('Newest.daml')) return {mtimeMs: 50}
      if (filePath.endsWith('Older.daml')) return {mtimeMs: 10}
      return {mtimeMs: 25}
    })

    await expect(getNewestDamlSourceMtime('/repo/daml', {readdir, stat})).resolves.toBe(50)
  })
})
