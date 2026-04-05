import React, {useEffect, useState, type ReactNode} from 'react'

import {useQuery, useQueryClient} from '@tanstack/react-query'

import type {
  UiChecksData,
  UiMapData,
  UiMapFinding,
  UiMapNode,
  UiMapOverlay,
  UiProfileDetailData,
  UiProfileSummary,
  UiSupportData,
  UiTone,
} from '../../src/lib/ui/contracts'
import {
  fetchChecks,
  fetchMap,
  fetchProfiles,
  fetchSession,
  fetchSupport,
} from './api'
import {Card, EmptyState, JsonPanel, TonePill} from './components/primitives'
import {resolveInitialProfileSelection} from './profile-selection'

type View = 'checks' | 'map' | 'profiles' | 'support'
type InspectorTab = 'checks' | 'endpoints' | 'overview' | 'raw'

const VIEWS: Array<{description: string; id: View; label: string}> = [
  {description: 'Topology and service graph with live findings.', id: 'map', label: 'Map'},
  {description: 'Blocking checks, warnings, and machine posture.', id: 'checks', label: 'Checks'},
  {description: 'Resolved profile detail and environment deltas.', id: 'profiles', label: 'Profiles'},
  {description: 'Artifacts, discovery defaults, and export targets.', id: 'support', label: 'Support'},
]

const DEFAULT_OVERLAYS: UiMapOverlay[] = ['health', 'parties', 'ports', 'auth', 'checks']
const SERVICE_NODE_ORDER = ['auth', 'ledger', 'scan', 'validator', 'wallet', 'tokenStandard', 'ans']

