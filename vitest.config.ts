import {defineConfig} from 'vitest/config'

import {COVERAGE_POLICY, VITEST_PROJECTS} from './scripts/ci/manifest.js'

/**
 * Vitest configuration with focused test projects:
 *
 * - unit: Fast, no external dependencies, parallel execution.
 * - e2e-sdk: Requires Daml SDK + Java for build/test/init flows.
 * - e2e-stable-public: Stable/public Canton + Splice command surfaces.
 * - e2e-sandbox: Requires running Canton sandbox (JVM). Sequential file
 *   execution to avoid resource contention from concurrent JVM processes.
 * - e2e-docker: Requires Docker + Canton image + Daml SDK + Java. Sequential
 *   execution for Docker resource isolation. Tests `dev --full` topology.
 * - e2e-experimental: Experimental or operator-only surfaces kept separate
 *   from the GA required matrix.
 */
export default defineConfig({
  esbuild: {
    sourcemap: false,
  },
  test: {
    projects: Object.values(VITEST_PROJECTS).map(test => ({test})),
    coverage: {
      all: true,
      exclude: [...COVERAGE_POLICY.exclude],
      experimentalAstAwareRemapping: false,
      include: [...COVERAGE_POLICY.include],
      provider: 'v8',
      reporter: [...COVERAGE_POLICY.reporters],
      thresholds: process.env.COVERAGE_STRICT === '1'
        ? {...COVERAGE_POLICY.strictThresholds}
        : undefined,
    },
  },
})
