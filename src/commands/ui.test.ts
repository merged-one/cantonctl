import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import Ui from './ui.js'

const CLI_ROOT = process.cwd()

describe('ui command', () => {
  it('starts the control center and opens the browser by default', async () => {
    const openBrowser = vi.fn()
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestUi extends Ui {
      protected override createUiServer() {
        return {
          start: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 4780,
            url: 'http://127.0.0.1:4780',
          }),
          stop,
        }
      }

      protected override async openBrowser(url: string): Promise<void> {
        openBrowser(url)
      }

      protected override async waitForShutdown(server: ReturnType<TestUi['createUiServer']>): Promise<void> {
        await server.stop()
      }
    }

    const result = await captureOutput(() => TestUi.run(['--profile', 'splice-devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('http://127.0.0.1:4780/?profile=splice-devnet')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4780/?profile=splice-devnet')
    expect(stop).toHaveBeenCalled()
  })

  it('respects --no-open and preserves port wiring', async () => {
    const openBrowser = vi.fn()

    class TestUi extends Ui {
      protected override createUiServer(requestedProfile?: string) {
        expect(requestedProfile).toBe('sandbox')
        return {
          start: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 4999,
            url: 'http://127.0.0.1:4999',
          }),
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async openBrowser(url: string): Promise<void> {
        openBrowser(url)
      }

      protected override async waitForShutdown(): Promise<void> {
        return
      }
    }

    const result = await captureOutput(() => TestUi.run(['--profile', 'sandbox', '--port', '4999', '--no-open'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('http://127.0.0.1:4999/?profile=sandbox')
    expect(openBrowser).not.toHaveBeenCalled()
  })
})