export function App() {
  const queryClient = useQueryClient()
  const commandProfile = new URLSearchParams(window.location.search).get('profile') ?? undefined
  const [view, setView] = useState<View>('map')
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [overlays, setOverlays] = useState<UiMapOverlay[]>(DEFAULT_OVERLAYS)

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
  const comparisonProfile = getComparisonProfileName(sessionQuery.data?.profiles ?? [], activeProfile)
  const localRuntime = activeProfileSummary
    ? ['sandbox', 'canton-multi', 'splice-localnet'].includes(activeProfileSummary.kind)
    : false

  const mapQuery = useQuery({
    enabled: Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchMap(activeProfile!),
    queryKey: ['ui', 'map', activeProfile],
    refetchInterval: view === 'map' && localRuntime ? 10_000 : false,
  })

  const checksQuery = useQuery({
    enabled: Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchChecks(activeProfile!),
    queryKey: ['ui', 'checks', activeProfile],
  })

  const profilesQuery = useQuery({
    enabled: view === 'profiles' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchProfiles(activeProfile!),
    queryKey: ['ui', 'profiles', activeProfile],
  })

  const comparisonProfileQuery = useQuery({
    enabled: view === 'profiles' && Boolean(comparisonProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchProfiles(comparisonProfile!),
    queryKey: ['ui', 'profiles', 'compare', comparisonProfile],
  })

  const supportQuery = useQuery({
    enabled: view === 'support' && Boolean(activeProfile),
    placeholderData: previous => previous,
    queryFn: () => fetchSupport(activeProfile!),
    queryKey: ['ui', 'support', activeProfile],
  })

  useEffect(() => {
    const map = mapQuery.data
    if (!map) return

    setSelectedNodeId(current => {
      if (current && map.nodes.some(node => node.id === current)) {
        return current
      }

      return defaultNodeSelection(map)
    })
  }, [mapQuery.data])

  const activeNode = mapQuery.data?.nodes.find(node => node.id === selectedNodeId)
  const relatedFindings = mapQuery.data && activeNode
    ? mapQuery.data.findings.filter(finding => finding.nodeIds.includes(activeNode.id))
    : []

  const updatedAt = [
    sessionQuery.dataUpdatedAt,
    mapQuery.dataUpdatedAt,
    checksQuery.dataUpdatedAt,
    profilesQuery.dataUpdatedAt,
    supportQuery.dataUpdatedAt,
  ].filter(Boolean).sort((left, right) => right - left)[0]

  function toggleOverlay(overlay: UiMapOverlay) {
    setOverlays(current => current.includes(overlay)
      ? current.filter(item => item !== overlay)
      : [...current, overlay],
    )
  }

  function locateFinding(finding: UiMapFinding) {
    setSelectedNodeId(finding.nodeIds[0] ?? 'profile')
    setView('map')
  }

  function runRefresh(nextView?: View) {
    if (nextView) setView(nextView)
    void queryClient.invalidateQueries({queryKey: ['ui', 'session']})
    void queryClient.invalidateQueries({queryKey: ['ui', 'map', activeProfile]})
    void queryClient.invalidateQueries({queryKey: ['ui', 'checks', activeProfile]})
    void queryClient.invalidateQueries({queryKey: ['ui', 'profiles', activeProfile]})
    void queryClient.invalidateQueries({queryKey: ['ui', 'support', activeProfile]})
  }

  return (
    <div className="control-shell">
      <header className="control-topbar">
        <div>
          <p className="control-kicker">cantonctl ui</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-[var(--text-strong)]">
              {sessionQuery.data?.project.name ?? 'Loading project'}
            </h1>
            {activeProfileSummary ? <TonePill tone={activeProfileSummary.readiness.tone}>{activeProfileSummary.kind}</TonePill> : null}
            {mapQuery.data ? <TonePill tone={mapSummaryTone(mapQuery.data.summary)}>{mapQuery.data.summary.headline}</TonePill> : null}
          </div>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Profile {activeProfile ?? 'pending'} • Last refresh {updatedAt ? formatRelativeTime(updatedAt) : 'pending'}
          </p>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <label className="control-label">
            Selected profile
            <select
              className="control-select"
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
          <div className="flex flex-wrap gap-3">
            <button className="control-button" onClick={() => runRefresh()} type="button">
              Refresh
            </button>
            <button className="control-button control-button-primary" onClick={() => runRefresh('checks')} type="button">
              Run readiness
            </button>
          </div>
        </div>
      </header>

      <div className="control-layout">
        <aside className="control-nav">
          <div>
            <p className="control-kicker">Primary flow</p>
            <h2 className="mt-3 text-xl font-semibold text-[var(--text-strong)]">Topology-first control map</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Start on the live graph, inspect a node, then follow checks and support only when the map says something needs attention.
            </p>
          </div>

          <nav className="mt-8 space-y-3">
            {VIEWS.map(item => (
              <button
                className="control-nav-button"
                data-active={item.id === view}
                key={item.id}
                onClick={() => setView(item.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-soft)]">{item.description}</div>
                  </div>
                  {item.id === 'map' && mapQuery.data ? <TonePill tone={mapSummaryTone(mapQuery.data.summary)}>{mapQuery.data.profile.kind}</TonePill> : null}
                </div>
              </button>
            ))}
          </nav>

          <Card className="mt-8" title="Profiles">
            {sessionQuery.data?.profiles.length ? (
              <div className="space-y-3">
                {sessionQuery.data.profiles.map(profile => (
                  <button
                    className="profile-chip"
                    data-active={profile.name === activeProfile}
                    key={profile.name}
                    onClick={() => {
                      setSelectedProfile(profile.name)
                      setView('map')
                    }}
                    type="button"
                  >
                    <div>
                      <div className="font-semibold text-[var(--text-strong)]">{profile.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{profile.networkName}</div>
                    </div>
                    <TonePill tone={profile.readiness.tone}>{profile.readiness.detail}</TonePill>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState body="No profiles resolved from cantonctl.yaml." title="No profiles" />
            )}
          </Card>
        </aside>

        <main className="control-main">
          {view === 'map' ? (
            <MapView
              activeNode={activeNode}
              data={mapQuery.data}
              loading={mapQuery.isLoading}
              onFocusFinding={locateFinding}
              onSelectNode={setSelectedNodeId}
              onToggleOverlay={toggleOverlay}
              overlays={overlays}
              relatedFindings={relatedFindings}
            />
          ) : null}

          {view === 'checks' ? (
            <ChecksView
              data={checksQuery.data}
              loading={checksQuery.isLoading}
              map={mapQuery.data}
              onFocusFinding={locateFinding}
              onRerun={() => runRefresh('checks')}
            />
          ) : null}

          {view === 'profiles' ? (
            <ProfilesView
              comparison={comparisonProfileQuery.data?.selected}
              comparisonName={comparisonProfile}
              data={profilesQuery.data}
              loading={profilesQuery.isLoading}
            />
          ) : null}

          {view === 'support' ? (
            <SupportView
              data={supportQuery.data}
              findings={mapQuery.data?.findings ?? []}
              loading={supportQuery.isLoading}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function MapView(props: {
  activeNode?: UiMapNode
  data?: UiMapData
  loading: boolean
  onFocusFinding: (finding: UiMapFinding) => void
  onSelectNode: (nodeId: string) => void
  onToggleOverlay: (overlay: UiMapOverlay) => void
  overlays: UiMapOverlay[]
  relatedFindings: UiMapFinding[]
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to render its topology or service graph." title="Map unavailable" />
  }

  return (
    <div className="space-y-5">
      <section className="map-board">
        <div className="map-stage">
          <div className="stage-header">
            <div>
              <p className="control-kicker">Map</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{props.data.summary.headline}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{props.data.summary.detail}</p>
            </div>

            <div className="overlay-strip">
              {props.data.overlays.map(overlay => (
                <button
                  className="overlay-chip"
                  data-active={props.overlays.includes(overlay)}
                  key={overlay}
                  onClick={() => props.onToggleOverlay(overlay)}
                  type="button"
                >
                  {overlay}
                </button>
              ))}
            </div>
          </div>

          <div className="metrics-strip">
            <Metric label="Passed" value={props.data.summary.readiness.passed} />
            <Metric label="Warned" tone="warn" value={props.data.summary.readiness.warned} />
            <Metric label="Failed" tone="fail" value={props.data.summary.readiness.failed} />
            <Metric label="Skipped" tone="skip" value={props.data.summary.readiness.skipped} />
          </div>

          <MapCanvas
            data={props.data}
            overlays={props.overlays}
            selectedNodeId={props.activeNode?.id}
            onSelectNode={props.onSelectNode}
          />
        </div>

        <NodeInspector
          findings={props.relatedFindings}
          node={props.activeNode}
          onFocusFinding={props.onFocusFinding}
        />
      </section>

      <Card title="Activity Rail">
        {props.data.findings.length > 0 ? (
          <div className="activity-grid">
            {props.data.findings.map(finding => (
              <button
                className="activity-card"
                key={finding.id}
                onClick={() => props.onFocusFinding(finding)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{finding.title}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{finding.source}</div>
                  </div>
                  <TonePill tone={finding.tone}>{finding.tone}</TonePill>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{finding.detail}</p>
                <p className="mt-3 text-xs text-[var(--signal)]">{finding.nodeIds.map(toNodeLabel).join(' • ')}</p>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState body="No blocking or advisory findings are currently mapped onto the active graph." title="Quiet control plane" />
        )}
      </Card>
    </div>
  )
}

function ChecksView(props: {
  data?: UiChecksData
  loading: boolean
  map?: UiMapData
  onFocusFinding: (finding: UiMapFinding) => void
  onRerun: () => void
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to inspect blocking checks and warnings." title="Checks unavailable" />
  }

  const blocking = props.map?.findings.filter(finding => finding.tone === 'fail') ?? []
  const warnings = props.map?.findings.filter(finding => finding.tone === 'warn') ?? []
  const passed = collectPassedChecks(props.data)

  return (
    <div className="space-y-5">
      <Card title="Checks">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="control-kicker">Failure-oriented view</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{props.data.profile.name}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Findings stay grouped by operational impact first. Use “Locate on map” to jump back to the affected node.
            </p>
          </div>
          <button className="control-button control-button-primary" onClick={props.onRerun} type="button">
            Rerun checks
          </button>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChecksBucket
          findings={blocking}
          onFocusFinding={props.onFocusFinding}
          title="Blocking"
          tone="fail"
        />
        <ChecksBucket
          findings={warnings}
          onFocusFinding={props.onFocusFinding}
          title="Warnings"
          tone="warn"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Passed">
          {passed.length > 0 ? (
            <div className="space-y-3">
              {passed.map(item => (
                <div className="map-node-card" key={`${item.source}-${item.title}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-strong)]">{item.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{item.source}</div>
                    </div>
                    <TonePill tone="pass">pass</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{item.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState body="No passing checks are currently recorded for this profile." title="No passes" />
          )}
        </Card>

        <Card title="Machine">
          <div className="space-y-3">
            {props.data.doctor.checks.map(check => (
              <div className="map-node-card" key={check.name}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">{check.name}</div>
                  <TonePill tone={check.status === 'fail' ? 'fail' : check.status === 'warn' ? 'warn' : 'pass'}>{check.status}</TonePill>
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{check.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ProfilesView(props: {
  comparison?: UiProfileDetailData
  comparisonName?: string
  data?: ReturnType<typeof fetchProfiles> extends Promise<infer T> ? T : never
  loading: boolean
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to inspect its resolved config and services." title="Profiles unavailable" />
  }

  const selected = props.data.selected
  const diffLines = props.comparison
    ? buildProfileDiffPreview(selected.json, props.comparison.json)
    : []

  return (
    <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
      <Card title="Profile List">
        <div className="space-y-3">
          {props.data.profiles.map(profile => (
            <div className="profile-chip" data-active={profile.name === selected.name} key={profile.name}>
              <div>
                <div className="font-semibold text-[var(--text-strong)]">{profile.name}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{profile.kind}</div>
              </div>
              <TonePill tone={profile.readiness.tone}>{profile.readiness.detail}</TonePill>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-5">
        <Card title="Selected Profile">
          <div className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
            <div>
              <p className="control-kicker">{selected.kind}</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{selected.name}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                Network mappings: {selected.networkMappings.length > 0 ? selected.networkMappings.join(', ') : 'none'}
              </p>
              <div className="mt-5 grid gap-3">
                <div className="map-node-card">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">Validation</div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{selected.validation.detail}</p>
                </div>
                <div className="map-node-card">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">Auth</div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    {selected.auth.mode} • {selected.auth.source}
                  </p>
                </div>
                <div className="map-node-card">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">Imports</div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    LocalNet workspace: {selected.imports.localnet?.workspace ?? 'none'}
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">
                    Scan URL: {selected.imports.scan?.url ?? 'none'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {selected.services.map(service => (
                <div className="map-node-card" key={`${service.name}-${service.endpoint ?? service.detail}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{service.name}</div>
                    <TonePill tone={service.tone}>{service.status}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{service.detail}</p>
                  {service.endpoint ? <p className="mt-3 break-all text-xs text-[var(--signal)]">{service.endpoint}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <JsonPanel value={selected.json} />
          <details className="control-raw">
            <summary className="control-raw-summary">Resolved YAML</summary>
            <pre className="control-raw-body">{selected.yaml}</pre>
          </details>
        </div>
      </div>

      <Card title="Diff Panel">
        <div>
          <p className="control-kicker">Comparison</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--text-strong)]">
            {props.comparisonName ?? 'No adjacent profile'}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            Shows the first meaningful JSON differences between the selected profile and the adjacent environment profile.
          </p>
        </div>
        <div className="mt-5 space-y-3">
          {diffLines.length > 0 ? (
            diffLines.map(line => (
              <div className="map-node-card" key={line}>
                <p className="text-sm leading-6 text-[var(--text-muted)]">{line}</p>
              </div>
            ))
          ) : (
            <EmptyState body="No comparison profile is available, or the selected profile resolves to the same top-level shape." title="No deltas" />
          )}
        </div>
      </Card>
    </div>
  )
}

function SupportView(props: {
  data?: UiSupportData
  findings: UiMapFinding[]
  loading: boolean
}) {
  if (props.loading && !props.data) {
    return <SkeletonPanels />
  }

  if (!props.data) {
    return <EmptyState body="Select a profile to inspect support artifacts and defaults." title="Support unavailable" />
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <div className="space-y-5">
        <Card title="Diagnostics">
          <div className="map-node-card">
            <div className="text-sm font-semibold text-[var(--text-strong)]">Default output directory</div>
            <p className="mt-3 break-all text-sm text-[var(--signal)]">{props.data.defaults.diagnosticsOutputDir}</p>
          </div>
        </Card>

        <Card title="Discovery">
          <div className="map-node-card">
            <div className="text-sm font-semibold text-[var(--text-strong)]">Scan URL</div>
            <p className="mt-3 break-all text-sm text-[var(--text-muted)]">{props.data.defaults.scanUrl ?? 'No scan endpoint configured.'}</p>
          </div>
        </Card>

        <Card title="SDK Export">
          <div className="activity-grid">
            {props.data.defaults.exportTargets.map(target => (
              <div className="map-node-card" key={target}>
                <div className="text-sm font-semibold text-[var(--text-strong)]">{target}</div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">Available as a read-only export target for this profile.</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Current Signals">
        {props.findings.length > 0 ? (
          <div className="space-y-3">
            {props.findings.map(finding => (
              <div className="map-node-card" key={finding.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{finding.title}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{finding.source}</div>
                  </div>
                  <TonePill tone={finding.tone}>{finding.tone}</TonePill>
                </div>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{finding.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState body="No current map findings need support follow-up." title="No active signals" />
        )}
      </Card>
    </div>
  )
}

function MapCanvas(props: {
  data: UiMapData
  onSelectNode: (nodeId: string) => void
  overlays: UiMapOverlay[]
  selectedNodeId?: string
}) {
  switch (props.data.mode) {
    case 'canton-multi':
      return (
        <TopologyCanvas
          data={props.data}
          onSelectNode={props.onSelectNode}
          overlays={props.overlays}
          selectedNodeId={props.selectedNodeId}
        />
      )
    case 'sandbox':
      return (
        <SandboxCanvas
          data={props.data}
          onSelectNode={props.onSelectNode}
          overlays={props.overlays}
          selectedNodeId={props.selectedNodeId}
        />
      )
    case 'splice-localnet':
    case 'remote':
      return (
        <ServiceCanvas
          data={props.data}
          onSelectNode={props.onSelectNode}
          overlays={props.overlays}
          selectedNodeId={props.selectedNodeId}
        />
      )
  }
}

function SandboxCanvas(props: {
  data: UiMapData
  onSelectNode: (nodeId: string) => void
  overlays: UiMapOverlay[]
  selectedNodeId?: string
}) {
  const environmentNodes = props.data.nodes.filter(node => node.groupId === 'environment')
  const ledgerNode = props.data.nodes.find(node => node.id === 'ledger')

  return (
    <div className="canvas-layout canvas-layout-sandbox">
      <div className="canvas-column">
        {environmentNodes.map(node => (
          <MapNodeCard
            key={node.id}
            node={node}
            onSelectNode={props.onSelectNode}
            overlays={props.overlays}
            selected={node.id === props.selectedNodeId}
          />
        ))}
      </div>
      {ledgerNode ? (
        <div className="canvas-focus">
          <div className="edge-pair">
            <span>profile</span>
            <span>auth</span>
            <span>ledger</span>
          </div>
          <MapNodeCard
            node={ledgerNode}
            onSelectNode={props.onSelectNode}
            overlays={props.overlays}
            selected={ledgerNode.id === props.selectedNodeId}
          />
        </div>
      ) : null}
    </div>
  )
}

function TopologyCanvas(props: {
  data: UiMapData
  onSelectNode: (nodeId: string) => void
  overlays: UiMapOverlay[]
  selectedNodeId?: string
}) {
  const environmentNodes = props.data.nodes.filter(node => node.groupId === 'environment')
  const synchronizer = props.data.nodes.find(node => node.id === 'synchronizer')
  const participants = props.data.nodes.filter(node => node.kind === 'participant')

  return (
    <div className="canvas-layout canvas-layout-topology">
      <div className="canvas-column">
        {environmentNodes.map(node => (
          <MapNodeCard
            key={node.id}
            node={node}
            onSelectNode={props.onSelectNode}
            overlays={props.overlays}
            selected={node.id === props.selectedNodeId}
          />
        ))}
      </div>

      <div className="canvas-focus">
        {synchronizer ? (
          <div className="sync-stack">
            <MapNodeCard
              node={synchronizer}
              onSelectNode={props.onSelectNode}
              overlays={props.overlays}
              selected={synchronizer.id === props.selectedNodeId}
            />
            <div className="connector-row">
              {participants.map(participant => (
                <span className="connector-pill" key={participant.id}>sync</span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="participant-grid">
          {participants.map(node => (
            <MapNodeCard
              key={node.id}
              node={node}
              onSelectNode={props.onSelectNode}
              overlays={props.overlays}
              selected={node.id === props.selectedNodeId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ServiceCanvas(props: {
  data: UiMapData
  onSelectNode: (nodeId: string) => void
  overlays: UiMapOverlay[]
  selectedNodeId?: string
}) {
  const environmentNodes = props.data.nodes.filter(node => node.groupId === 'environment')
  const workspaceNodes = props.data.nodes.filter(node => node.kind === 'workspace')
  const serviceNodes = props.data.nodes
    .filter(node => node.kind === 'service' || node.kind === 'auth')
    .sort((left, right) => rankServiceNode(left.id) - rankServiceNode(right.id))

  return (
    <div className="canvas-layout canvas-layout-services">
      <div className="canvas-column">
        {environmentNodes.map(node => (
          <MapNodeCard
            key={node.id}
            node={node}
            onSelectNode={props.onSelectNode}
            overlays={props.overlays}
            selected={node.id === props.selectedNodeId}
          />
        ))}
        {workspaceNodes.map(node => (
          <MapNodeCard
            key={node.id}
            node={node}
            onSelectNode={props.onSelectNode}
            overlays={props.overlays}
            selected={node.id === props.selectedNodeId}
          />
        ))}
      </div>

      <div className="canvas-focus">
        <div className="service-grid">
          {serviceNodes.map(node => (
            <MapNodeCard
              key={node.id}
              node={node}
              onSelectNode={props.onSelectNode}
              overlays={props.overlays}
              selected={node.id === props.selectedNodeId}
            />
          ))}
        </div>
        <div className="edge-belt">
          {props.data.edges.map(edge => (
            <div className="edge-pill" key={`${edge.from}-${edge.to}-${edge.label ?? ''}`}>
              <span>{toNodeLabel(edge.from)}</span>
              <span>{edge.label ?? 'links to'}</span>
              <span>{toNodeLabel(edge.to)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MapNodeCard(props: {
  node: UiMapNode
  onSelectNode: (nodeId: string) => void
  overlays: UiMapOverlay[]
  selected: boolean
}) {
  const showAuth = props.overlays.includes('auth') && props.node.kind === 'auth'
  const showChecks = props.overlays.includes('checks') && (props.node.findingIds?.length ?? 0) > 0
  const showParties = props.overlays.includes('parties') && (props.node.parties?.length ?? 0) > 0
  const showPorts = props.overlays.includes('ports') && props.node.ports && Object.keys(props.node.ports).length > 0

  return (
    <button
      className="map-node-card"
      data-selected={props.selected}
      onClick={() => props.onSelectNode(props.node.id)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">{props.node.kind}</div>
          <div className="mt-2 text-lg font-semibold text-[var(--text-strong)]">{props.node.label}</div>
        </div>
        <TonePill tone={props.node.tone}>{props.node.status}</TonePill>
      </div>

      {props.node.detail ? <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">{props.node.detail}</p> : null}

      {props.node.badges?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {props.node.badges.map(badge => (
            <span className="badge-chip" key={badge}>{badge}</span>
          ))}
        </div>
      ) : null}

      {showChecks ? <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[var(--warn)]">{props.node.findingIds?.length} mapped findings</p> : null}
      {showAuth ? <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[var(--info)]">Auth surface</p> : null}

      {showParties ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {props.node.parties?.map(party => (
            <span className="party-chip" key={party}>{party}</span>
          ))}
        </div>
      ) : null}

      {showPorts ? (
        <div className="mt-4 grid gap-2 text-xs text-[var(--signal)]">
          {Object.entries(props.node.ports ?? {}).map(([key, value]) => (
            <div className="flex items-center justify-between gap-4" key={key}>
              <span className="uppercase tracking-[0.16em] text-[var(--text-soft)]">{key}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </button>
  )
}

function NodeInspector(props: {
  findings: UiMapFinding[]
  node?: UiMapNode
  onFocusFinding: (finding: UiMapFinding) => void
}) {
  const [tab, setTab] = useState<InspectorTab>('overview')

  if (!props.node) {
    return (
      <Card title="Inspector">
        <EmptyState body="Select a node on the map to inspect its posture, endpoints, and linked findings." title="No node selected" />
      </Card>
    )
  }

  const tabs: InspectorTab[] = ['overview', 'endpoints', 'checks', 'raw']

  return (
    <Card title="Inspector">
      <div className="space-y-5">
        <div>
          <p className="control-kicker">{props.node.kind}</p>
          <h3 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{props.node.label}</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{props.node.detail ?? 'No additional detail.'}</p>
        </div>

        <div className="tab-strip">
          {tabs.map(item => (
            <button
              className="overlay-chip"
              data-active={item === tab}
              key={item}
              onClick={() => setTab(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <div className="space-y-3">
            <div className="map-node-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Status</div>
                <TonePill tone={props.node.tone}>{props.node.status}</TonePill>
              </div>
            </div>
            {props.node.badges?.length ? (
              <div className="map-node-card">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Badges</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {props.node.badges.map(badge => <span className="badge-chip" key={badge}>{badge}</span>)}
                </div>
              </div>
            ) : null}
            {props.node.parties?.length ? (
              <div className="map-node-card">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Parties</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {props.node.parties.map(party => <span className="party-chip" key={party}>{party}</span>)}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'endpoints' ? (
          <div className="space-y-3">
            {props.node.url ? (
              <div className="map-node-card">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Endpoint</div>
                <p className="mt-3 break-all text-sm text-[var(--signal)]">{props.node.url}</p>
              </div>
            ) : null}
            {props.node.ports && Object.keys(props.node.ports).length > 0 ? (
              <div className="map-node-card">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Ports</div>
                <div className="mt-3 grid gap-2 text-sm text-[var(--text-muted)]">
                  {Object.entries(props.node.ports).map(([key, value]) => (
                    <div className="flex items-center justify-between gap-3" key={key}>
                      <span className="uppercase tracking-[0.16em] text-[var(--text-soft)]">{key}</span>
                      <span>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState body="This node does not expose a URL or port table." title="No endpoints" />
            )}
          </div>
        ) : null}

        {tab === 'checks' ? (
          <div className="space-y-3">
            {props.findings.length > 0 ? (
              props.findings.map(finding => (
                <button className="activity-card" key={finding.id} onClick={() => props.onFocusFinding(finding)} type="button">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text-strong)]">{finding.title}</div>
                    <TonePill tone={finding.tone}>{finding.tone}</TonePill>
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">{finding.detail}</p>
                </button>
              ))
            ) : (
              <EmptyState body="No findings are currently mapped onto this node." title="No findings" />
            )}
          </div>
        ) : null}

        {tab === 'raw' ? <JsonPanel value={props.node} /> : null}
      </div>
    </Card>
  )
}

function ChecksBucket(props: {
  findings: UiMapFinding[]
  onFocusFinding: (finding: UiMapFinding) => void
  title: string
  tone: UiTone
}) {
  return (
    <Card title={props.title} tone={props.tone}>
      {props.findings.length > 0 ? (
        <div className="space-y-3">
          {props.findings.map(finding => (
            <button className="activity-card" key={finding.id} onClick={() => props.onFocusFinding(finding)} type="button">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-strong)]">{finding.title}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{finding.source}</div>
                </div>
                <TonePill tone={finding.tone}>{finding.tone}</TonePill>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{finding.detail}</p>
              <p className="mt-3 text-xs text-[var(--signal)]">Locate on map: {finding.nodeIds.map(toNodeLabel).join(' • ')}</p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState body={`No ${props.title.toLowerCase()} findings are currently recorded.`} title={`No ${props.title.toLowerCase()}`} />
      )}
    </Card>
  )
}

function Metric(props: {label: string; tone?: UiTone; value: number}) {
  return (
    <div className="metric-card">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--text-soft)]">{props.label}</div>
      <div className={`mt-3 text-3xl font-semibold ${props.tone ? toneTextClass(props.tone) : 'text-[var(--text-strong)]'}`}>
        {props.value}
      </div>
    </div>
  )
}

function SkeletonPanels() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {[0, 1, 2, 3].map(index => (
        <div className="ui-card h-48 animate-pulse" key={index} />
      ))}
    </div>
  )
}

function collectPassedChecks(data: UiChecksData): Array<{detail: string; source: string; title: string}> {
  const passed: Array<{detail: string; source: string; title: string}> = []

  for (const check of data.compatibility.checks) {
    if (check.status === 'pass') {
      passed.push({detail: check.detail, source: 'compatibility', title: check.name})
    }
  }

  for (const check of data.preflight.checks) {
    if (check.status === 'pass') {
      passed.push({detail: check.detail, source: 'preflight', title: check.name})
    }
  }

  for (const check of data.canary.checks) {
    if (check.status === 'pass') {
      passed.push({detail: check.detail, source: 'canary', title: check.suite})
    }
  }

  return passed
}

function buildProfileDiffPreview(selected: Record<string, unknown>, comparison: Record<string, unknown>): string[] {
  return collectJsonDiff(selected, comparison).slice(0, 8)
}

function collectJsonDiff(
  selected: Record<string, unknown>,
  comparison: Record<string, unknown>,
  prefix = '',
): string[] {
  const keys = new Set([...Object.keys(selected), ...Object.keys(comparison)])
  const lines: string[] = []

  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    const left = selected[key]
    const right = comparison[key]

    if (JSON.stringify(left) === JSON.stringify(right)) continue

    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      lines.push(...collectJsonDiff(left as Record<string, unknown>, right as Record<string, unknown>, path))
      continue
    }

    lines.push(`${path}: ${formatJsonLeaf(left)} vs ${formatJsonLeaf(right)}`)
  }

  return lines
}

function defaultNodeSelection(data: UiMapData): string {
  return data.nodes.find(node => node.kind === 'participant')?.id
    ?? data.nodes.find(node => node.id === 'validator')?.id
    ?? data.nodes.find(node => node.id === 'ledger')?.id
    ?? data.nodes[0]?.id
    ?? 'profile'
}

function formatJsonLeaf(value: unknown): string {
  if (value === undefined) return 'unset'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function getComparisonProfileName(profiles: UiProfileSummary[], selectedProfile?: string): string | undefined {
  if (!selectedProfile) return undefined

  const index = profiles.findIndex(profile => profile.name === selectedProfile)
  if (index === -1) return undefined

  return profiles[index - 1]?.name ?? profiles[index + 1]?.name
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}

function mapSummaryTone(summary: UiMapData['summary']): UiTone {
  if (summary.readiness.failed > 0) return 'fail'
  if (summary.readiness.warned > 0) return 'warn'
  return 'pass'
}

function rankServiceNode(nodeId: string): number {
  const index = SERVICE_NODE_ORDER.indexOf(nodeId)
  return index === -1 ? SERVICE_NODE_ORDER.length + nodeId.length : index
}

function toNodeLabel(nodeId: string): string {
  if (nodeId.startsWith('participant:')) {
    return nodeId.replace('participant:', '')
  }
  if (nodeId === 'tokenStandard') return 'token standard'
  return nodeId
}

function toneTextClass(tone: UiTone): string {
  switch (tone) {
    case 'fail':
      return 'text-[var(--fail)]'
    case 'warn':
      return 'text-[var(--warn)]'
    case 'skip':
      return 'text-[var(--skip)]'
    case 'info':
      return 'text-[var(--info)]'
    case 'pass':
      return 'text-[var(--pass)]'
  }
}
