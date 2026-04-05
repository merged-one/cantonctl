import React, {useEffect, useState, type ReactNode} from 'react'

import {useQuery, useQueryClient} from '@tanstack/react-query'

import type {
  UiActivityEntry,
  UiChecksData,
  UiOverviewData,
  UiProfileSummary,
  UiRuntimeData,
  UiSupportData,
  UiTone,
} from '../../src/lib/ui/contracts'
import {
  fetchCheckSection,
  fetchChecks,
  fetchJob,
  fetchOverview,
  fetchProfiles,
  fetchRuntime,
  fetchSession,
  fetchSupport,
  startAction,
  type UiJobData,
} from './api'
import {Card, EmptyState, JsonPanel, SectionTitle, TonePill} from './components/primitives'
import {resolveInitialProfileSelection} from './profile-selection'

type View = 'checks' | 'overview' | 'profiles' | 'runtime' | 'support'
type ActionKind =
  | 'auth/login'
  | 'auth/logout'
  | 'localnet/down'
  | 'localnet/up'
  | 'profiles/import-localnet'
  | 'profiles/import-scan'
  | 'support/diagnostics-bundle'
  | 'support/discover-network'
  | 'support/export-sdk-config'

interface DrawerState {
  action: ActionKind
  draft: Record<string, unknown>
  job?: UiJobData
  submitting: boolean
}

const VIEWS: Array<{description: string; id: View; label: string}> = [
  {description: 'Readiness, service posture, and session outputs.', id: 'overview', label: 'Overview'},
  {description: 'Profile detail, validation, imports, and auth.', id: 'profiles', label: 'Profiles'},
  {description: 'Runtime topology or service dependencies.', id: 'runtime', label: 'Runtime'},
  {description: 'Auth, compatibility, preflight, canary, and doctor.', id: 'checks', label: 'Checks'},
  {description: 'Diagnostics, discovery, SDK config export, and activity.', id: 'support', label: 'Support'},
]

const DRAWER_TITLES: Record<ActionKind, string> = {
  'auth/login': 'Authenticate Profile',
  'auth/logout': 'Remove Stored Credentials',
  'localnet/down': 'Stop LocalNet Workspace',
  'localnet/up': 'Start LocalNet Workspace',
  'profiles/import-localnet': 'Import LocalNet Workspace',
  'profiles/import-scan': 'Import Scan Discovery',
  'support/diagnostics-bundle': 'Create Diagnostics Bundle',
  'support/discover-network': 'Discover Network',
  'support/export-sdk-config': 'Export SDK Config',
}

