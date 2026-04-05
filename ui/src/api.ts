import type {
  UiActivityEntry,
  UiApiEnvelope,
  UiChecksData,
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

export interface UiJobData extends UiActivityEntry {
  error?: {
    code: string
    message: string
    suggestion?: string
  }
  result?: unknown
  updatedAt: string
}

export async function fetchSession(profile?: string): Promise<UiSessionData> {
  return fetchEnvelope(`/ui/session${withProfile(profile)}`)
}

export async function fetchOverview(profile: string): Promise<UiOverviewData> {
  return fetchEnvelope(`/ui/overview${withProfile(profile)}`)
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

export async function fetchCheckSection<T>(profile: string, section: 'auth' | 'canary' | 'compatibility' | 'doctor' | 'preflight'): Promise<T> {
  return fetchEnvelope(`/ui/checks/${section}${withProfile(profile)}`)
}

export async function fetchSupport(profile: string): Promise<UiSupportData> {
  return fetchEnvelope(`/ui/support${withProfile(profile)}`)
}

export async function startAction(
  actionPath: string,
  options: {
    payload?: Record<string, unknown>
    profile?: string
  },
): Promise<{jobId: string}> {
  return fetchEnvelope(`/ui/actions/${actionPath}${withProfile(options.profile)}`, {
    body: JSON.stringify(options.payload ?? {}),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
}

export async function fetchJob(jobId: string): Promise<UiJobData> {
  return fetchEnvelope(`/ui/jobs/${jobId}`)
}

async function fetchEnvelope<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
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
