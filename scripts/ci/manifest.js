export const CI_TOOLCHAIN = Object.freeze({
  cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
  damlSdkVersion: '3.4.11',
  javaVersion: '21',
  unitNodeVersions: Object.freeze([18, 20, 22]),
})

const UNIT_PROJECT = Object.freeze({
  environment: 'node',
  exclude: ['test/e2e/**'],
  globals: true,
  include: ['src/**/*.test.ts'],
  setupFiles: ['./vitest.setup.ts'],
  testTimeout: 10_000,
})

const PROJECT_DEFAULTS = Object.freeze({
  disableConsoleIntercept: true,
  environment: 'node',
  globals: true,
  setupFiles: ['./vitest.setup.ts'],
})

export const VITEST_PROJECTS = Object.freeze({
  unit: Object.freeze({
    ...PROJECT_DEFAULTS,
    ...UNIT_PROJECT,
    name: 'unit',
  }),
  'e2e-sdk': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/init.e2e.test.ts',
      'test/e2e/build.e2e.test.ts',
      'test/e2e/build-watch.e2e.test.ts',
      'test/e2e/test-cmd.e2e.test.ts',
    ],
    name: 'e2e-sdk',
    testTimeout: 120_000,
  }),
  'e2e-stable-public': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/scan.e2e.test.ts',
      'test/e2e/token-standard.e2e.test.ts',
      'test/e2e/ans.e2e.test.ts',
      'test/e2e/localnet.e2e.test.ts',
      'test/e2e/scan-validator.e2e.test.ts',
      'test/e2e/compat.e2e.test.ts',
    ],
    name: 'e2e-stable-public',
    testTimeout: 120_000,
  }),
  'e2e-sandbox': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/dev.e2e.test.ts',
      'test/e2e/deploy.e2e.test.ts',
      'test/e2e/status.e2e.test.ts',
    ],
    name: 'e2e-sandbox',
    pool: 'forks',
    poolOptions: {forks: {singleFork: true}},
    retry: 1,
    testTimeout: 120_000,
  }),
  'e2e-docker': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/dev-full.e2e.test.ts',
    ],
    name: 'e2e-docker',
    pool: 'forks',
    poolOptions: {forks: {singleFork: true}},
    retry: 1,
    testTimeout: 300_000,
  }),
  'e2e-playground': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/playground.e2e.test.ts',
    ],
    name: 'e2e-playground',
    pool: 'forks',
    poolOptions: {forks: {singleFork: true}},
    retry: 1,
    testTimeout: 120_000,
  }),
  'e2e-experimental': Object.freeze({
    ...PROJECT_DEFAULTS,
    include: [
      'test/e2e/experimental-scan-proxy.e2e.test.ts',
    ],
    name: 'e2e-experimental',
    testTimeout: 120_000,
  }),
})

export const CI_SUITES = Object.freeze({
  unit: Object.freeze({
    id: 'unit',
    label: 'unit-tests',
    npmScript: 'test:unit',
    prerequisites: [],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'unit-matrix',
  }),
  'generated-specs': Object.freeze({
    id: 'generated-specs',
    label: 'generated-specs',
    npmScript: 'test:generated-specs',
    prerequisites: [],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
  'e2e-sdk': Object.freeze({
    id: 'e2e-sdk',
    label: 'e2e-sdk',
    npmScript: 'test:e2e:sdk',
    prerequisites: ['daml', 'java'],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
  'e2e-stable-public': Object.freeze({
    id: 'e2e-stable-public',
    label: 'e2e-stable-public',
    npmScript: 'test:e2e:stable-public',
    prerequisites: [],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
  'e2e-sandbox': Object.freeze({
    id: 'e2e-sandbox',
    label: 'e2e-sandbox',
    npmScript: 'test:e2e:sandbox',
    prerequisites: ['daml', 'java'],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
  'e2e-playground': Object.freeze({
    id: 'e2e-playground',
    label: 'e2e-playground',
    npmScript: 'test:e2e:playground',
    prerequisites: ['daml', 'java'],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
  'e2e-docker': Object.freeze({
    id: 'e2e-docker',
    label: 'e2e-docker',
    npmScript: 'test:e2e:docker',
    prerequisites: ['daml', 'java', 'docker', 'canton-image'],
    scopes: ['pr', 'main', 'release'],
    timeoutMinutes: 15,
    type: 'suite',
  }),
  'e2e-experimental': Object.freeze({
    id: 'e2e-experimental',
    label: 'e2e-experimental',
    npmScript: 'test:e2e:experimental',
    prerequisites: [],
    scopes: ['main'],
    timeoutMinutes: 10,
    type: 'suite',
  }),
})

export const CI_MODES = Object.freeze({
  all: Object.freeze([
    'generated-specs',
    'e2e-sdk',
    'e2e-stable-public',
    'e2e-sandbox',
    'e2e-playground',
    'e2e-docker',
    'e2e-experimental',
  ]),
  required: Object.freeze([
    'generated-specs',
    'e2e-sdk',
    'e2e-stable-public',
    'e2e-sandbox',
    'e2e-playground',
    'e2e-docker',
  ]),
})

export const COVERAGE_POLICY = Object.freeze({
  criticalFiles: Object.freeze({
    'src/hooks/init.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/hooks/prerun.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/lib/credential-store.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/lib/errors.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/lib/output.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/lib/plugin-hooks.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
    'src/lib/process-runner.ts': Object.freeze({branches: 95, functions: 100, lines: 100, statements: 100}),
  }),
  groups: Object.freeze({
    commands: Object.freeze({
      prefixes: Object.freeze(['src/commands/']),
      thresholds: Object.freeze({branches: 85, functions: 90, lines: 90, statements: 90}),
    }),
    hooks: Object.freeze({
      prefixes: Object.freeze(['src/hooks/']),
      thresholds: Object.freeze({branches: 100, functions: 100, lines: 100, statements: 100}),
    }),
    lib: Object.freeze({
      prefixes: Object.freeze(['src/lib/']),
      thresholds: Object.freeze({branches: 90, functions: 90, lines: 95, statements: 95}),
    }),
  }),
  include: Object.freeze(['src/lib/**/*.ts', 'src/commands/**/*.ts', 'src/hooks/**/*.ts']),
  exclude: Object.freeze([
    'src/**/*.test.ts',
    'src/**/*.d.ts',
    'src/generated/**',
  ]),
})

export function getModeSuites(mode) {
  if (!(mode in CI_MODES)) {
    throw new Error(`Unknown CI mode: ${mode}`)
  }

  return [...CI_MODES[mode]].map((id) => CI_SUITES[id])
}

export function getSuitesForScope(scope) {
  return Object.values(CI_SUITES).filter((suite) => suite.scopes.includes(scope))
}

export function getRequiredSuitesForScope(scope) {
  return getSuitesForScope(scope).filter((suite) => suite.id !== 'unit')
}

export function isSupportedUnitNodeVersion(nodeVersion) {
  return CI_TOOLCHAIN.unitNodeVersions.includes(Number(nodeVersion))
}
