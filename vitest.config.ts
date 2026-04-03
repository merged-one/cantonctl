import {defineConfig} from 'vitest/config'

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
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['test/e2e/**'],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 10_000,
        },
      },
      {
        test: {
          name: 'e2e-sdk',
          include: [
            'test/e2e/init.e2e.test.ts',
            'test/e2e/build.e2e.test.ts',
            'test/e2e/build-watch.e2e.test.ts',
            'test/e2e/test-cmd.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'e2e-stable-public',
          include: [
            'test/e2e/scan.e2e.test.ts',
            'test/e2e/token-standard.e2e.test.ts',
            'test/e2e/ans.e2e.test.ts',
            'test/e2e/localnet.e2e.test.ts',
            'test/e2e/scan-validator.e2e.test.ts',
            'test/e2e/compat.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'e2e-sandbox',
          include: [
            'test/e2e/dev.e2e.test.ts',
            'test/e2e/deploy.e2e.test.ts',
            'test/e2e/status.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 120_000,
          // Each sandbox test file runs in its own forked process. This
          // prevents vitest's worker cleanup from killing JVM child processes
          // spawned by prior test files.
          pool: 'forks',
          poolOptions: {forks: {singleFork: true}},
          retry: 1,
        },
      },
      {
        test: {
          name: 'e2e-docker',
          include: [
            'test/e2e/dev-full.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 300_000, // 5 min — accounts for container startup + health polling
          // Sequential: Docker containers need exclusive port access.
          pool: 'forks',
          poolOptions: {forks: {singleFork: true}},
          retry: 1,
        },
      },
      {
        test: {
          name: 'e2e-playground',
          include: [
            'test/e2e/playground.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 120_000,
          // Sequential: playground starts its own sandbox + serve server.
          pool: 'forks',
          poolOptions: {forks: {singleFork: true}},
          retry: 1,
        },
      },
      {
        test: {
          name: 'e2e-experimental',
          include: [
            'test/e2e/experimental-scan-proxy.e2e.test.ts',
          ],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          disableConsoleIntercept: true,
          globals: true,
          testTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/lib/process-runner.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
})
