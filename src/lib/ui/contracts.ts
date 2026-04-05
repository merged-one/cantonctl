import type {ProfileKind, ServiceName} from '../config-profile.js'
import type {CheckResult} from '../doctor.js'

export type UiTone = 'fail' | 'info' | 'pass' | 'skip' | 'warn'

export interface UiApiError {
  code: string
  message: string
  suggestion?: string
}

export interface UiApiEnvelope<T> {
  data?: T
  error?: UiApiError
  success: boolean
}

export interface UiBootstrapData {
  sessionToken: string
}

export interface UiAuthState {
  authenticated: boolean
  mode: string
  source: string
  warnings: string[]
}

export interface UiProfileSummary {
  auth: UiAuthState
  experimental: boolean
  isDefault: boolean
  kind: ProfileKind
  name: string
  networkName: string
  readiness: {
    detail: string
    tone: UiTone
  }
  services: ServiceName[]
}

export interface UiSessionData {
  configPath: string
  defaultProfile?: string
  project: {
    name: string
    sdkVersion: string
  }
  requestedProfile?: string
  profiles: UiProfileSummary[]
  selectedProfile?: string
  storageKey: string
}

export interface UiAdvisory {
  detail: string
  source: string
  tone: UiTone
}

export interface UiServiceStatus {
  detail: string
  endpoint?: string
  name: ServiceName | string
  stability: string
  status: string
  tone: UiTone
}

export interface UiOverviewData {
  advisories: UiAdvisory[]
  environmentPath: Array<{
    active: boolean
    label: string
    profiles: string[]
    stage: 'local' | 'remote' | 'sandbox'
  }>
  profile: {
    kind: ProfileKind
    name: string
  }
  readiness: {
    failed: number
    passed: number
    skipped: number
    success: boolean
    warned: number
  }
  services: UiServiceStatus[]
}

export interface UiProfileDetailData {
  auth: UiAuthState
  imports: {
    localnet?: {
      sourceProfile?: string
      version?: string
      workspace?: string
    }
    scan?: {
      url?: string
    }
  }
  json: Record<string, unknown>
  networkMappings: string[]
  services: UiServiceStatus[]
  validation: {
    detail: string
    valid: boolean
  }
  yaml: string
}

export interface UiProfilesData {
  profiles: UiProfileSummary[]
  selected: UiProfileDetailData & {
    experimental: boolean
    kind: ProfileKind
    name: string
    networkName: string
  }
}

export interface UiRuntimeNode {
  detail?: string
  id: string
  kind: string
  label: string
  status: string
  tone: UiTone
  url?: string
}

export interface UiRuntimeEdge {
  from: string
  label?: string
  to: string
}

export interface UiRuntimeData {
  autoPoll: boolean
  mode: 'canton-multi' | 'remote' | 'sandbox' | 'splice-localnet'
  profile: {
    kind: ProfileKind
    name: string
  }
  serviceMap?: {
    edges: UiRuntimeEdge[]
    nodes: UiRuntimeNode[]
  }
  summary?: {
    healthDetail?: string
    jsonApiPort?: number
    ledgerUrl?: string
    partyCount?: number
    version?: string
    workspace?: string
  }
  topology?: {
    exportJson: string
    participants: Array<{
      healthy: boolean
      name: string
      parties: string[]
      ports: {
        admin: number
        jsonApi: number
        ledgerApi: number
      }
      version?: string
    }>
    synchronizer: {
      admin: number
      publicApi: number
    }
    topologyName: string
  }
}

export interface UiChecksData {
  auth: UiAuthState & {
    envVarName: string
  }
  canary: {
    checks: Array<{
      detail: string
      status: string
      suite: string
      warnings: string[]
    }>
    selectedSuites: string[]
    skippedSuites: string[]
    success: boolean
  }
  compatibility: {
    checks: Array<{
      detail: string
      name: string
      status: string
    }>
    failed: number
    passed: number
    warned: number
  }
  doctor: {
    checks: CheckResult[]
    failed: number
    passed: number
    warned: number
  }
  preflight: {
    checks: Array<{
      category: string
      detail: string
      endpoint?: string
      name: string
      status: string
    }>
    network: {
      checklist: string[]
      name: string
      reminders: string[]
      resetExpectation: string
      tier: string
    }
    success: boolean
  }
  profile: {
    kind: ProfileKind
    name: string
  }
  readiness: {
    failed: number
    passed: number
    skipped: number
    success: boolean
    warned: number
  }
}

export interface UiSupportData {
  defaults: {
    diagnosticsOutputDir: string
    exportTargets: string[]
    scanUrl?: string
  }
  profile: {
    kind: ProfileKind
    name: string
  }
}
