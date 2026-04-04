import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

import Deploy from './deploy.js'
import Doctor from './doctor.js'
import Init from './init.js'
import Playground from './playground.js'
import Serve from './serve.js'
import Status from './status.js'

const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as {description: string}

describe('help positioning', () => {
  it('keeps companion language in package metadata and key command descriptions', () => {
    expect(packageJson.description).toBe('Splice-aware orchestration companion for the official Canton stack')
    expect(Doctor.description).toContain('profile-aware environment readiness')
    expect(Serve.description).toContain('profile-aware Canton IDE Protocol backend')
    expect(Playground.description).toContain('local browser workbench')
    expect(Init.description).toContain('companion-ready Canton project')
    expect(Status.description).toContain('profile-aware service health')
    expect(Deploy.description).toContain('advisory DAR deploy wrapper')
  })

  it('keeps retired umbrella language out of key command descriptions', () => {
    const descriptions = [
      Doctor.description,
      Serve.description,
      Playground.description,
      Init.description,
      Status.description,
      Deploy.description,
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
