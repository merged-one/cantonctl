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

  getTemplates: () => request<{templates: DamlTemplate[]}>('/api/templates'),

  getTemplate: (name: string) => request<DamlTemplate>(`/api/templates/${name}`),

  getMultiPartyContracts: (parties: string[]) =>
    request<{contracts: Record<string, ActiveContract[]>}>(`/api/contracts/multi?parties=${parties.join(',')}`),

  build: () => request<{darPath?: string; durationMs?: number}>('/api/build', {method: 'POST'}),

  test: () => request<{passed: boolean; output: string}>('/api/test', {method: 'POST'}),
}
