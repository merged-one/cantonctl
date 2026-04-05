import React, {useEffect, useState, type ReactNode} from 'react'

import {useQuery, useQueryClient} from '@tanstack/react-query'

import type {
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
  fetchOverview,
  fetchProfiles,
  fetchRuntime,
  fetchSession,
  fetchSupport,
} from './api'
import {Card, EmptyState, JsonPanel, SectionTitle, TonePill} from './components/primitives'
import {resolveInitialProfileSelection} from './profile-selection'

type View = 'checks' | 'overview' | 'profiles' | 'runtime' | 'support'

interface SuggestedCommand {
  command: string
  description: string
  tone: UiTone
}

const VIEWS: Array<{description: string; id: View; label: string}> = [
  {description: 'Readiness, service posture, and session outputs.', id: 'overview', label: 'Overview'},
  {description: 'Profile detail, validation, imports, and auth.', id: 'profiles', label: 'Profiles'},
  {description: 'Runtime topology or service dependencies.', id: 'runtime', label: 'Runtime'},
  {description: 'Auth, compatibility, preflight, canary, and doctor.', id: 'checks', label: 'Checks'},
  {description: 'Diagnostics posture, discovery inputs, and SDK export targets.', id: 'support', label: 'Support'},
]

export function App() {
  const queryClient = useQueryClient()
  const commandProfile = new URLSearchParams(window.location.search).get('profile') ?? undefined
  const [view, setView] = useState<View>('overview')
  const [selectedProfile, setSelectedProfile] = useState<string>()

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
            />
          ) : null}

          {view === 'runtime' ? (
            <RuntimeView
              data={runtimeQuery.data}
              loading={runtimeQuery.isLoading}
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
            />
          ) : null}
        </main>

        <aside className="ui-card flex min-h-[40rem] flex-col">
          <div className="border-b border-white/5 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-soft)]">CLI Companion</p>
            <h2 className="mt-2 text-xl font-semibold">Read-only UI, explicit CLI handoff</h2>
          </div>
          <div className="flex-1 p-5">
            <CommandRail
              activeProfile={activeProfileSummary}
              profilesData={profilesQuery.data}
              runtimeData={runtimeQuery.data}
              supportData={supportQuery.data}
              view={view}
            />
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

      <Card title="Scope">
        <SectionTitle eyebrow="Narrow slice" title="Visualization first" />
        <p className="mt-5 text-sm leading-6 text-[var(--text-muted)]">
          This UI is intentionally read-only. Use it to inspect profile state, readiness, runtime topology, and support posture, then hand off to the CLI for any auth, import, LocalNet, diagnostics, or export action.
        </p>
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
            <SectionTitle eyebrow="Bootstrap" title="Profile materialization" />
            <div className="mt-5 space-y-3 text-sm text-[var(--text-muted)]">
              <p>LocalNet workspace: {selected.imports.localnet?.workspace ?? 'Not imported yet.'}</p>
              <p>LocalNet source profile: {selected.imports.localnet?.sourceProfile ?? 'n/a'}</p>
              <p>Scan endpoint: {selected.imports.scan?.url ?? 'No scan endpoint configured.'}</p>
              <p>The CLI companion rail shows the exact import commands for this profile.</p>
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
              <p>Auth changes stay CLI-only so the UI does not expose a localhost mutation surface.</p>
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
          <SectionTitle eyebrow="Bundle" title="Project-local output target" />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.diagnosticsOutputDir}</p>
        </Card>

        <Card title="Discovery">
          <SectionTitle eyebrow="Scan" title="Stable/public metadata source" />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.scanUrl ?? 'No scan URL is configured for this profile.'}</p>
        </Card>

        <Card title="SDK Export">
          <SectionTitle eyebrow="Official SDKs" title="Derived CLI export targets" />
          <p className="mt-4 text-sm text-[var(--text-muted)]">{props.data.defaults.exportTargets.join(', ')}</p>
        </Card>
      </div>

      <Card title="CLI-only Support Actions">
        <EmptyState
          body="Diagnostics bundles, discovery fetches, and SDK config exports stay CLI-only in this hardened UI. Use the command companion rail to jump from the visualization into the exact command."
          title="Explicit Handoff"
        />
      </Card>
    </div>
  )
}

