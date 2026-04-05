import type {
  UiApiEnvelope,
  UiBootstrapData,
  UiChecksData,
  UiMapData,
  UiOverviewData,
  UiProfilesData,
  UiRuntimeData,
  UiSessionData,
  UiSupportData,
} from '../../src/lib/ui/contracts'

export class UiApiError extends Error {
  code?: string
  suggestion?: string

  constructor(message: string, options: {code?: string; suggestion?: string} = {}) {
    super(message)
    this.name = 'UiApiError'
    this.code = options.code
    this.suggestion = options.suggestion
  }
}

declare global {
  interface Window {
    __CANTONCTL_UI__?: UiBootstrapData
  }
}

export async function fetchSession(profile?: string): Promise<UiSessionData> {
  return fetchEnvelope(`/ui/session${withProfile(profile)}`)
}

export async function fetchOverview(profile: string): Promise<UiOverviewData> {
  return fetchEnvelope(`/ui/overview${withProfile(profile)}`)
}

export async function fetchMap(profile: string): Promise<UiMapData> {
  return fetchEnvelope(`/ui/map${withProfile(profile)}`)
}

export async function fetchProfiles(profile: string): Promise<UiProfilesData> {
  return fetchEnvelope(`/ui/profiles${withProfile(profile)}`)
}

export async function fetchRuntime(profile: string): Promise<UiRuntimeData> {
  return fetchEnvelope(`/ui/runtime${withProfile(profile)}`)
}

export async function fetchChecks(profile: string): Promise<UiChecksData> {
  return fetchEnvelope(`/ui/checks${withProfile(profile)}`)
}

export async function fetchCheckSection<T>(
  profile: string,
  section: 'auth' | 'canary' | 'compatibility' | 'doctor' | 'preflight',
): Promise<T> {
  return fetchEnvelope(`/ui/checks/${section}${withProfile(profile)}`)
}

export async function fetchSupport(profile: string): Promise<UiSupportData> {
  return fetchEnvelope(`/ui/support${withProfile(profile)}`)
}

async function fetchEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'X-Cantonctl-Ui-Session': getSessionToken(),
      ...(init?.headers ?? {}),
    },
  })
  const body = await response.json() as UiApiEnvelope<T>

  if (!response.ok || !body.success || body.data === undefined) {
    throw new UiApiError(body.error?.message ?? `Request failed: ${response.status}`, {
      code: body.error?.code,
      suggestion: body.error?.suggestion,
    })
  }

  return body.data
}

function withProfile(profile?: string): string {
  if (!profile) return ''
  return `?profile=${encodeURIComponent(profile)}`
}

function getSessionToken(): string {
  const token = window.__CANTONCTL_UI__?.sessionToken
  if (!token) {
    throw new UiApiError('UI bootstrap session token is missing.')
  }

  return token
}
