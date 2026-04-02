import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import * as adapters from './index.js'

describe('stable adapter index', () => {
  it('exports the stable adapter factories', () => {
    expect(typeof adapters.createLedgerAdapter).toBe('function')
    expect(typeof adapters.createScanAdapter).toBe('function')
    expect(typeof adapters.createScanProxyAdapter).toBe('function')
    expect(typeof adapters.createTokenStandardAdapter).toBe('function')
    expect(typeof adapters.createAnsAdapter).toBe('function')
    expect(typeof adapters.createValidatorUserAdapter).toBe('function')
  })

  it('keeps stable adapters isolated from experimental module imports', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const stableFiles = ['ans.ts', 'index.ts', 'ledger.ts', 'scan-proxy.ts', 'scan.ts', 'token-standard.ts', 'validator-user.ts']

    for (const file of stableFiles) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8')
      expect(source).not.toMatch(/experimental\//)
      expect(source).not.toMatch(/experimental\./)
    }
  })
})
