import type {
  ControlPlaneLifecycleOwner,
  ControlPlaneManagementClass,
  ControlPlaneMutationScope,
} from './control-plane.js'
import type {ControlPlaneStepOwner} from './control-plane-operation.js'
import type {ServiceName} from './config-profile.js'
import type {OutputWriter} from './output.js'
import type {PreflightCheck} from './preflight/output.js'
import type {ResolvedProfileRuntime} from './profile-runtime.js'
import type {
  RuntimeInventory,
  RuntimeInventoryCapability,
  RuntimeInventoryMode,
  RuntimeInventoryProfileSummary,
  RuntimeInventoryService,
} from './runtime-inventory.js'

export type ControlPlaneDriftCode =
  | 'auth-mismatch'
  | 'endpoint-mismatch'
  | 'managed-surface-mismatch'
  | 'operator-surface-unmanaged'
  | 'profile-kind-mismatch'
  | 'service-missing'
  | 'service-unreachable'
  | 'upstream-line-mismatch'

export type ControlPlaneDriftSeverity = 'fail' | 'info' | 'warn'
export type ControlPlaneDriftResolution = 'manual-runbook' | 'supported-action'
export type ControlPlaneDriftSource = 'auth' | 'compatibility' | 'health' | 'inventory'

export interface ControlPlaneDriftBoundary {
  lifecycleOwner?: ControlPlaneLifecycleOwner
  managementClass?: ControlPlaneManagementClass
  mutationScope?: ControlPlaneMutationScope
  owner: ControlPlaneStepOwner
  resolution: ControlPlaneDriftResolution
}

export interface ControlPlaneDriftItem {
  boundary: ControlPlaneDriftBoundary
  code: ControlPlaneDriftCode
  detail: string
  expected?: string
  observed?: string
  severity: ControlPlaneDriftSeverity
  source: ControlPlaneDriftSource
  target?: string
}

export interface ControlPlaneReconcileAction {
  code: string
  command?: string
  detail: string
  owner: ControlPlaneStepOwner
  targets: string[]
  title: string
}

export interface ControlPlaneDriftSummary {
  failed: number
  info: number
  manualRunbooks: number
  supportedActions: number
  warned: number
}

export interface ControlPlaneDriftReconcilePlan {
  runbook: ControlPlaneReconcileAction[]
  summary: ControlPlaneDriftSummary
  supportedActions: ControlPlaneReconcileAction[]
}

export interface ControlPlaneDriftReport {
  items: ControlPlaneDriftItem[]
  reconcile: ControlPlaneDriftReconcilePlan
  summary: ControlPlaneDriftSummary
}

type RuntimeLike = Pick<
ResolvedProfileRuntime,
'auth' | 'compatibility' | 'credential' | 'networkName' | 'operatorCredential' | 'profile'
>

const SERVICE_RELATED_CODES = new Set<ControlPlaneDriftCode>([
  'endpoint-mismatch',
  'service-missing',
  'service-unreachable',
])

export function createControlPlaneDriftReport(options: {
  checks?: readonly PreflightCheck[]
  inventory: RuntimeInventory
  runtime?: RuntimeLike
}): ControlPlaneDriftReport {
  const servicesByName = new Map<ServiceName, RuntimeInventoryService>(
    options.inventory.services.map(service => [service.name, service]),
  )
  const capabilitiesByName = new Map<string, RuntimeInventoryCapability>(
    options.inventory.capabilities.map(capability => [String(capability.name), capability]),
  )
  const items = dedupeDriftItems([
    ...createInventoryDriftItems(options.inventory, options.runtime, servicesByName, capabilitiesByName),
    ...createServiceHealthDriftItems(options.inventory, options.runtime, servicesByName),
    ...createRuntimeDriftItems(options.inventory, options.runtime),
    ...createPreflightDriftItems(options.checks, options.inventory, options.runtime, servicesByName),
  ])
  const boundaryItems = createBoundaryMismatchItems(items, options.inventory, options.runtime, servicesByName)
  const finalItems = dedupeDriftItems([...items, ...boundaryItems])
  const reconcile = buildReconcilePlan(finalItems, options.inventory, options.runtime, servicesByName)

  return {
    items: finalItems,
    reconcile,
    summary: reconcile.summary,
  }
}

