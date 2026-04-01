import {describe, expect, it, vi} from 'vitest'

import {createCleaner, type CleanerDeps} from './cleaner.js'
import type {OutputWriter} from './output.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockFs(existingDirs: string[] = ['.daml', 'dist']): CleanerDeps['fs'] {
  return {
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockImplementation(async (path: string) => {
      const name = path.split('/').pop()!
      if (existingDirs.includes(name)) {
        return {isDirectory: () => true}
      }

      throw new Error('ENOENT')
    }),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cleaner', () => {
  describe('clean()', () => {
    it('removes .daml, dist, and .cantonctl by default', async () => {
      const fs = createMockFs(['.daml', 'dist', '.cantonctl'])
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      const result = await cleaner.clean({force: true, projectDir: '/project'})

      expect(result.removed).toEqual(['.daml', 'dist', '.cantonctl'])
      expect(fs.rm).toHaveBeenCalledTimes(3)
      expect(fs.rm).toHaveBeenCalledWith('/project/.daml', {force: true, recursive: true})
      expect(fs.rm).toHaveBeenCalledWith('/project/dist', {force: true, recursive: true})
      expect(fs.rm).toHaveBeenCalledWith('/project/.cantonctl', {force: true, recursive: true})
    })

    it('also removes node_modules with --all', async () => {
      const fs = createMockFs(['.daml', 'dist', '.cantonctl', 'node_modules'])
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      const result = await cleaner.clean({all: true, force: true, projectDir: '/project'})

      expect(result.removed).toEqual(['.daml', 'dist', '.cantonctl', 'node_modules'])
      expect(fs.rm).toHaveBeenCalledTimes(4)
    })

    it('skips directories that do not exist', async () => {
      const fs = createMockFs(['.daml']) // only .daml exists
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      const result = await cleaner.clean({force: true, projectDir: '/project'})

      expect(result.removed).toEqual(['.daml'])
      expect(result.skipped).toEqual(['dist', '.cantonctl'])
      expect(fs.rm).toHaveBeenCalledTimes(1)
    })

    it('reports nothing to clean when no targets exist', async () => {
      const fs = createMockFs([])
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      const result = await cleaner.clean({force: true, projectDir: '/project'})

      expect(result.removed).toEqual([])
      expect(output.info).toHaveBeenCalledWith('Nothing to clean')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('confirms before deleting when not forced', async () => {
      const fs = createMockFs(['.daml', 'dist'])
      const output = createMockOutput()
      const confirm = vi.fn().mockResolvedValue(true)
      const cleaner = createCleaner({confirm, fs, output})

      const result = await cleaner.clean({projectDir: '/project'})

      expect(confirm).toHaveBeenCalledWith('Remove .daml, dist?')
      expect(result.removed).toEqual(['.daml', 'dist'])
    })

    it('cancels when confirmation is declined', async () => {
      const fs = createMockFs(['.daml', 'dist'])
      const output = createMockOutput()
      const confirm = vi.fn().mockResolvedValue(false)
      const cleaner = createCleaner({confirm, fs, output})

      const result = await cleaner.clean({projectDir: '/project'})

      expect(result.removed).toEqual([])
      expect(output.info).toHaveBeenCalledWith('Clean cancelled')
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('skips confirmation with --force', async () => {
      const fs = createMockFs(['.daml'])
      const output = createMockOutput()
      const confirm = vi.fn()
      const cleaner = createCleaner({confirm, fs, output})

      await cleaner.clean({force: true, projectDir: '/project'})

      expect(confirm).not.toHaveBeenCalled()
    })

    it('includes timing in result', async () => {
      const fs = createMockFs([])
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      const result = await cleaner.clean({force: true, projectDir: '/project'})
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('outputs success message per removed directory', async () => {
      const fs = createMockFs(['.daml', 'dist'])
      const output = createMockOutput()
      const cleaner = createCleaner({fs, output})

      await cleaner.clean({force: true, projectDir: '/project'})

      expect(output.success).toHaveBeenCalledWith('Removed .daml/')
      expect(output.success).toHaveBeenCalledWith('Removed dist/')
    })
  })
})
