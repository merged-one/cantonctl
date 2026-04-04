import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: ['scripts/coverage-repro/**/*.test.ts', 'scripts/coverage-repro/vitest.config.ts'],
      include: ['scripts/coverage-repro/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    environment: 'node',
    globals: true,
    include: ['scripts/coverage-repro/**/*.test.ts'],
  },
})