export function renderControlPlaneDriftReport(
  out: Pick<OutputWriter, 'log' | 'table'>,
  report: Pick<ControlPlaneDriftReport, 'items' | 'reconcile'>,
): void {
  if (report.items.length === 0) {
    return
  }

  out.log('')
  out.table(
    ['Drift', 'Severity', 'Owner', 'Resolution', 'Detail'],
    report.items.map(item => [
      item.target ? `${item.target}: ${item.code}` : item.code,
      item.severity,
      item.boundary.owner,
      item.boundary.resolution,
      item.detail,
    ]),
  )

  const reconcileRows = [
    ...report.reconcile.supportedActions.map(action => [
      action.title,
      action.owner,
      action.command ?? '-',
      action.detail,
    ]),
    ...report.reconcile.runbook.map(action => [
      action.title,
      action.owner,
      action.command ?? '-',
      action.detail,
    ]),
  ]

  if (reconcileRows.length === 0) {
    return
  }

  out.log('')
  out.table(
    ['Reconcile', 'Owner', 'Command', 'Detail'],
    reconcileRows,
  )
}

function createInventoryDriftItems(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
  capabilitiesByName: Map<string, RuntimeInventoryCapability>,
): ControlPlaneDriftItem[] {
  return inventory.drift.map((hint) => {
    const service = hint.capability ? servicesByName.get(hint.capability as ServiceName) : undefined
    const capability = !service && hint.capability ? capabilitiesByName.get(String(hint.capability)) : undefined

    return {
      boundary: createBoundaryForInventoryHint(hint.code, inventory, runtime, service, capability),
      code: hint.code,
      detail: hint.detail,
      expected: hint.expected,
      observed: hint.observed,
      severity: 'warn',
      source: 'inventory',
      target: hint.capability ? String(hint.capability) : undefined,
    }
  })
}

