/**
 * REST client for the cantonctl playground server.
 */

const BASE = ''  // Same origin — proxied by Vite in dev, served by Express in prod

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface ActiveContract {
  contractId: string
  templateId: string
  payload: Record<string, unknown>
  createdAt?: string
  offset?: number
}

export interface DamlField {
  name: string
  type: string
}

export interface DamlChoice {
  name: string
  returnType: string
  args: DamlField[]
  controller: string
  consuming: boolean
}

export interface DamlTemplate {
  name: string
  module: string
  fields: DamlField[]
  choices: DamlChoice[]
  signatory: string
}

export interface PartyDetails {
  party: string
  displayName?: string
  identifier?: string
  isLocal: boolean
}

export interface ProfileListEntry {
  experimental: boolean
  isDefault: boolean
  kind: string
  name: string
  services: string[]
}

export interface ProfileSummary {
  experimental: boolean
  kind: string
  name: string
}

export interface ServiceHealthEntry {
  detail: string
  endpoint?: string
  error?: string
  healthy: boolean
  name: string
  status: 'auth-required' | 'configured' | 'healthy' | 'unconfigured' | 'unreachable'
  version?: string
}

export interface CompatCheck {
  detail: string
  name: string
  status: string
}

export interface TokenHolding {
  amount?: string
  contractId?: string
  owner?: string
}

export interface ScanUpdate {
  kind?: string
  migrationId?: number
  recordTime?: string
  updateId?: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {'Content-Type': 'application/json'},
    ...options,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${body}`)
  }
  return res.json()
}

export const api = {
  getHealth: () => request<{healthy: boolean; version?: string}>('/api/health'),

  getProfile: () => request<{
    profiles: ProfileListEntry[]
    selectedProfile: ProfileSummary | null
    source: string | null
  }>('/api/profile'),

  setProfile: (profile: string) =>
    request<{
      profiles: ProfileListEntry[]
      selectedProfile: ProfileSummary | null
      source: string | null
    }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({profile}),
    }),

  getProfileStatus: () => request<{
    healthy: boolean
    profile: ProfileSummary | null
    services: ServiceHealthEntry[]
  }>('/api/profile/status'),

  getProfileCompat: () => request<{
    checks: CompatCheck[]
    failed: number
    passed: number
    profile: ProfileSummary
    warned: number
  }>('/api/profile/compat'),

  getFiles: () => request<FileNode[]>('/api/files'),

  getFile: (path: string) => request<{content: string; path: string}>(`/api/files/${path}`),

  saveFile: (path: string, content: string) =>
    request<{saved: boolean}>(`/api/files/${path}`, {
      method: 'PUT',
      body: JSON.stringify({content}),
    }),

  getParties: () => request<{partyDetails: PartyDetails[]}>('/api/parties'),

  getContracts: (party: string, templateId?: string) => {
    const params = new URLSearchParams({party})
    if (templateId) params.set('templateId', templateId)
    return request<{activeContracts: ActiveContract[]}>(`/api/contracts?${params}`)
  },

  submitCommand: (actAs: string[], commands: unknown[]) =>
    request<{transaction: Record<string, unknown>}>('/api/commands', {
      method: 'POST',
      body: JSON.stringify({actAs, commands}),
    }),

  getProject: () => request<{name: string; version: string; projectDir: string}>('/api/project'),

  getTemplates: () => request<{templates: DamlTemplate[]}>('/api/templates'),

  getTemplate: (name: string) => request<DamlTemplate>(`/api/templates/${name}`),

  getMultiPartyContracts: (parties: string[]) =>
    request<{contracts: Record<string, ActiveContract[]>}>(`/api/contracts/multi?parties=${parties.join(',')}`),

  getTopology: () => request<{
    mode: 'single' | 'multi'
    participants: Array<{name: string; port: number}>
    synchronizer: {admin: number; publicApi: number} | null
    topology: {
      participants: Array<{name: string; parties: string[]; ports: {admin: number; jsonApi: number; ledgerApi: number}}>
      synchronizer: {admin: number; publicApi: number}
    } | null
  }>('/api/topology'),

  getTopologyStatus: () => request<{
    participants: Array<{
      name: string
      healthy: boolean
      version?: string
      port: number
      parties: Array<Record<string, unknown>>
      contractCount: number
    }>
  }>('/api/topology/status'),

  getSpliceTokenHoldings: (party: string) =>
    request<{holdings: TokenHolding[]; warnings: string[]}>(`/api/splice/token-holdings?party=${encodeURIComponent(party)}`),

  getScanUpdates: (pageSize = 5) =>
    request<{updates: ScanUpdate[]; warnings: string[]}>(`/api/splice/scan/updates?pageSize=${pageSize}`),

  build: () => request<{darPath?: string; durationMs?: number}>('/api/build', {method: 'POST'}),

  test: () => request<{passed: boolean; output: string}>('/api/test', {method: 'POST'}),
}
