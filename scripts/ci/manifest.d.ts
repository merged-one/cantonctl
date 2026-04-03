export interface VitestProjectConfig {
  include: string[]
  name: string
}

export interface CiSuite {
  id: string
  label: string
  npmScript: string
  prerequisites: string[]
  scopes: string[]
  timeoutMinutes: number
  type: string
}

export interface CoverageThresholds {
  branches: number
  functions: number
  lines: number
  statements: number
}

export interface CoveragePolicy {
  criticalFiles: Record<string, CoverageThresholds>
  exclude: string[]
  groups: Record<string, {prefixes: string[]; thresholds: CoverageThresholds}>
  include: string[]
}

export const CI_TOOLCHAIN: {
  cantonImage: string
  damlSdkVersion: string
  javaVersion: string
  unitNodeVersions: number[]
}

export const VITEST_PROJECTS: Record<string, VitestProjectConfig>
export const CI_SUITES: Record<string, CiSuite>
export const CI_MODES: Record<string, string[]>
export const COVERAGE_POLICY: CoveragePolicy

export function getModeSuites(mode: string): CiSuite[]
export function getSuitesForScope(scope: string): CiSuite[]
export function getRequiredSuitesForScope(scope: string): CiSuite[]
export function isSupportedUnitNodeVersion(nodeVersion: number | string): boolean