function createServiceHealthDriftItems(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneDriftItem[] {
  const items: ControlPlaneDriftItem[] = []

  for (const service of servicesByName.values()) {
    if (service.health.status !== 'unreachable') {
      continue
    }

    items.push({
      boundary: createBoundaryForService('service-unreachable', inventory, runtime, service),
      code: 'service-unreachable',
      detail: `${formatServiceLabel(service.name)} is unreachable${service.endpoint ? ` at ${service.endpoint}` : ''}.`,
      expected: 'healthy',
      observed: 'unreachable',
      severity: resolveServiceDriftSeverity(inventory, runtime, service),
      source: 'inventory',
      target: service.name,
    })
  }

  return items
}

function createRuntimeDriftItems(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
): ControlPlaneDriftItem[] {
  if (!runtime) {
    return []
  }

  const items: ControlPlaneDriftItem[] = []

  if (runtime.auth.app.required && runtime.credential.source === 'missing') {
    items.push({
      boundary: {owner: 'cantonctl', resolution: 'supported-action'},
      code: 'auth-mismatch',
      detail:
        `No application credential is available for ${runtime.networkName}. ` +
        `Provide ${runtime.auth.app.envVarName} or store a credential with cantonctl auth login.`,
      severity: 'fail',
      source: 'auth',
      target: 'app-auth',
    })
  }

  if (runtime.auth.operator.required && runtime.operatorCredential.source === 'missing') {
    items.push({
      boundary: {owner: 'cantonctl', resolution: 'supported-action'},
      code: 'auth-mismatch',
      detail:
        `No operator credential is available for ${runtime.networkName}. ` +
        `Provide ${runtime.auth.operator.envVarName} or store a credential with cantonctl auth login ${runtime.networkName} --scope operator.`,
      severity: 'fail',
      source: 'auth',
      target: 'operator-auth',
    })
  }

  if (runtime.compatibility.failed > 0 || runtime.compatibility.warned > 0) {
    items.push({
      boundary: {owner: 'official-stack', resolution: 'manual-runbook'},
      code: 'upstream-line-mismatch',
      detail: runtime.compatibility.failed > 0
        ? `${runtime.compatibility.failed} compatibility check(s) failed against the pinned stable/public baseline.`
        : `Compatibility drifted from the pinned stable/public baseline with ${runtime.compatibility.warned} warning(s).`,
      expected: 'pinned stable/public baseline',
      observed: runtime.compatibility.failed > 0 ? 'failed' : 'warned',
      severity: runtime.compatibility.failed > 0 ? 'fail' : 'warn',
      source: 'compatibility',
      target: 'compatibility',
    })
  } else if (runtime.profile.kind === 'splice-localnet' && !runtime.profile.services.localnet?.version) {
    items.push({
      boundary: {owner: 'official-stack', resolution: 'manual-runbook'},
      code: 'upstream-line-mismatch',
      detail: 'The splice-localnet profile does not pin a LocalNet version line.',
      severity: 'warn',
      source: 'compatibility',
      target: 'localnet-version',
    })
  }

  return items
}

function createPreflightDriftItems(
  checks: readonly PreflightCheck[] | undefined,
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneDriftItem[] {
  if (!checks) {
    return []
  }

  const items: ControlPlaneDriftItem[] = []

  for (const check of checks) {
    const service = resolveServiceFromCheck(check.name, servicesByName)
    const detail = check.detail.toLowerCase()

    if (check.name === 'Scan reachability' && check.status === 'fail') {
      if (detail.includes('required for the default preflight path')) {
        const scanService = servicesByName.get('scan')
        items.push({
          boundary: scanService
            ? createBoundaryForService('service-missing', inventory, runtime, scanService)
            : {owner: 'official-stack', resolution: 'manual-runbook'},
          code: 'service-missing',
          detail: check.detail,
          expected: 'configured stable/public scan endpoint',
          observed: 'missing',
          severity: 'fail',
          source: 'health',
          target: 'scan',
        })
        continue
      }

      if (service) {
        items.push({
          boundary: createBoundaryForService('service-unreachable', inventory, runtime, service),
          code: 'service-unreachable',
          detail: check.detail,
          expected: 'healthy',
          observed: 'unreachable',
          severity: resolveServiceDriftSeverity(inventory, runtime, service),
          source: 'health',
          target: service.name,
        })
      }
      continue
    }

    if (check.category !== 'health' || !service || check.status === 'pass' || check.status === 'skip') {
      continue
    }

    if (detail.includes('requires auth')) {
      items.push({
        boundary: createBoundaryForService('service-unreachable', inventory, runtime, service),
        code: 'auth-mismatch',
        detail: `${formatServiceLabel(service.name)} health checks require auth that does not match the current runtime access.`,
        expected: 'authorized health access',
        observed: 'auth required',
        severity: 'warn',
        source: 'health',
        target: `${service.name}-auth`,
      })
      continue
    }

    if (detail.includes('endpoint not exposed')) {
      continue
    }

    items.push({
      boundary: createBoundaryForService('service-unreachable', inventory, runtime, service),
      code: 'service-unreachable',
      detail: `${formatServiceLabel(service.name)} health check degraded: ${check.detail}`,
      expected: 'healthy',
      observed: 'unreachable',
      severity: resolveServiceDriftSeverity(inventory, runtime, service),
      source: 'health',
      target: service.name,
    })
  }

  return items
}

function createBoundaryMismatchItems(
  items: ControlPlaneDriftItem[],
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneDriftItem[] {
  const derived: ControlPlaneDriftItem[] = []

  for (const item of items) {
    if (!item.target || !SERVICE_RELATED_CODES.has(item.code)) {
      continue
    }

    const service = servicesByName.get(item.target as ServiceName)
    if (!service || service.controlPlane.managementClass === 'apply-capable') {
      continue
    }

    derived.push({
      boundary: createBoundaryForService('managed-surface-mismatch', inventory, runtime, service),
      code: 'managed-surface-mismatch',
      detail:
        `${formatServiceLabel(service.name)} drift was observed on a ${service.controlPlane.managementClass} ` +
        'surface that is not currently apply-capable.',
      expected: 'apply-capable management surface',
      observed: service.controlPlane.managementClass,
      severity: 'warn',
      source: item.source,
      target: service.name,
    })

    if (service.controlPlane.operatorSurface || service.stability === 'operator-only') {
      derived.push({
        boundary: createBoundaryForService('operator-surface-unmanaged', inventory, runtime, service),
        code: 'operator-surface-unmanaged',
        detail:
          `${formatServiceLabel(service.name)} is backed by an operator-only surface and must stay behind explicit operator runbooks.`,
        expected: 'approved operator management surface',
        observed: service.stability,
        severity: 'warn',
        source: item.source,
        target: service.name,
      })
    }
  }

  return derived
}

function createBoundaryForInventoryHint(
  code: 'endpoint-mismatch' | 'profile-kind-mismatch',
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  service: RuntimeInventoryService | undefined,
  capability: RuntimeInventoryCapability | undefined,
): ControlPlaneDriftBoundary {
  if (service) {
    return createBoundaryForService(code, inventory, runtime, service)
  }

  if (capability) {
    return {
      lifecycleOwner: capability.controlPlane.lifecycleOwner,
      managementClass: capability.controlPlane.managementClass,
      mutationScope: capability.controlPlane.mutationScope,
      owner: capability.controlPlane.operatorSurface ? 'operator' : 'official-stack',
      resolution: 'manual-runbook',
    }
  }

  return {owner: 'official-stack', resolution: 'manual-runbook'}
}

function createBoundaryForService(
  code: ControlPlaneDriftCode,
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  service: RuntimeInventoryService,
): ControlPlaneDriftBoundary {
  const resolution = resolveServiceResolution(code, inventory, runtime, service)

  return {
    lifecycleOwner: service.controlPlane.lifecycleOwner,
    managementClass: service.controlPlane.managementClass,
    mutationScope: service.controlPlane.mutationScope,
    owner: resolveServiceOwner(service, resolution),
    resolution,
  }
}

function resolveServiceResolution(
  code: ControlPlaneDriftCode,
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  service: RuntimeInventoryService,
): ControlPlaneDriftResolution {
  if (
    (code === 'service-unreachable' || code === 'service-missing')
    && service.controlPlane.managementClass === 'apply-capable'
    && hasSupportedLocalRuntimeAction(inventory, runtime)
  ) {
    return 'supported-action'
  }

  return 'manual-runbook'
}

function resolveServiceOwner(
  service: RuntimeInventoryService,
  resolution: ControlPlaneDriftResolution,
): ControlPlaneStepOwner {
  if (resolution === 'supported-action') {
    return 'cantonctl'
  }

  if (service.controlPlane.operatorSurface || service.stability === 'operator-only') {
    return 'operator'
  }

  return service.controlPlane.lifecycleOwner === 'official-remote-runtime' ? 'official-stack' : 'cantonctl'
}

function resolveServiceDriftSeverity(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  service: RuntimeInventoryService,
): ControlPlaneDriftSeverity {
  if (
    service.controlPlane.managementClass === 'apply-capable'
    && hasSupportedLocalRuntimeAction(inventory, runtime)
  ) {
    return 'fail'
  }

  return 'warn'
}

function resolveServiceFromCheck(
  name: string,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): RuntimeInventoryService | undefined {
  const normalized = name.toLowerCase()

  if (normalized.startsWith('auth ')) return servicesByName.get('auth')
  if (normalized.startsWith('ledger ')) return servicesByName.get('ledger')
  if (normalized.startsWith('scan ')) return servicesByName.get('scan')
  if (normalized.startsWith('validator ')) return servicesByName.get('validator')

  return undefined
}

function buildReconcilePlan(
  items: ControlPlaneDriftItem[],
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneDriftReconcilePlan {
  const supportedActions = dedupeActions(items.flatMap(item => createActionForItem(item, inventory, runtime, servicesByName)))
  const runbook = dedupeActions(items.flatMap(item => createRunbookForItem(item, inventory, runtime, servicesByName)))
  const summary = {
    failed: items.filter(item => item.severity === 'fail').length,
    info: items.filter(item => item.severity === 'info').length,
    manualRunbooks: runbook.length,
    supportedActions: supportedActions.length,
    warned: items.filter(item => item.severity === 'warn').length,
  }

  return {
    runbook,
    summary,
    supportedActions,
  }
}

function createActionForItem(
  item: ControlPlaneDriftItem,
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneReconcileAction[] {
  if (item.code === 'auth-mismatch') {
    const networkName = runtime?.networkName ?? inventory.network ?? inventory.profile?.name
    if (!networkName) {
      return []
    }

    if (item.target === 'app-auth') {
      return [{
        code: 'resolve-app-auth',
        command: `cantonctl auth login ${networkName}`,
        detail: `Resolve the application credential path for ${networkName}.`,
        owner: 'cantonctl',
        targets: [item.target],
        title: 'Resolve app credentials',
      }]
    }

    if (item.target === 'operator-auth') {
      return [{
        code: 'resolve-operator-auth',
        command: `cantonctl auth login ${networkName} --scope operator`,
        detail: `Resolve the operator credential path for ${networkName}.`,
        owner: 'cantonctl',
        targets: [item.target],
        title: 'Resolve operator credentials',
      }]
    }

    return []
  }

  if (
    item.boundary.resolution !== 'supported-action'
    || (item.code !== 'service-missing' && item.code !== 'service-unreachable')
  ) {
    return []
  }

  const target = item.target as string
  const command = resolveLocalRuntimeCommand(inventory, runtime)
  if (command.code === 'start-localnet-workspace') {
    return [{
      code: command.code,
      command: command.command,
      detail: command.detail,
      owner: 'cantonctl',
      targets: [target],
      title: 'Start LocalNet workspace',
    }]
  }

  const title = command.code === 'start-multi-node-runtime'
    ? 'Start local Docker topology'
    : 'Start local sandbox runtime'

  return [{
    code: command.code,
    command: command.command,
    detail: command.detail,
    owner: 'cantonctl',
    targets: [target],
    title,
  }]
}

function createRunbookForItem(
  item: ControlPlaneDriftItem,
  _inventory: RuntimeInventory,
  _runtime: RuntimeLike | undefined,
  servicesByName: Map<ServiceName, RuntimeInventoryService>,
): ControlPlaneReconcileAction[] {
  if (item.code === 'upstream-line-mismatch') {
    return [{
      code: 'align-upstream-line',
      detail: 'Re-pin the project and runtime inputs to the manifest-backed upstream line before mutating commands.',
      owner: 'official-stack',
      targets: [item.target as string],
      title: 'Align project and runtime versions',
    }]
  }

  if (item.code === 'endpoint-mismatch' || item.code === 'profile-kind-mismatch') {
    return [{
      code: item.code === 'endpoint-mismatch' ? 'review-profile-endpoints' : 'review-runtime-target',
      detail: item.code === 'endpoint-mismatch'
        ? 'Align the resolved profile endpoints with the observed runtime before mutating commands.'
        : 'Select a runtime that matches the resolved profile kind before mutating commands.',
      owner: item.boundary.owner,
      targets: item.target ? [item.target] : [],
      title: item.code === 'endpoint-mismatch' ? 'Review profile endpoints' : 'Review runtime target',
    }]
  }

  if (
    item.boundary.resolution !== 'manual-runbook'
    || (
      item.code !== 'managed-surface-mismatch'
      && item.code !== 'operator-surface-unmanaged'
      && item.code !== 'service-missing'
      && item.code !== 'service-unreachable'
    )
  ) {
    return []
  }

  const service = servicesByName.get(item.target as ServiceName)
  if (!service) {
    return []
  }

  if (item.code === 'managed-surface-mismatch' || item.code === 'operator-surface-unmanaged') {
    return [{
      code: service.controlPlane.operatorSurface || service.stability === 'operator-only'
        ? `operator-runbook-${service.name}`
        : `official-runbook-${service.name}`,
      detail: service.controlPlane.operatorSurface || service.stability === 'operator-only'
        ? `Follow the upstream operator workflow for ${service.name}; cantonctl does not expose an apply-capable surface for it.`
        : `Reconcile ${service.name} through the upstream runtime workflow; cantonctl only observes this surface today.`,
      owner: item.boundary.owner,
      targets: [service.name],
      title: service.controlPlane.operatorSurface || service.stability === 'operator-only'
        ? `Use operator runbook for ${service.name}`
        : `Use upstream runbook for ${service.name}`,
    }]
  }

  return [{
    code: service.controlPlane.operatorSurface || service.stability === 'operator-only'
      ? `operator-runbook-${service.name}`
      : `official-runbook-${service.name}`,
    detail: service.controlPlane.operatorSurface || service.stability === 'operator-only'
      ? `Follow the upstream operator workflow for ${service.name}; the current control-plane boundary does not permit direct reconcile.`
      : `Reconcile ${service.name} with the upstream runtime owner or update the profile so the observed runtime matches intent.`,
    owner: item.boundary.owner,
    targets: [service.name],
    title: service.controlPlane.operatorSurface || service.stability === 'operator-only'
      ? `Use operator runbook for ${service.name}`
      : `Use upstream runbook for ${service.name}`,
  }]
}

function resolveLocalRuntimeCommand(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
): {code: string; command: string; detail: string} {
  const profile = runtime?.profile ?? inventory.profile

  if (inventory.mode === 'sandbox' || profile?.kind === 'sandbox') {
    return {
      code: 'start-sandbox-runtime',
      command: 'cantonctl dev',
      detail: 'Start the companion-managed sandbox runtime to restore local apply-capable services.',
    }
  }

  if (inventory.mode === 'multi-node' || profile?.kind === 'canton-multi') {
    return {
      code: 'start-multi-node-runtime',
      command: 'cantonctl dev --net',
      detail: 'Start the generated local Canton topology to restore local apply-capable services.',
    }
  }

  const localnetProfile = profile?.name ?? inventory.profile?.name
  return {
    code: 'start-localnet-workspace',
    command: `cantonctl localnet up --workspace ${inventory.workspace as string}${localnetProfile ? ` --profile ${localnetProfile}` : ''}`,
    detail: 'Restart the official LocalNet workspace through the companion wrapper.',
  }
}

function hasSupportedLocalRuntimeAction(
  inventory: RuntimeInventory,
  runtime: RuntimeLike | undefined,
): boolean {
  const profileKind = runtime?.profile.kind ?? inventory.profile?.kind

  if (profileKind === 'sandbox' || profileKind === 'canton-multi') {
    return true
  }

  if (profileKind === 'splice-localnet') {
    return Boolean(inventory.workspace)
  }

  if (inventory.mode === 'sandbox' || inventory.mode === 'multi-node') {
    return true
  }

  return inventory.mode === 'localnet-workspace' && Boolean(inventory.workspace)
}

function dedupeDriftItems(items: ControlPlaneDriftItem[]): ControlPlaneDriftItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [
      item.code,
      item.target,
      item.detail,
      item.expected,
      item.observed,
      item.severity,
      item.source,
      item.boundary.owner,
      item.boundary.resolution,
      item.boundary.lifecycleOwner,
      item.boundary.managementClass,
      item.boundary.mutationScope,
    ].join('|')

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function dedupeActions(actions: ControlPlaneReconcileAction[]): ControlPlaneReconcileAction[] {
  const seen = new Map<string, ControlPlaneReconcileAction>()

  for (const action of actions) {
    const key = [action.code, action.command, action.owner, action.title].join('|')
    const existing = seen.get(key)

    if (!existing) {
      seen.set(key, action)
      continue
    }

    seen.set(key, {
      ...existing,
      targets: Array.from(new Set([...existing.targets, ...action.targets])).sort(),
    })
  }

  return [...seen.values()]
}

function formatServiceLabel(name: ServiceName): string {
  switch (name) {
    case 'ans':
      return 'ANS'
    case 'auth':
      return 'Auth'
    case 'ledger':
      return 'Ledger'
    case 'localnet':
      return 'LocalNet workspace'
    case 'scan':
      return 'Scan'
    case 'scanProxy':
      return 'Scan proxy'
    case 'tokenStandard':
      return 'Token Standard'
    case 'validator':
      return 'Validator'
  }
}