function CommandRail(props: {
  activeProfile?: UiProfileSummary
  profilesData?: ReturnType<typeof fetchProfiles> extends Promise<infer T> ? T : never
  runtimeData?: UiRuntimeData
  supportData?: UiSupportData
  view: View
}) {
  const commands = buildSuggestedCommands(props)

  if (!props.activeProfile) {
    return (
      <EmptyState
        body="Select a profile to see the exact CLI commands that correspond to the current view."
        title="No Profile Selected"
      />
    )
  }

  return (
    <div className="space-y-4">
      <EmptyState
        body="The UI stays read-only. Use these commands for explicit auth, import, LocalNet, diagnostics, and export operations outside the browser."
        title="CLI-only Execution"
      />
      {commands.map(command => (
        <div className="ui-card-soft rounded-3xl p-4" key={`${command.command}-${command.description}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">{command.description}</div>
            <TonePill tone={command.tone}>{command.tone}</TonePill>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-[var(--signal)]">
            {command.command}
          </pre>
        </div>
      ))}
    </div>
  )
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

function SkeletonPanels() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({length: 4}, (_, index) => (
        <div className="ui-card h-52 animate-pulse" key={index} />
      ))}
    </div>
  )
}

function buildSuggestedCommands(props: {
  activeProfile?: UiProfileSummary
  profilesData?: ReturnType<typeof fetchProfiles> extends Promise<infer T> ? T : never
  runtimeData?: UiRuntimeData
  supportData?: UiSupportData
  view: View
}): SuggestedCommand[] {
  const profile = props.activeProfile
  if (!profile) return []

  switch (props.view) {
    case 'overview':
      return [
        {
          command: `cantonctl readiness --profile ${profile.name}`,
          description: 'Run the composed readiness gate',
          tone: 'pass',
        },
        {
          command: `cantonctl status --profile ${profile.name} --json`,
          description: 'Inspect resolved service posture',
          tone: 'info',
        },
        {
          command: 'cantonctl doctor --json',
          description: 'Check machine-local prerequisites',
          tone: 'warn',
        },
        ...(profile.services.includes('scan')
          ? [{
            command: `cantonctl canary stable-public --profile ${profile.name} --json`,
            description: 'Exercise stable/public remote checks',
            tone: 'info' as const,
          }]
          : []),
      ]

    case 'profiles': {
      const commands: SuggestedCommand[] = [
        {
          command: `cantonctl profiles show ${profile.name} --json`,
          description: 'Inspect the resolved profile definition',
          tone: 'info',
        },
        {
          command: 'cantonctl profiles validate --json',
          description: 'Validate the canonical project config',
          tone: 'pass',
        },
      ]

      const detail = props.profilesData?.selected
      if (detail?.imports.localnet?.workspace) {
        commands.push({
          command: `cantonctl profiles import-localnet --workspace ${detail.imports.localnet.workspace} --write`,
          description: 'Refresh the imported LocalNet profile from its workspace',
          tone: 'warn',
        })
      }

      if (detail?.imports.scan?.url && (detail.kind === 'remote-sv-network' || detail.kind === 'remote-validator')) {
        commands.push({
          command: `cantonctl profiles import-scan --scan-url ${detail.imports.scan.url} --kind ${detail.kind} --write`,
          description: 'Refresh the remote profile from scan discovery',
          tone: 'warn',
        })
      }

      if (!profile.auth.authenticated && profile.kind === 'remote-validator') {
        commands.push({
          command: `cantonctl auth login ${profile.networkName}`,
          description: 'Resolve credentials for the selected remote profile',
          tone: 'fail',
        })
      }

      return commands
    }

    case 'runtime':
      if (props.runtimeData?.mode === 'canton-multi') {
        return [
          {
            command: `cantonctl topology show --profile ${profile.name} --json`,
            description: 'Inspect the local multi-participant topology',
            tone: 'pass',
          },
          {
            command: `cantonctl topology export --profile ${profile.name}`,
            description: 'Export the topology manifest for tooling or review',
            tone: 'info',
          },
        ]
      }

      if (props.runtimeData?.mode === 'splice-localnet') {
        const workspace = props.runtimeData.summary?.workspace ?? '<workspace>'
        return [
          {
            command: `cantonctl localnet status --workspace ${workspace} --json`,
            description: 'Inspect the upstream LocalNet workspace status',
            tone: 'pass',
          },
          {
            command: `cantonctl localnet up --workspace ${workspace}`,
            description: 'Start the LocalNet workspace outside the browser',
            tone: 'warn',
          },
          {
            command: `cantonctl localnet down --workspace ${workspace}`,
            description: 'Stop the LocalNet workspace outside the browser',
            tone: 'warn',
          },
        ]
      }

      return [
        {
          command: `cantonctl status --profile ${profile.name} --json`,
          description: 'Refresh runtime state for the selected profile',
          tone: 'info',
        },
      ]

    case 'checks':
      return [
        {
          command: `cantonctl readiness --profile ${profile.name} --json`,
          description: 'Run the full readiness report',
          tone: 'pass',
        },
        {
          command: `cantonctl preflight --profile ${profile.name} --json`,
          description: 'Inspect preflight checks directly',
          tone: 'warn',
        },
        {
          command: `cantonctl compat check --profile ${profile.name} --json`,
          description: 'Inspect compatibility details directly',
          tone: 'info',
        },
        {
          command: 'cantonctl doctor --json',
          description: 'Re-run machine-local diagnostics',
          tone: 'warn',
        },
      ]

    case 'support':
      return [
        {
          command: `cantonctl diagnostics bundle --profile ${profile.name} --output ${props.supportData?.defaults.diagnosticsOutputDir ?? '.cantonctl/diagnostics'}`,
          description: 'Write a diagnostics bundle from the CLI',
          tone: 'warn',
        },
        ...(props.supportData?.defaults.scanUrl
          ? [{
            command: `cantonctl discover network --scan-url ${props.supportData.defaults.scanUrl} --json`,
            description: 'Fetch stable/public discovery metadata',
            tone: 'info' as const,
          }]
          : []),
        {
          command: `cantonctl export sdk-config --profile ${profile.name} --target dapp-sdk --format json`,
          description: 'Render derived SDK config from the CLI',
          tone: 'pass',
        },
      ]
  }
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
