import {defineConfig} from 'vitest/config'

import {COVERAGE_POLICY, VITEST_PROJECTS} from './scripts/ci/manifest.js'

const coverageProvider = process.env.COVERAGE_PROVIDER ?? 'istanbul'

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
  test: {
    projects: Object.values(VITEST_PROJECTS).map(test => ({test})),
    coverage: {
      all: true,
      exclude: [...COVERAGE_POLICY.exclude],
      experimentalAstAwareRemapping: COVERAGE_POLICY.astAwareRemapping,
      include: [...COVERAGE_POLICY.include],
      // This repo has reproducible V8 misattribution on some TypeScript files.
      // Default coverage to Istanbul and keep V8 available via COVERAGE_PROVIDER=v8
      // for diagnostics and provider comparisons.
      provider: coverageProvider as 'istanbul' | 'v8',
      reporter: [...COVERAGE_POLICY.reporters],
      thresholds: process.env.COVERAGE_STRICT === '1'
        ? {...COVERAGE_POLICY.strictThresholds}
        : undefined,
    },
  },
})