export function App() {
  const queryClient = useQueryClient()
  const commandProfile = new URLSearchParams(window.location.search).get('profile') ?? undefined
  const [view, setView] = useState<View>('overview')
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  const sessionQuery = useQuery({
    placeholderData: previous => previous,
    queryFn: () => fetchSession(commandProfile),
    queryKey: ['ui', 'session', commandProfile],
  })

  useEffect(() => {
    const session = sessionQuery.data
    if (!session) return

    const stored = window.localStorage.getItem(session.storageKey)
    const next = resolveInitialProfileSelection(session, stored)
    setSelectedProfile(current => {
      if (current && session.profiles.some(profile => profile.name === current)) {
        return current
      }

      return next
    })
  }, [sessionQuery.data])

  useEffect(() => {
    if (!sessionQuery.data || !selectedProfile) return
    window.localStorage.setItem(sessionQuery.data.storageKey, selectedProfile)
  }, [selectedProfile, sessionQuery.data])

  const activeProfile = selectedProfile ?? sessionQuery.data?.selectedProfile
  const activeProfileSummary = sessionQuery.data?.profiles.find(profile => profile.name === activeProfile)
  const isLocalRuntime = activeProfileSummary
    ? ['sandbox', 'canton-multi', 'splice-localnet'].includes(activeProfileSummary.kind)
    : false

  const overviewQuery = useQuery({
    enabled: view === 'overview' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchOverview(activeProfile!),
    queryKey: ['ui', 'overview', activeProfile],
  })

  const profilesQuery = useQuery({
    enabled: view === 'profiles' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchProfiles(activeProfile!),
    queryKey: ['ui', 'profiles', activeProfile],
  })

  const runtimeQuery = useQuery({
    enabled: view === 'runtime' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchRuntime(activeProfile!),
    queryKey: ['ui', 'runtime', activeProfile],
    refetchInterval: view === 'runtime' && isLocalRuntime ? 10_000 : false,
  })

  const checksQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchChecks(activeProfile!),
    queryKey: ['ui', 'checks', activeProfile],
  })

  const supportQuery = useQuery({
    enabled: view === 'support' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchSupport(activeProfile!),
    queryKey: ['ui', 'support', activeProfile],
  })

  const authSectionQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchCheckSection<UiChecksData['auth']>(activeProfile!, 'auth'),
    queryKey: ['ui', 'checks', 'auth', activeProfile],
  })

  const compatibilitySectionQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchCheckSection<UiChecksData['compatibility']>(activeProfile!, 'compatibility'),
    queryKey: ['ui', 'checks', 'compatibility', activeProfile],
  })

  const preflightSectionQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchCheckSection<UiChecksData['preflight']>(activeProfile!, 'preflight'),
    queryKey: ['ui', 'checks', 'preflight', activeProfile],
  })

  const canarySectionQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchCheckSection<UiChecksData['canary']>(activeProfile!, 'canary'),
    queryKey: ['ui', 'checks', 'canary', activeProfile],
  })

  const doctorSectionQuery = useQuery({
    enabled: view === 'checks' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchCheckSection<UiChecksData['doctor']>(activeProfile!, 'doctor'),
    queryKey: ['ui', 'checks', 'doctor', activeProfile],
  })

  const activeDataUpdatedAt = [
    sessionQuery.dataUpdatedAt,
    overviewQuery.dataUpdatedAt,
    profilesQuery.dataUpdatedAt,
    runtimeQuery.dataUpdatedAt,
    checksQuery.dataUpdatedAt,
    supportQuery.dataUpdatedAt,
  ].filter(Boolean).sort((left, right) => right - left)[0]

  const headerKind = activeProfileSummary?.kind ?? sessionQuery.data?.profiles[0]?.kind

  return (
    <div className="ui-shell px-4 py-4 lg:px-6 lg:py-6">
      <div className="ui-grid">
        <aside className="ui-card flex flex-col gap-6 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">cantonctl ui</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight">Project-local control center</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Profile-centric visibility for sandbox, LocalNet, and remote Canton or Splice environments.
            </p>
          </div>

          <nav className="space-y-3">
            {VIEWS.map(item => (
              <button
                className="ui-nav-button"
                data-active={item.id === view}
                key={item.id}
                onClick={() => setView(item.id)}
                type="button"
              >
                <div>
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-soft)]">{item.description}</div>
                </div>
              </button>
            ))}
          </nav>

          <Card className="!rounded-[1.75rem]" title="Profiles">
            {sessionQuery.data?.profiles.length ? (
              <div className="space-y-3">
                {sessionQuery.data.profiles.map(profile => (
                  <button
                    className="ui-card-soft w-full rounded-2xl p-4 text-left transition hover:border-[var(--border-strong)]"
                    key={profile.name}
                    onClick={() => setSelectedProfile(profile.name)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">{profile.name}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">
                          {profile.kind}
                        </div>
                      </div>
                      <TonePill tone={profile.readiness.tone}>{profile.readiness.detail}</TonePill>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState body="No profiles resolved from cantonctl.yaml yet." title="No Profiles" />
            )}
          </Card>
        </aside>

        <main className="space-y-4">
          <header className="ui-card p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">Project</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold">{sessionQuery.data?.project.name ?? 'Loading project...'}</h2>
                  {headerKind ? <TonePill tone={isLocalRuntime ? 'info' : 'pass'}>{headerKind}</TonePill> : null}
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">
                  Last refresh {activeDataUpdatedAt ? formatRelativeTime(activeDataUpdatedAt) : 'pending'}
                </p>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="flex min-w-[13rem] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                  Selected profile
                  <select
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[var(--text-strong)] outline-none"
                    onChange={event => setSelectedProfile(event.target.value)}
                    value={activeProfile}
                  >
                    {sessionQuery.data?.profiles.map(profile => (
                      <option key={profile.name} value={profile.name}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:border-[var(--border-strong)] hover:bg-white/10"
                  onClick={() => refreshEverything(queryClient, activeProfile, setView)}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)] transition hover:border-[var(--accent)]/55 hover:bg-[var(--accent)]/18"
                  onClick={() => refreshEverything(queryClient, activeProfile, setView, 'checks')}
                  type="button"
                >
                  Run readiness
                </button>
              </div>
            </div>
          </header>

          {view === 'overview' ? (
            <OverviewView
              data={overviewQuery.data}
              loading={overviewQuery.isLoading}
              onRunReadiness={() => refreshEverything(queryClient, activeProfile, setView, 'checks')}
            />
          ) : null}

          {view === 'profiles' ? (
            <ProfilesView
              data={profilesQuery.data}
              loading={profilesQuery.isLoading}
              onOpenAction={(action, draft) => setDrawer({action, draft, submitting: false})}
            />
          ) : null}

          {view === 'runtime' ? (
            <RuntimeView
              data={runtimeQuery.data}
              loading={runtimeQuery.isLoading}
              onOpenAction={(action, draft) => setDrawer({action, draft, submitting: false})}
            />
          ) : null}

          {view === 'checks' ? (
            <ChecksView
              auth={authSectionQuery.data}
              canary={canarySectionQuery.data}
              compatibility={compatibilitySectionQuery.data}
              doctor={doctorSectionQuery.data}
              loading={checksQuery.isLoading}
              preflight={preflightSectionQuery.data}
              readiness={checksQuery.data}
              rerun={(section) => queryClient.invalidateQueries({queryKey: ['ui', 'checks', section, activeProfile]})}
            />
          ) : null}

          {view === 'support' ? (
            <SupportView
              data={supportQuery.data}
              loading={supportQuery.isLoading}
              onOpenAction={(action, draft) => setDrawer({action, draft, submitting: false})}
            />
          ) : null}
        </main>

        <aside className="ui-card flex min-h-[40rem] flex-col">
          <div className="border-b border-white/5 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">Action Drawer</p>
            <h2 className="mt-2 text-xl font-semibold">{drawer ? DRAWER_TITLES[drawer.action] : 'Safe actions only'}</h2>
          </div>
          <div className="flex-1 p-5">
            {drawer ? (
              <DrawerContent
                activeProfile={activeProfileSummary}
                drawer={drawer}
                onClose={() => setDrawer(null)}
                onDraftChange={(nextDraft) => setDrawer(current => current ? {...current, draft: nextDraft} : current)}
                onRun={async () => {
                  if (!activeProfile) return
                  setDrawer(current => current ? {...current, submitting: true} : current)
                  const started = await startAction(drawer.action, {payload: drawer.draft, profile: activeProfile})
                  const job = await pollJob(started.jobId)
                  setDrawer(current => current ? {...current, job, submitting: false} : current)
                  await Promise.all([
                    queryClient.invalidateQueries({queryKey: ['ui', 'session']}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'overview', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'profiles', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'runtime', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'support', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', 'auth', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', 'compatibility', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', 'preflight', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', 'canary', activeProfile]}),
                    queryClient.invalidateQueries({queryKey: ['ui', 'checks', 'doctor', activeProfile]}),
                  ])
                }}
                supportData={supportQuery.data}
              />
            ) : (
              <EmptyState
                body="Open a profile-aware action from Profiles, Runtime, or Support. The drawer keeps the command preview visible and shows the structured result before the raw JSON payload."
                title="No Action Selected"
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function OverviewView(props: {
  data?: UiOverviewData
  loading: boolean
  onRunReadiness: () => void
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to load readiness, service status, and recent control-plane outputs." title="Overview Unavailable" />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Card title="Readiness">
        <SectionTitle
          action={(
            <button className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold" onClick={props.onRunReadiness} type="button">
              Run readiness
            </button>
          )}
          eyebrow="Primary gate"
          title={`${props.data.profile.name} readiness`}
        />
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <Metric label="Passed" value={props.data.readiness.passed} />
          <Metric label="Warned" tone="warn" value={props.data.readiness.warned} />
          <Metric label="Failed" tone="fail" value={props.data.readiness.failed} />
          <Metric label="Skipped" tone="skip" value={props.data.readiness.skipped} />
        </div>
      </Card>

      <Card title="Recent Outputs">
        <SectionTitle eyebrow="Session artifacts" title="What this UI produced" />
        <div className="mt-5 space-y-3">
          <RecentOutputCard entry={props.data.recentOutputs.diagnostics} fallback="No diagnostics bundle created in this session yet." title="Diagnostics bundle" />
          <RecentOutputCard entry={props.data.recentOutputs.sdkConfig} fallback="No SDK config export has run in this session yet." title="SDK config export" />
        </div>
      </Card>

      <Card title="Service Summary">
        <div className="grid gap-3 md:grid-cols-2">
          {props.data.services.map(service => (
            <div className="ui-card-soft rounded-2xl p-4" key={`${service.name}-${service.endpoint ?? service.detail}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold capitalize">{service.name}</div>
                <TonePill tone={service.tone}>{service.status}</TonePill>
              </div>
              <p className="mt-3 text-sm text-[var(--text-muted)]">{service.detail}</p>
              {service.endpoint ? (
                <p className="mt-3 break-all text-xs text-[var(--signal)]">{service.endpoint}</p>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Environment Path">
        <div className="space-y-3">
          {props.data.environmentPath.map(stage => (
            <div className="ui-card-soft rounded-2xl p-4" key={stage.label}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{stage.label}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{stage.stage}</div>
                </div>
                <TonePill tone={stage.active ? 'pass' : 'info'}>{stage.active ? 'selected' : 'available'}</TonePill>
              </div>
              <p className="mt-3 text-sm text-[var(--text-muted)]">{stage.profiles.join(', ')}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="xl:col-span-2" title="Advisories">
        {props.data.advisories.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {props.data.advisories.map(advisory => (
              <div className="ui-card-soft rounded-2xl p-4" key={`${advisory.source}-${advisory.detail}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{advisory.source}</div>
                  <TonePill tone={advisory.tone}>{advisory.tone}</TonePill>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{advisory.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState body="No current warnings surfaced by auth, readiness, preflight, or doctor." title="Quiet Control Plane" />
        )}
      </Card>
    </div>
  )
}

function ProfilesView(props: {
  data?: ReturnType<typeof fetchProfiles> extends Promise<infer T> ? T : never
  loading: boolean
  onOpenAction: (action: ActionKind, draft: Record<string, unknown>) => void
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to inspect its services, auth mode, and import paths." title="Profiles Unavailable" />
  }

  const selected = props.data.selected
  const usesFallback = ['sandbox', 'canton-multi', 'splice-localnet'].includes(selected.kind)

  return (
    <div className="grid gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <Card title="All Profiles">
        <div className="space-y-3">
          {props.data.profiles.map(profile => (
            <div className="ui-card-soft rounded-2xl p-4" key={profile.name}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{profile.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{profile.networkName}</div>
                </div>
                <TonePill tone={profile.readiness.tone}>{profile.readiness.detail}</TonePill>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-[var(--text-muted)]">
                <span>{profile.kind}</span>
                <TonePill tone={profile.auth.authenticated ? 'pass' : 'fail'}>
                  {profile.auth.authenticated ? profile.auth.source : 'auth-required'}
                </TonePill>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Selected Profile">
          <SectionTitle eyebrow={selected.kind} title={selected.name} />
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="ui-card-soft rounded-2xl p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">Network mappings</p>
                <p className="mt-3 text-sm text-[var(--text-muted)]">
                  {selected.networkMappings.length > 0 ? selected.networkMappings.join(', ') : 'No named network mappings reference this profile yet.'}
                </p>
              </div>
              <div className="ui-card-soft rounded-2xl p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">Validation</p>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{selected.validation.detail}</p>
              </div>
            </div>
            <div className="space-y-3">
              {selected.services.map(service => (
                <div className="ui-card-soft rounded-2xl p-4" key={`${service.name}-${service.endpoint ?? service.detail}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold capitalize">{service.name}</div>
                    <TonePill tone={service.tone}>{service.status}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{service.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <JsonPanel value={selected.json} />
            <details className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Resolved YAML</summary>
              <pre className="mt-4 overflow-x-auto text-xs leading-6 text-[var(--signal)]">{selected.yaml}</pre>
            </details>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Imports">
            <SectionTitle
              action={(
                <div className="flex gap-2">
                  <button
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
                    onClick={() => props.onOpenAction('profiles/import-localnet', {
                      name: selected.kind === 'splice-localnet' ? selected.name : 'splice-localnet',
                      networkName: selected.networkMappings[0] ?? 'localnet',
                      sourceProfile: selected.imports.localnet?.sourceProfile ?? 'sv',
                      workspace: selected.imports.localnet?.workspace ?? '',
                      write: false,
                    })}
                    type="button"
                  >
                    Import LocalNet
                  </button>
                  <button
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
                    onClick={() => props.onOpenAction('profiles/import-scan', {
                      kind: selected.kind === 'remote-sv-network' ? 'remote-sv-network' : 'remote-validator',
                      name: selected.name,
                      scanUrl: selected.imports.scan?.url ?? '',
                      write: false,
                    })}
                    type="button"
                  >
                    Import Scan
                  </button>
                </div>
              )}
              eyebrow="Bootstrap"
              title="Profile materialization"
            />
            <div className="mt-5 space-y-3 text-sm text-[var(--text-muted)]">
              <p>LocalNet workspace: {selected.imports.localnet?.workspace ?? 'Not imported yet.'}</p>
              <p>LocalNet source profile: {selected.imports.localnet?.sourceProfile ?? 'n/a'}</p>
              <p>Scan endpoint: {selected.imports.scan?.url ?? 'No scan endpoint configured.'}</p>
            </div>
          </Card>

          <Card title="Authentication">
            <SectionTitle eyebrow={selected.auth.mode} title={selected.auth.authenticated ? 'Credential resolved' : 'Credential missing'} />
            <div className="mt-5 space-y-3 text-sm text-[var(--text-muted)]">
              <p>Source: {selected.auth.source}</p>
              {selected.auth.warnings.map(warning => (
                <p key={warning}>{warning}</p>
              ))}
              {usesFallback ? (
                <p>Local profiles use the fallback token path. Login does not require a remote credential.</p>
              ) : null}
            </div>
            <div className="mt-5 flex gap-2">
              <button
                className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() => props.onOpenAction('auth/login', {token: ''})}
                type="button"
              >
                Login
              </button>
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
                onClick={() => props.onOpenAction('auth/logout', {})}
                type="button"
              >
                Logout
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function RuntimeView(props: {
  data?: UiRuntimeData
  loading: boolean
  onOpenAction: (action: ActionKind, draft: Record<string, unknown>) => void
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to render its local topology or remote service dependency map." title="Runtime Unavailable" />
  }

  return (
    <div className="space-y-4">
      <Card title="Runtime Summary">
        <SectionTitle eyebrow={props.data.mode} title={props.data.profile.name} />
        {props.data.summary ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Ledger URL" value={props.data.summary.ledgerUrl ?? 'n/a'} />
            <Metric label="Version" value={props.data.summary.version ?? 'n/a'} />
            <Metric label="Parties" value={props.data.summary.partyCount ?? 'n/a'} />
            <Metric label="Workspace" value={props.data.summary.workspace ?? 'n/a'} />
          </div>
        ) : null}
        {props.data.summary?.healthDetail ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.summary.healthDetail}</p>
        ) : null}
        {props.data.mode === 'splice-localnet' ? (
          <div className="mt-5 flex gap-2">
            <button
              className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold"
              onClick={() => props.onOpenAction('localnet/up', {})}
              type="button"
            >
              LocalNet up
            </button>
            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
              onClick={() => props.onOpenAction('localnet/down', {})}
              type="button"
            >
              LocalNet down
            </button>
          </div>
        ) : null}
      </Card>

      {props.data.mode === 'canton-multi' && props.data.topology ? (
        <Card title="Topology Graph">
          <div className="space-y-5">
            <div className="ui-card-soft mx-auto max-w-md rounded-3xl p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">Synchronizer</p>
              <p className="mt-2 text-lg font-semibold">{props.data.topology.topologyName}</p>
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                admin {props.data.topology.synchronizer.admin} • public {props.data.topology.synchronizer.publicApi}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {props.data.topology.participants.map(participant => (
                <div className="ui-card-soft rounded-3xl p-5" key={participant.name}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{participant.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">
                        json-api {participant.ports.jsonApi}
                      </div>
                    </div>
                    <TonePill tone={participant.healthy ? 'pass' : 'fail'}>
                      {participant.healthy ? 'healthy' : 'unreachable'}
                    </TonePill>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {participant.parties.map(party => (
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs" key={party}>
                        {party}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <JsonPanel value={props.data.topology.exportJson} />
          </div>
        </Card>
      ) : null}

      {props.data.serviceMap ? (
        <Card title={props.data.mode === 'splice-localnet' ? 'LocalNet Service Map' : 'Service Map'}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {props.data.serviceMap.nodes.map(node => (
                <div className="ui-card-soft rounded-3xl p-5" key={node.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{node.label}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--text-soft)]">{node.kind}</div>
                    </div>
                    <TonePill tone={node.tone}>{node.status}</TonePill>
                  </div>
                  {node.detail ? <p className="mt-3 text-sm text-[var(--text-muted)]">{node.detail}</p> : null}
                  {node.url ? <p className="mt-3 break-all text-xs text-[var(--signal)]">{node.url}</p> : null}
                </div>
              ))}
            </div>
            {props.data.serviceMap.edges.length > 0 ? (
              <div className="ui-card-soft rounded-3xl p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">Dependencies</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--text-muted)]">
                  {props.data.serviceMap.edges.map(edge => (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2" key={`${edge.from}-${edge.to}`}>
                      {edge.from} {edge.label ? `${edge.label} ` : ''}→ {edge.to}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function ChecksView(props: {
  auth?: UiChecksData['auth']
  canary?: UiChecksData['canary']
  compatibility?: UiChecksData['compatibility']
  doctor?: UiChecksData['doctor']
  loading: boolean
  preflight?: UiChecksData['preflight']
  readiness?: UiChecksData
  rerun: (section: 'auth' | 'canary' | 'compatibility' | 'doctor' | 'preflight') => void
}) {
  if (props.loading && !props.readiness) {
    return <SkeletonPanels />
  }

  if (!props.readiness) {
    return <EmptyState body="Select a profile to run auth, compatibility, preflight, canary, and doctor checks." title="Checks Unavailable" />
  }

  return (
    <div className="space-y-4">
      <Card title="Readiness Summary">
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Passed" value={props.readiness.readiness.passed} />
          <Metric label="Warned" tone="warn" value={props.readiness.readiness.warned} />
          <Metric label="Failed" tone="fail" value={props.readiness.readiness.failed} />
          <Metric label="Skipped" tone="skip" value={props.readiness.readiness.skipped} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <CheckCard title="Auth" tone={props.auth?.authenticated ? 'pass' : 'fail'} onRerun={() => props.rerun('auth')}>
          {props.auth ? (
            <div className="space-y-3 text-sm text-[var(--text-muted)]">
              <p>Mode: {props.auth.mode}</p>
              <p>Source: {props.auth.source}</p>
              <p>Env var: {props.auth.envVarName}</p>
              {props.auth.warnings.map(warning => <p key={warning}>{warning}</p>)}
            </div>
          ) : (
            <EmptyState body="Auth state has not loaded yet." title="Auth Pending" />
          )}
        </CheckCard>

        <CheckCard title="Compatibility" tone={(props.compatibility?.failed ?? 0) > 0 ? 'fail' : (props.compatibility?.warned ?? 0) > 0 ? 'warn' : 'pass'} onRerun={() => props.rerun('compatibility')}>
          {props.compatibility ? (
            <div className="space-y-3">
              {props.compatibility.checks.map(check => (
                <div className="ui-card-soft rounded-2xl p-4" key={check.name}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{check.name}</div>
                    <TonePill tone={toTone(check.status)}>{check.status}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{check.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </CheckCard>

        <CheckCard title="Preflight" tone={props.preflight?.success ? 'pass' : 'fail'} onRerun={() => props.rerun('preflight')}>
          {props.preflight ? (
            <div className="space-y-3">
              {props.preflight.checks.map(check => (
                <div className="ui-card-soft rounded-2xl p-4" key={`${check.name}-${check.endpoint ?? check.detail}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{check.name}</div>
                    <TonePill tone={toTone(check.status)}>{check.status}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{check.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </CheckCard>

        <CheckCard title="Canary" tone={props.canary?.success ? 'pass' : 'fail'} onRerun={() => props.rerun('canary')}>
          {props.canary ? (
            <div className="space-y-3">
              {props.canary.checks.map(check => (
                <div className="ui-card-soft rounded-2xl p-4" key={check.suite}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{check.suite}</div>
                    <TonePill tone={toTone(check.status)}>{check.status}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{check.detail}</p>
                  {check.warnings.length > 0 ? (
                    <div className="mt-3 text-xs text-[var(--warn)]">{check.warnings.join(' • ')}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CheckCard>
      </div>

      <CheckCard title="Doctor" tone={(props.doctor?.failed ?? 0) > 0 ? 'fail' : (props.doctor?.warned ?? 0) > 0 ? 'warn' : 'pass'} onRerun={() => props.rerun('doctor')}>
        {props.doctor ? (
          <div className="grid gap-3 md:grid-cols-2">
            {props.doctor.checks.map(check => (
              <div className="ui-card-soft rounded-2xl p-4" key={check.name}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{check.name}</div>
                  <TonePill tone={toTone(check.status)}>{check.status}</TonePill>
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{check.detail}</p>
                {check.fix ? <p className="mt-3 text-xs text-[var(--warn)]">{check.fix}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </CheckCard>
    </div>
  )
}

function SupportView(props: {
  data?: UiSupportData
  loading: boolean
  onOpenAction: (action: ActionKind, draft: Record<string, unknown>) => void
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to produce diagnostics, discovery snapshots, or SDK config output." title="Support Unavailable" />
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Diagnostics Bundle">
          <SectionTitle
            eyebrow="Bundle"
            title="Create a read-only support snapshot"
            action={(
              <button
                className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold"
                onClick={() => props.onOpenAction('support/diagnostics-bundle', {output: props.data?.defaults.diagnosticsOutputDir ?? ''})}
                type="button"
              >
                Create bundle
              </button>
            )}
          />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.diagnosticsOutputDir}</p>
        </Card>

        <Card title="Discovery">
          <SectionTitle
            eyebrow="Scan"
            title="Fetch stable/public network metadata"
            action={(
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
                onClick={() => props.onOpenAction('support/discover-network', {scanUrl: props.data?.defaults.scanUrl ?? ''})}
                type="button"
              >
                Discover
              </button>
            )}
          />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.scanUrl ?? 'Provide a scan URL in the drawer.'}</p>
        </Card>

        <Card title="SDK Export">
          <SectionTitle
            eyebrow="Official SDKs"
            title="Preview derived configuration"
            action={(
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold"
                onClick={() => props.onOpenAction('support/export-sdk-config', {format: 'json', target: 'dapp-sdk'})}
                type="button"
              >
                Export
              </button>
            )}
          />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.exportTargets.join(', ')}</p>
        </Card>
      </div>

      <Card title="Session Activity">
        {props.data.activity.length > 0 ? (
          <div className="space-y-3">
            {props.data.activity.map(entry => (
              <div className="ui-card-soft rounded-2xl p-4" key={entry.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{entry.action}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{formatTimestamp(entry.createdAt)}</div>
                  </div>
                  <TonePill tone={entry.status === 'success' ? 'pass' : entry.status === 'error' ? 'fail' : 'info'}>
                    {entry.status}
                  </TonePill>
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{entry.preview}</p>
                {entry.summary ? <p className="mt-2 text-sm text-[var(--signal)]">{entry.summary}</p> : null}
                {entry.artifactPath ? <p className="mt-2 break-all text-xs text-[var(--signal)]">{entry.artifactPath}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState body="Actions you run from this control center will appear here with timestamps, previews, status, and artifact paths." title="No Activity Yet" />
        )}
      </Card>
    </div>
  )
}

function DrawerContent(props: {
  activeProfile?: UiProfileSummary
  drawer: DrawerState
  onClose: () => void
  onDraftChange: (draft: Record<string, unknown>) => void
  onRun: () => Promise<void>
  supportData?: UiSupportData
}) {
  const preview = buildDrawerPreview(props.drawer.action, props.drawer.draft, props.activeProfile)

  return (
    <div className="flex h-full flex-col justify-between gap-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <TonePill tone="info">command preview</TonePill>
          <button className="text-sm text-[var(--text-muted)]" onClick={props.onClose} type="button">Close</button>
        </div>
        <pre className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-[var(--signal)]">{preview}</pre>
        <DrawerForm
          action={props.drawer.action}
          draft={props.drawer.draft}
          onDraftChange={props.onDraftChange}
          supportData={props.supportData}
        />
        {props.drawer.job ? (
          <div className="space-y-4">
            <div className="ui-card-soft rounded-3xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{props.drawer.job.action}</div>
                <TonePill tone={props.drawer.job.status === 'success' ? 'pass' : props.drawer.job.status === 'error' ? 'fail' : 'info'}>
                  {props.drawer.job.status}
                </TonePill>
              </div>
              {props.drawer.job.summary ? <p className="mt-3 text-sm text-[var(--text-muted)]">{props.drawer.job.summary}</p> : null}
              {props.drawer.job.error ? (
                <p className="mt-3 text-sm text-[color:var(--fail)]">
                  {props.drawer.job.error.code}: {props.drawer.job.error.message}
                </p>
              ) : null}
              {props.drawer.job.artifactPath ? <p className="mt-3 break-all text-xs text-[var(--signal)]">{props.drawer.job.artifactPath}</p> : null}
            </div>
            <JsonPanel value={props.drawer.job.result ?? props.drawer.job} />
          </div>
        ) : null}
      </div>

      <button
        className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold transition hover:border-[var(--accent)]/50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={props.drawer.submitting}
        onClick={() => {
          void props.onRun()
        }}
        type="button"
      >
        {props.drawer.submitting ? 'Running…' : 'Confirm'}
      </button>
    </div>
  )
}

function DrawerForm(props: {
  action: ActionKind
  draft: Record<string, unknown>
  onDraftChange: (draft: Record<string, unknown>) => void
  supportData?: UiSupportData
}) {
  const update = (field: string, value: unknown) => props.onDraftChange({...props.draft, [field]: value})

  switch (props.action) {
    case 'auth/login':
      return (
        <FormField label="Token">
          <textarea
            className="min-h-28 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
            onChange={event => update('token', event.target.value)}
            placeholder="Paste bearer token"
            value={String(props.draft.token ?? '')}
          />
        </FormField>
      )

    case 'profiles/import-localnet':
      return (
        <div className="space-y-4">
          <FormField label="Workspace">
            <input className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('workspace', event.target.value)} value={String(props.draft.workspace ?? '')} />
          </FormField>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Source profile">
              <select className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('sourceProfile', event.target.value)} value={String(props.draft.sourceProfile ?? 'sv')}>
                <option value="sv">sv</option>
                <option value="app-provider">app-provider</option>
                <option value="app-user">app-user</option>
              </select>
            </FormField>
            <FormField label="Write to config">
              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                <input checked={Boolean(props.draft.write)} onChange={event => update('write', event.target.checked)} type="checkbox" />
                Update `cantonctl.yaml`
              </label>
            </FormField>
          </div>
        </div>
      )

    case 'profiles/import-scan':
    case 'support/discover-network':
      return (
        <div className="space-y-4">
          <FormField label="Scan URL">
            <input className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('scanUrl', event.target.value)} value={String(props.draft.scanUrl ?? props.supportData?.defaults.scanUrl ?? '')} />
          </FormField>
          {props.action === 'profiles/import-scan' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Kind">
                <select className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('kind', event.target.value)} value={String(props.draft.kind ?? 'remote-validator')}>
                  <option value="remote-validator">remote-validator</option>
                  <option value="remote-sv-network">remote-sv-network</option>
                </select>
              </FormField>
              <FormField label="Write to config">
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                  <input checked={Boolean(props.draft.write)} onChange={event => update('write', event.target.checked)} type="checkbox" />
                  Update `cantonctl.yaml`
                </label>
              </FormField>
            </div>
          ) : null}
        </div>
      )

    case 'support/diagnostics-bundle':
      return (
        <FormField label="Output directory">
          <input className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('output', event.target.value)} value={String(props.draft.output ?? props.supportData?.defaults.diagnosticsOutputDir ?? '')} />
        </FormField>
      )

    case 'support/export-sdk-config':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Target">
            <select className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('target', event.target.value)} value={String(props.draft.target ?? 'dapp-sdk')}>
              {props.supportData?.defaults.exportTargets.map(target => (
                <option key={target} value={target}>{target}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Format">
            <select className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm" onChange={event => update('format', event.target.value)} value={String(props.draft.format ?? 'json')}>
              <option value="json">json</option>
              <option value="env">env</option>
            </select>
          </FormField>
        </div>
      )

    default:
      return (
        <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[var(--text-muted)]">
          This action has no extra fields. Review the command preview and confirm when ready.
        </p>
      )
  }
}

function CheckCard(props: {children: ReactNode; onRerun: () => void; title: string; tone: UiTone}) {
  return (
    <Card title={props.title} tone={props.tone}>
      <SectionTitle
        action={(
          <button className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold" onClick={props.onRerun} type="button">
            Rerun
          </button>
        )}
        title={props.title}
      />
      <div className="mt-5">{props.children}</div>
    </Card>
  )
}

function Metric(props: {label: string; tone?: UiTone; value: number | string}) {
  return (
    <div className="ui-card-soft rounded-2xl p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">{props.label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold">{props.value}</div>
        {props.tone ? <TonePill tone={props.tone}>{props.tone}</TonePill> : null}
      </div>
    </div>
  )
}

function RecentOutputCard(props: {entry?: UiActivityEntry; fallback: string; title: string}) {
  return (
    <div className="ui-card-soft rounded-2xl p-4">
      <div className="text-sm font-semibold">{props.title}</div>
      {props.entry ? (
        <>
          <p className="mt-3 text-sm text-[var(--text-muted)]">{props.entry.summary ?? props.entry.preview}</p>
          {props.entry.artifactPath ? <p className="mt-2 break-all text-xs text-[var(--signal)]">{props.entry.artifactPath}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-muted)]">{props.fallback}</p>
      )}
    </div>
  )
}

function FormField(props: {children: ReactNode; label: string}) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">{props.label}</div>
      {props.children}
    </label>
  )
}

function SkeletonPanels() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({length: 4}, (_, index) => (
        <div className="ui-card h-52 animate-pulse" key={index} />
      ))}
    </div>
  )
}

function buildDrawerPreview(
  action: ActionKind,
  draft: Record<string, unknown>,
  profile?: UiProfileSummary,
): string {
  switch (action) {
    case 'auth/login':
      return `cantonctl auth login ${profile?.networkName ?? '<network>'}${draft.token ? ' --token <redacted>' : ''}`
    case 'auth/logout':
      return `cantonctl auth logout ${profile?.networkName ?? '<network>'}`
    case 'localnet/up':
      return `cantonctl localnet up --workspace <imported-workspace>`
    case 'localnet/down':
      return `cantonctl localnet down --workspace <imported-workspace>`
    case 'profiles/import-localnet':
      return `cantonctl profiles import-localnet --workspace ${String(draft.workspace ?? '<workspace>')}${draft.write ? ' --write' : ''}`
    case 'profiles/import-scan':
      return `cantonctl profiles import-scan --scan-url ${String(draft.scanUrl ?? '<scan-url>')} --kind ${String(draft.kind ?? '<kind>')}${draft.write ? ' --write' : ''}`
    case 'support/diagnostics-bundle':
      return `cantonctl diagnostics bundle --profile ${profile?.name ?? '<profile>'}${draft.output ? ` --output ${String(draft.output)}` : ''}`
    case 'support/discover-network':
      return `cantonctl discover network --scan-url ${String(draft.scanUrl ?? '<scan-url>')}`
    case 'support/export-sdk-config':
      return `cantonctl export sdk-config --profile ${profile?.name ?? '<profile>'} --target ${String(draft.target ?? 'dapp-sdk')} --format ${String(draft.format ?? 'json')}`
  }
}

async function pollJob(jobId: string): Promise<UiJobData> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const job = await fetchJob(jobId)
    if (job.status !== 'running') {
      return job
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  throw new Error(`Job ${jobId} timed out`)
}

function refreshEverything(
  queryClient: ReturnType<typeof useQueryClient>,
  activeProfile: string | undefined,
  setView: (view: View) => void,
  nextView?: View,
) {
  if (nextView) setView(nextView)
  void Promise.all([
    queryClient.invalidateQueries({queryKey: ['ui', 'session']}),
    activeProfile ? queryClient.invalidateQueries({queryKey: ['ui', 'overview', activeProfile]}) : Promise.resolve(),
    activeProfile ? queryClient.invalidateQueries({queryKey: ['ui', 'profiles', activeProfile]}) : Promise.resolve(),
    activeProfile ? queryClient.invalidateQueries({queryKey: ['ui', 'runtime', activeProfile]}) : Promise.resolve(),
    activeProfile ? queryClient.invalidateQueries({queryKey: ['ui', 'checks', activeProfile]}) : Promise.resolve(),
    activeProfile ? queryClient.invalidateQueries({queryKey: ['ui', 'support', activeProfile]}) : Promise.resolve(),
  ])
}

function toTone(status: string): UiTone {
  switch (status) {
    case 'healthy':
    case 'pass':
      return 'pass'
    case 'auth-required':
    case 'warn':
      return 'warn'
    case 'fail':
    case 'unreachable':
      return 'fail'
    case 'skip':
    case 'not-exposed':
      return 'skip'
    default:
      return 'info'
  }
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffSeconds = Math.max(0, Math.round(diffMs / 1000))
  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.round(diffMinutes / 60)
  return `${diffHours}h ago`
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}
