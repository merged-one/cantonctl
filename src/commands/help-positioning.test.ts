import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

import Deploy from './deploy.js'
import Doctor from './doctor.js'
import Init from './init.js'
import OperatorValidatorLicenses from './operator/validator/licenses.js'
import Preflight from './preflight.js'
import Readiness from './readiness.js'
import Status from './status.js'
import UpgradeCheck from './upgrade/check.js'

const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as {description: string}

describe('help positioning', () => {
  it('keeps companion language in package metadata and key command descriptions', () => {
    expect(packageJson.description).toBe('Splice-aware orchestration companion for the official Canton stack')
    expect(Doctor.description).toContain('profile-aware environment readiness')
    expect(Readiness.description).toContain('composed readiness gate')
    expect(Init.description).toContain('companion-ready Canton project')
    expect(Status.description).toContain('profile-aware service health')
    expect(Deploy.description).toContain('built DAR')
    expect(OperatorValidatorLicenses.description).toContain('explicit operator Scan surface')
    expect(Preflight.description).toContain('current read-only readiness checks')
    expect(UpgradeCheck.description).toContain('upgrade workflow')
  })

  it('keeps retired umbrella language out of key command descriptions', () => {
    const descriptions = [
      Doctor.description,
      Readiness.description,
      Init.description,
      Status.description,
      Deploy.description,
      OperatorValidatorLicenses.description,
      Preflight.description,
      UpgradeCheck.description,
      packageJson.description,
    ]

    for (const description of descriptions) {
      expect(description).not.toContain('Hardhat')
      expect(description).not.toContain('Institutional-grade CLI toolchain')
      expect(description).not.toContain('Remix-like')
      expect(description).not.toContain('complete developer toolchain')
    }
  })
})
