#!/usr/bin/env node

import process from 'node:process'

import {CI_TOOLCHAIN, getRequiredSuitesForScope, getSuitesForScope} from './manifest.js'

function toMatrixEntry(suite) {
  return {
    id: suite.id,
    label: suite.label,
    needsDaml: suite.prerequisites.includes('daml'),
    needsDocker: suite.prerequisites.includes('docker') || suite.prerequisites.includes('canton-image'),
    needsJava: suite.prerequisites.includes('java'),
    npmScript: suite.npmScript,
    timeoutMinutes: suite.timeoutMinutes,
  }
}

const outputs = {
  cantonImage: CI_TOOLCHAIN.cantonImage,
  damlSdkVersion: CI_TOOLCHAIN.damlSdkVersion,
  javaVersion: CI_TOOLCHAIN.javaVersion,
  mainExtraSuites: JSON.stringify(
    getSuitesForScope('main')
      .filter((suite) => !suite.scopes.includes('pr') && suite.id !== 'unit')
      .map(toMatrixEntry),
  ),
  prSuites: JSON.stringify(getRequiredSuitesForScope('pr').map(toMatrixEntry)),
  releaseSuites: JSON.stringify(getRequiredSuitesForScope('release').map(toMatrixEntry)),
  unitNodeVersions: JSON.stringify(CI_TOOLCHAIN.unitNodeVersions),
}

const outputFile = process.env.GITHUB_OUTPUT
if (outputFile) {
  const {appendFileSync} = await import('node:fs')
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(outputFile, `${key}=${value}\n`)
  }
} else {
  for (const [key, value] of Object.entries(outputs)) {
    console.log(`${key}=${value}`)
  }
}
