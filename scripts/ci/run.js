#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import process from 'node:process'

import {
  CI_MODES,
  CI_SUITES,
  CI_TOOLCHAIN,
  getModeSuites,
  isSupportedUnitNodeVersion,
} from './manifest.js'

const CI_IMAGE_SERVICE = 'ci'
const CI_COMPOSE_FILE = 'docker-compose.ci.yml'

function fail(message) {
  console.error(`\nERROR: ${message}`)
  process.exit(1)
}

function usage() {
  const suiteIds = Object.keys(CI_SUITES).join('|')
  const modes = Object.keys(CI_MODES).join('|')
  console.log(
    `Usage:
  node scripts/ci/run.js native <${modes}|${suiteIds}>
  node scripts/ci/run.js docker <${modes}|${suiteIds}>
  node scripts/ci/run.js inside <${modes}|${suiteIds}>
  node scripts/ci/run.js suite <${suiteIds}>
`,
  )
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    env: options.env ?? process.env,
    stdio: 'inherit',
    cwd: options.cwd ?? process.cwd(),
  })

  if (result.error) {
    throw result.error
  }

  return result.status ?? 1
}

function commandSucceeds(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    env: options.env ?? process.env,
    stdio: 'ignore',
    cwd: options.cwd ?? process.cwd(),
  })
  return result.status === 0
}

function getNodeMajorVersion() {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
}

function ensureSuitePrerequisites(suiteId) {
  const suite = CI_SUITES[suiteId]
  if (!suite) {
    fail(`Unknown suite: ${suiteId}`)
  }

  if (suiteId === 'unit' && !isSupportedUnitNodeVersion(getNodeMajorVersion())) {
    fail(
      `Unit suite requires one of Node ${CI_TOOLCHAIN.unitNodeVersions.join(', ')}. ` +
      `Current Node is ${process.versions.node}. Use Docker parity mode instead.`,
    )
  }

  for (const prerequisite of suite.prerequisites) {
    switch (prerequisite) {
      case 'daml':
        if (!commandSucceeds('daml', ['version', '--no-legacy-assistant-warning'])) {
          fail(`Suite "${suiteId}" requires the Daml SDK (${CI_TOOLCHAIN.damlSdkVersion}).`)
        }
        break
      case 'java':
        if (!commandSucceeds('java', ['-version'])) {
          fail(`Suite "${suiteId}" requires Java ${CI_TOOLCHAIN.javaVersion}.`)
        }
        break
      case 'docker':
        if (!commandSucceeds('docker', ['compose', 'version'])) {
          fail(`Suite "${suiteId}" requires Docker with Compose v2.`)
        }
        break
      case 'canton-image':
        if (!commandSucceeds('docker', ['image', 'inspect', CI_TOOLCHAIN.cantonImage])) {
          fail(
            `Suite "${suiteId}" requires the Canton image ${CI_TOOLCHAIN.cantonImage}. ` +
            'Pull it first or use the Docker parity runner that prepares it.',
          )
        }
        break
      default:
        fail(`Unsupported prerequisite "${prerequisite}" for suite "${suiteId}".`)
    }
  }
}

function suiteIdsForTarget(target) {
  if (target in CI_MODES) {
    return getModeSuites(target).map((suite) => suite.id)
  }

  if (target in CI_SUITES) {
    return [target]
  }

  fail(`Unknown target "${target}".`)
}

function runSuite(suiteId) {
  ensureSuitePrerequisites(suiteId)
  const suite = CI_SUITES[suiteId]
  console.log(`\n==> ${suite.label}`)
  const exitCode = runCommand('npm', ['run', suite.npmScript])
  if (exitCode !== 0) {
    fail(`Suite "${suiteId}" failed.`)
  }
}

function runInsideTarget(target) {
  const suites = suiteIdsForTarget(target)
  console.log(`\n==> Container CI target: ${target}`)
  console.log(`Node: ${process.versions.node}`)
  for (const suiteId of suites) {
    runSuite(suiteId)
  }
}

function runNativeTarget(target) {
  const suites = suiteIdsForTarget(target)
  console.log(`\n==> Native CI target: ${target}`)
  console.log(`Node: ${process.versions.node}`)

  if (!isSupportedUnitNodeVersion(getNodeMajorVersion())) {
    fail(
      `Native CI only supports Node ${CI_TOOLCHAIN.unitNodeVersions.join(', ')}. ` +
      `Current Node is ${process.versions.node}. Use "npm run ci" for authoritative parity.`,
    )
  }

  if (runCommand('npm', ['ci']) !== 0) {
    fail('npm ci failed.')
  }
  if (runCommand('npm', ['run', 'build']) !== 0) {
    fail('npm run build failed.')
  }

  for (const suiteId of suites) {
    runSuite(suiteId)
  }
}

function runDockerTarget(target) {
  console.log(`\n==> Docker CI target: ${target}`)
  if (!commandSucceeds('docker', ['compose', 'version'])) {
    fail('Docker Compose v2 is required for Docker CI.')
  }

  const envForNode = (nodeVersion) => ({
    ...process.env,
    NODE_VERSION: String(nodeVersion),
  })

  const buildImage = (nodeVersion) => {
    console.log(`\n==> Build CI image for Node ${nodeVersion}`)
    const exitCode = runCommand(
      'docker',
      ['compose', '-f', CI_COMPOSE_FILE, 'build', CI_IMAGE_SERVICE],
      {env: envForNode(nodeVersion)},
    )
    if (exitCode !== 0) {
      fail(`Failed to build CI image for Node ${nodeVersion}.`)
    }
  }

  const runInside = (nodeVersion, insideTarget) => {
    console.log(`\n==> Run ${insideTarget} in CI image (Node ${nodeVersion})`)
    const exitCode = runCommand(
      'docker',
      ['compose', '-f', CI_COMPOSE_FILE, 'run', '--rm', CI_IMAGE_SERVICE, insideTarget],
      {env: envForNode(nodeVersion)},
    )
    if (exitCode !== 0) {
      fail(`Docker CI target "${insideTarget}" failed on Node ${nodeVersion}.`)
    }
  }

  if (target === 'unit') {
    for (const nodeVersion of CI_TOOLCHAIN.unitNodeVersions) {
      buildImage(nodeVersion)
      runInside(nodeVersion, 'unit')
    }
    return
  }

  buildImage(22)
  if (target in CI_MODES) {
    for (const nodeVersion of CI_TOOLCHAIN.unitNodeVersions) {
      if (nodeVersion === 22) {
        runInside(nodeVersion, 'unit')
        continue
      }

      buildImage(nodeVersion)
      runInside(nodeVersion, 'unit')
      buildImage(22)
    }
    runInside(22, target)
    return
  }

  runInside(22, target)
}

const [runnerMode, target = 'required'] = process.argv.slice(2)

if (!runnerMode || ['-h', '--help', 'help'].includes(runnerMode)) {
  usage()
  process.exit(0)
}

switch (runnerMode) {
  case 'native':
    runNativeTarget(target)
    break
  case 'docker':
    runDockerTarget(target)
    break
  case 'inside':
    runInsideTarget(target)
    break
  case 'suite':
    if (!(target in CI_SUITES)) {
      fail(`Unknown suite "${target}".`)
    }
    runSuite(target)
    break
  default:
    usage()
    fail(`Unknown runner mode "${runnerMode}".`)
}
