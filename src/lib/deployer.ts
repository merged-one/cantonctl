/**
 * @module deployer
 *
 * Profile-first DAR rollout orchestration for ledger-capable targets.
 * Uses the shared control-plane operation engine so plan, dry-run, local
 * fan-out, and remote single-target deploys share one JSON contract.
 */

import * as path from 'node:path'

import type {CantonctlConfig} from './config.js'
import type {ControlPlaneManagementClass} from './control-plane.js'
import {
  createControlPlaneOperationRunner,
  type ControlPlaneOperationMode,
  type ControlPlaneOperationResult,
  type ControlPlanePostcondition,
  type ControlPlaneStep,
  type ControlPlaneStepStatus,
} from './control-plane-operation.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {LedgerClient, LedgerClientOptions} from './ledger-client.js'
import type {PluginHookManager} from './plugin-hooks.js'
import {
  createProfileRuntimeResolver,
  type ResolvedProfileRuntime,
} from './profile-runtime.js'
import {findDarFile as defaultFindDarFile} from './runtime-support.js'
import type {GeneratedTopology} from './topology.js'

const DIST_DIR = '.daml/dist'

type DeployArtifactSource = 'auto-detected' | 'explicit'
type DeployFanOutMode = 'fan-out' | 'single-target'
type DeployTargetEndpointSource = 'generated-topology' | 'profile-ledger'

export interface DeployerDeps {
  /** Resolved cantonctl config. */
  config: CantonctlConfig
  /** Factory to create a LedgerClient for the target endpoint. */
  createLedgerClient: (opts: LedgerClientOptions) => LedgerClient
  /** Factory to resolve profile runtime metadata and credentials. */
  createProfileRuntimeResolver?: typeof createProfileRuntimeResolver
  /** Token generator for local fallback credentials. */
  createToken: (opts: {actAs: string[]; admin: boolean; applicationId: string; readAs: string[]}) => Promise<string>
  /** Optional topology detector for local canton-multi fan-out. */
  detectTopology?: (projectDir: string) => Promise<GeneratedTopology | null>
  /** Filesystem abstraction for reading DAR files. */
  fs: {readFile: (filePath: string) => Promise<Uint8Array>}
  /** Optional DAR detector for built artifacts under `.daml/dist`. */
  findDarFile?: typeof defaultFindDarFile
  /** Plugin hook manager for lifecycle events. */
  hooks?: PluginHookManager
}

export interface DeployOptions {
  /** Explicit path to a built `.dar` file. */
  darPath?: string
  /** Backwards-compatible shorthand for `mode: "dry-run"`. */
  dryRun?: boolean
  /** Operation mode. Defaults to apply. */
  mode?: ControlPlaneOperationMode
  /** Override deploying party for local fallback tokens. */
  party?: string
  /** Explicit profile name. */
  profileName?: string
  /** Project directory used for `.daml/dist` lookup and topology detection. */
  projectDir?: string
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
  /** Legacy target alias or profile name. */
  target?: string
}

export interface DeployArtifactSummary {
  darPath: string | null
  sizeBytes?: number
  source: DeployArtifactSource
}

export interface DeployFanOutDecision {
  mode: DeployFanOutMode
  participantCount: number
  source: DeployTargetEndpointSource
}

export interface DeployTargetResult {
  baseUrl?: string
  endpointSource: DeployTargetEndpointSource
  id: string
  label: string
  managementClass: ControlPlaneManagementClass
  packageId: string | null
  participant?: string
  postDeployChecks: ControlPlanePostcondition[]
  status: ControlPlaneStepStatus
}

export interface DeployResult extends ControlPlaneOperationResult {
  artifact: DeployArtifactSummary
  auth: {
    envVarName: string
    mode: string
    scope: 'operator'
    source: ResolvedProfileRuntime['credential']['source']
  }
  fanOut: DeployFanOutDecision
  profile: {
    kind: ResolvedProfileRuntime['profile']['kind']
    name: string
    network: string
  }
  requestedTarget?: string
  targets: DeployTargetResult[]
}

export interface Deployer {
  deploy(options: DeployOptions): Promise<DeployResult>
}

interface DeployArtifactState extends DeployArtifactSummary {
  darPath: string
  darBytes: Uint8Array
}

type PlanArtifactResolution =
  | {artifact: DeployArtifactState}
  | {error: CantonctlError}

interface DeployTargetContext {
  baseUrl?: string
  endpointSource: DeployTargetEndpointSource
  id: string
  label: string
  managementClass: ControlPlaneManagementClass
  participant?: string
}

interface DeployTargetState {
  client?: LedgerClient
  durationMs?: number
  packageId?: string
  startedAt?: number
}

interface DeployState {
  artifact?: DeployArtifactState
  targets: Record<string, DeployTargetState>
}

export function createDeployer(deps: DeployerDeps): Deployer {
  const detectTopology = deps.detectTopology ?? (async () => null)
  const findDarFile = deps.findDarFile ?? defaultFindDarFile
  const createRuntimeResolver = deps.createProfileRuntimeResolver ?? createProfileRuntimeResolver

  return {
    async deploy(options: DeployOptions): Promise<DeployResult> {
      const projectDir = options.projectDir ?? process.cwd()
      const requestedTarget = options.profileName ?? options.target
      const mode = resolveDeployMode(options)
      const runtime = await createRuntimeResolver({
        createFallbackToken: async (config) => deps.createToken(createTokenOptions(config, options.party)),
      }).resolve({
        config: deps.config,
        profileName: resolveRequestedProfileName(deps.config, requestedTarget),
      })

      const fanOut = await resolveDeployFanOut({
        detectTopology,
        projectDir,
        runtime,
      })
      const targets = fanOut.targets
      const planArtifactResolution = mode === 'plan'
        ? await resolvePlanArtifact({
          darPath: options.darPath,
          findDarFile,
          fs: deps.fs,
          projectDir,
        })
        : undefined
      let deployState: DeployState | undefined

      const runner = createControlPlaneOperationRunner<DeployOptions, DeployState>({
        createState() {
          deployState = {
            artifact: planArtifactResolution && 'artifact' in planArtifactResolution
              ? planArtifactResolution.artifact
              : undefined,
            targets: Object.fromEntries(targets.map(target => [target.id, {}])),
          }
          return deployState
        },
        description:
          'Profile-first DAR rollout for ledger-capable targets. The command consumes built DAR artifacts and wraps official runtime endpoints without taking over runtime provisioning.',
        operation: 'deploy',
        steps: [
          createArtifactStep({deps, findDarFile, projectDir}),
          ...targets.flatMap(target => createTargetSteps({deps, options, projectDir, runtime, target})),
        ],
      })

      const operation = mode === 'plan'
        ? await runner.plan({input: options, signal: options.signal})
        : mode === 'dry-run'
          ? await runner.dryRun({input: options, signal: options.signal})
          : await runner.apply({input: options, signal: options.signal})
      const finalOperation = mode === 'plan'
        ? applyPlanArtifactResolution(operation, planArtifactResolution!)
        : operation

      return {
        ...finalOperation,
        artifact: {
          darPath: deployState?.artifact?.darPath ?? null,
          sizeBytes: deployState?.artifact?.sizeBytes,
          source: deployState?.artifact?.source ?? (options.darPath ? 'explicit' : 'auto-detected'),
        },
        auth: {
          envVarName: runtime.auth.operator.envVarName,
          mode: runtime.auth.mode,
          scope: 'operator',
          source: runtime.operatorCredential.source,
        },
        fanOut: {
          mode: fanOut.mode,
          participantCount: targets.length,
          source: fanOut.source,
        },
        profile: {
          kind: runtime.profile.kind,
          name: runtime.profile.name,
          network: runtime.networkName,
        },
        requestedTarget,
        targets: targets.map(target => summarizeTarget(finalOperation, deployState!, target)),
      }
    },
  }
}

function createArtifactStep(options: {
  deps: DeployerDeps
  findDarFile: typeof defaultFindDarFile
  projectDir: string
}): ControlPlaneStep<DeployOptions, DeployState> {
  return {
    effect: 'read',
    id: 'resolve-dar',
    run: async ({input, state}) => {
      const artifact = await resolveArtifact({
        darPath: input.darPath,
        findDarFile: options.findDarFile,
        fs: options.deps.fs,
        projectDir: options.projectDir,
      })
      state.artifact = artifact

      return {
        checkpoint: {darPath: artifact.darPath, source: artifact.source},
        data: {
          darPath: artifact.darPath,
          sizeBytes: artifact.sizeBytes,
          source: artifact.source,
        },
        detail:
          artifact.source === 'explicit'
            ? `Using explicit DAR artifact ${artifact.darPath}. Build and codegen remain owned by DPM.`
            : `Using built DAR artifact ${artifact.darPath} from ${path.join(options.projectDir, DIST_DIR)}.`,
      }
    },
    title: 'Resolve DAR artifact',
  }
}

function createTargetSteps(options: {
  deps: DeployerDeps
  options: DeployOptions
  projectDir: string
  runtime: ResolvedProfileRuntime
  target: DeployTargetContext
}): Array<ControlPlaneStep<DeployOptions, DeployState>> {
  const preflightId = `preflight-${options.target.id}`
  const uploadId = `upload-${options.target.id}`
  const verifyId = `verify-${options.target.id}`

  return [
    {
      dependsOn: ['resolve-dar'],
      effect: 'read',
      id: preflightId,
      preconditions: () => buildTargetPreconditions(options.runtime, options.target),
      run: async ({mode, signal, state}) => {
        const artifact = state.artifact!
        const token = options.runtime.operatorCredential.token!

        const client = options.deps.createLedgerClient({
          baseUrl: options.target.baseUrl!,
          token,
        })
        state.targets[options.target.id] = {
          ...state.targets[options.target.id],
          client,
          startedAt: Date.now(),
        }

        await options.deps.hooks?.emit('beforeDeploy', {
          darPath: artifact.darPath,
          dryRun: mode === 'dry-run',
          network: options.runtime.networkName,
          participant: options.target.participant,
          profile: options.runtime.profile.name,
          projectDir: options.projectDir,
          target: options.target.label,
        })

        try {
          await client.getVersion(signal)
        } catch (error) {
          if (error instanceof CantonctlError && error.code === ErrorCode.LEDGER_CONNECTION_FAILED) {
            throw new CantonctlError(ErrorCode.DEPLOY_NETWORK_UNREACHABLE, {
              cause: error,
              context: {
                baseUrl: options.target.baseUrl,
                network: options.runtime.networkName,
                profile: options.runtime.profile.name,
                target: options.target.label,
              },
              suggestion:
                options.runtime.profile.kind === 'sandbox' || options.runtime.profile.kind === 'canton-multi'
                  ? `Cannot reach ${options.target.label} at ${options.target.baseUrl}. Start the local runtime before deploying.`
                  : `Cannot reach ${options.target.label} at ${options.target.baseUrl}. Confirm the remote ledger endpoint and auth material.`,
            })
          }

          throw error
        }

        return {
          checkpoint: {baseUrl: options.target.baseUrl, targetId: options.target.id},
          data: {
            baseUrl: options.target.baseUrl,
            endpointSource: options.target.endpointSource,
            target: options.target.label,
          },
          detail: `Validated ledger reachability for ${options.target.label} at ${options.target.baseUrl}.`,
        }
      },
      title: `Preflight ${options.target.label}`,
      warnings: () => buildTargetWarnings(options.runtime, options.target),
    },
    {
      dependsOn: [preflightId],
      effect: 'write',
      id: uploadId,
      run: async ({signal, state}) => {
        const artifact = state.artifact!
        const targetState = state.targets[options.target.id]!
        const client = targetState.client!

        try {
          const uploadResult = await client.uploadDar(artifact.darBytes, signal)
          state.targets[options.target.id] = {
            ...targetState,
            packageId: uploadResult.mainPackageId,
          }

          return {
            checkpoint: {packageId: uploadResult.mainPackageId, targetId: options.target.id},
            data: {
              packageId: uploadResult.mainPackageId,
              target: options.target.label,
            },
            detail: `Uploaded ${path.basename(artifact.darPath)} to ${options.target.label}.`,
          }
        } catch (error) {
          if (error instanceof CantonctlError) {
            if (error.code === ErrorCode.DEPLOY_UPLOAD_FAILED) {
              throw error
            }

            if (error.context?.status === 409) {
              throw new CantonctlError(ErrorCode.DEPLOY_PACKAGE_EXISTS, {
                cause: error,
                context: {
                  darPath: artifact.darPath,
                  network: options.runtime.networkName,
                  target: options.target.label,
                },
                suggestion: 'A package with this name and version already exists. Increment the version in daml.yaml.',
              })
            }
          }

          throw error
        }
      },
      title: `Upload DAR to ${options.target.label}`,
    },
    {
      dependsOn: [uploadId],
      effect: 'read',
      id: verifyId,
      postconditions: ({state}) => buildPostDeployChecks(state, options.target.id),
      run: async ({state}) => {
        const artifact = state.artifact
        const targetState = state.targets[options.target.id]!
        const durationMs = Date.now() - targetState.startedAt!
        state.targets[options.target.id] = {
          ...targetState,
          durationMs,
        }

        if (artifact && targetState.packageId) {
          await options.deps.hooks?.emit('afterDeploy', {
            darPath: artifact.darPath,
            durationMs,
            mainPackageId: targetState.packageId,
            network: options.runtime.networkName,
            participant: options.target.participant,
            profile: options.runtime.profile.name,
            target: options.target.label,
          })
        }

        return {
          data: {
            durationMs,
            packageId: targetState.packageId,
            target: options.target.label,
          },
          detail: targetState.packageId
            ? `Recorded package ID ${targetState.packageId} for ${options.target.label}.`
            : `No package ID was recorded for ${options.target.label}.`,
        }
      },
      title: `Verify ${options.target.label}`,
    },
  ]
}

async function resolveArtifact(options: {
  darPath?: string
  findDarFile: typeof defaultFindDarFile
  fs: {readFile: (filePath: string) => Promise<Uint8Array>}
  projectDir: string
}): Promise<DeployArtifactState> {
  const source: DeployArtifactSource = options.darPath ? 'explicit' : 'auto-detected'
  const darPath = options.darPath
    ? path.resolve(options.projectDir, options.darPath)
    : await options.findDarFile(path.join(options.projectDir, DIST_DIR))

  if (!darPath) {
    throw new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
      suggestion: 'No built DAR found. Run "cantonctl build" first or specify --dar.',
    })
  }

  let darBytes: Uint8Array
  try {
    darBytes = await options.fs.readFile(darPath)
  } catch (error) {
    throw new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
      cause: error instanceof Error ? error : undefined,
      context: {darPath},
      suggestion: `Cannot read DAR file at ${darPath}. Check the path exists.`,
    })
  }

  return {
    darBytes,
    darPath,
    sizeBytes: darBytes.byteLength,
    source,
  }
}

async function resolvePlanArtifact(options: {
  darPath?: string
  findDarFile: typeof defaultFindDarFile
  fs: {readFile: (filePath: string) => Promise<Uint8Array>}
  projectDir: string
}): Promise<PlanArtifactResolution> {
  try {
    return {
      artifact: await resolveArtifact(options),
    }
  } catch (error) {
    if (error instanceof CantonctlError) {
      return {error}
    }

    throw error
  }
}

async function resolveDeployFanOut(options: {
  detectTopology: (projectDir: string) => Promise<GeneratedTopology | null>
  projectDir: string
  runtime: ResolvedProfileRuntime
}): Promise<{
  mode: DeployFanOutMode
  source: DeployTargetEndpointSource
  targets: DeployTargetContext[]
}> {
  const ledgerService = options.runtime.services.find(service => service.name === 'ledger')

  if (options.runtime.profile.kind === 'canton-multi') {
    const topology = await options.detectTopology(options.projectDir)
    if (topology && topology.participants.length > 0) {
      return {
        mode: 'fan-out',
        source: 'generated-topology',
        targets: topology.participants.map((participant) => ({
          baseUrl: `http://localhost:${participant.ports.jsonApi}`,
          endpointSource: 'generated-topology',
          id: participant.name,
          label: participant.name,
          managementClass: ledgerService?.controlPlane.managementClass ?? 'apply-capable',
          participant: participant.name,
        })),
      }
    }
  }

  const ledger = options.runtime.profile.services.ledger
  return {
    mode: 'single-target',
    source: 'profile-ledger',
    targets: [{
      baseUrl: ledger ? getLedgerBaseUrl(ledger) : undefined,
      endpointSource: 'profile-ledger',
      id: options.runtime.profile.name,
      label: options.runtime.profile.name,
      managementClass: ledgerService?.controlPlane.managementClass ?? 'read-only',
    }],
  }
}

function buildTargetPreconditions(
  runtime: ResolvedProfileRuntime,
  target: DeployTargetContext,
): Array<{code: string; detail: string; status: 'block' | 'pass'}> {
  return [
    {
      code: 'ledger-service-configured',
      detail: target.baseUrl
        ? `Ledger endpoint resolved as ${target.baseUrl}.`
        : 'The selected profile does not expose a deployable ledger endpoint.',
      status: target.baseUrl ? 'pass' : 'block',
    },
    {
      code: 'management-class',
      detail: target.managementClass === 'apply-capable'
        ? `Ledger management class is ${target.managementClass}.`
        : `Ledger management class is ${target.managementClass}; deploy apply is not supported for this target.`,
      status: target.managementClass === 'apply-capable' ? 'pass' : 'block',
    },
    {
      code: 'credential-material',
      detail: runtime.operatorCredential.source === 'missing'
        ? `No operator auth material resolved. Provide ${runtime.auth.operator.envVarName} or store credentials with "cantonctl auth login ${runtime.networkName} --scope operator" before deploying.`
        : `Operator auth material resolved from ${runtime.operatorCredential.source}.`,
      status: runtime.operatorCredential.source === 'missing' ? 'block' : 'pass',
    },
  ]
}

function buildTargetWarnings(
  runtime: ResolvedProfileRuntime,
  target: DeployTargetContext,
): Array<{code: string; detail: string}> {
  const warnings: Array<{code: string; detail: string}> = []

  if (runtime.profile.experimental) {
    warnings.push({
      code: 'experimental-target',
      detail: `Profile "${runtime.profile.name}" is marked experimental.`,
    })
  }

  if (target.endpointSource === 'generated-topology') {
    warnings.push({
      code: 'topology-fan-out',
      detail: 'Deploy fan-out is using the generated local topology manifest rather than a single ledger endpoint.',
    })
  }

  if (runtime.profile.kind === 'splice-localnet') {
    warnings.push({
      code: 'official-runtime-boundary',
      detail: 'The official LocalNet workspace still owns runtime lifecycle; deploy only targets its exposed ledger endpoint.',
    })
  }

  return warnings
}

function buildPostDeployChecks(
  state: DeployState,
  targetId: string,
): ControlPlanePostcondition[] {
  const packageId = state.targets[targetId]?.packageId
  return [{
    code: 'package-id-returned',
    detail: packageId
      ? `Ledger returned package ID ${packageId}.`
      : 'Ledger did not return a package ID for this upload.',
    status: packageId ? 'pass' : 'fail',
  }]
}

function summarizeTarget(
  operation: ControlPlaneOperationResult,
  state: DeployState,
  target: DeployTargetContext,
): DeployTargetResult {
  const preflight = findStep(operation, `preflight-${target.id}`)!
  const upload = findStep(operation, `upload-${target.id}`)!
  const verify = findStep(operation, `verify-${target.id}`)!

  return {
    baseUrl: target.baseUrl,
    endpointSource: target.endpointSource,
    id: target.id,
    label: target.label,
    managementClass: target.managementClass,
    packageId: state.targets[target.id]?.packageId ?? null,
    participant: target.participant,
    postDeployChecks: verify.postconditions,
    status: resolveTargetStatus(preflight.status, upload.status, verify.status),
  }
}

function resolveTargetStatus(
  preflight?: ControlPlaneStepStatus,
  upload?: ControlPlaneStepStatus,
  verify?: ControlPlaneStepStatus,
): ControlPlaneStepStatus {
  const statuses = [preflight, upload, verify].filter(Boolean)

  if (statuses.includes('failed')) {
    return 'failed'
  }

  if (statuses.includes('blocked')) {
    return 'blocked'
  }

  if (statuses.includes('dry-run')) {
    return 'dry-run'
  }

  if (verify === 'completed' || upload === 'completed' || preflight === 'completed') {
    return 'completed'
  }

  if (statuses.includes('ready')) {
    return 'ready'
  }

  return 'pending'
}

function findStep(result: ControlPlaneOperationResult, id: string) {
  return result.steps.find(step => step.id === id)
}

function resolveRequestedProfileName(config: CantonctlConfig, target?: string): string | undefined {
  if (!target) {
    return undefined
  }

  if (config.profiles?.[target]) {
    return target
  }

  if (config.networkProfiles?.[target]) {
    return config.networkProfiles[target]
  }

  return target
}

function resolveDeployMode(options: DeployOptions): ControlPlaneOperationMode {
  if (options.mode) {
    return options.mode
  }

  return options.dryRun ? 'dry-run' : 'apply'
}

function createTokenOptions(config: CantonctlConfig, party?: string) {
  const partyNames = config.parties?.map(value => value.name) ?? []
  return {
    actAs: party ? [party] : (partyNames.length > 0 ? partyNames : ['admin']),
    admin: true,
    applicationId: 'cantonctl',
    readAs: partyNames,
  }
}

function getLedgerBaseUrl(ledger: NonNullable<ResolvedProfileRuntime['profile']['services']['ledger']>): string {
  return ledger.url ?? `http://localhost:${ledger['json-api-port'] ?? 7575}`
}

function applyPlanArtifactResolution(
  operation: ControlPlaneOperationResult,
  resolution: PlanArtifactResolution,
): ControlPlaneOperationResult {
  const steps = operation.steps.map((step) => {
    if (step.id !== 'resolve-dar') {
      return step
    }

    if ('error' in resolution) {
      return {
        ...step,
        detail: resolution.error.message,
        error: serializeDeployError(resolution.error),
        status: 'failed' as const,
      }
    }

    const artifact = resolution.artifact

    return {
      ...step,
      checkpoint: {
        darPath: artifact.darPath,
        source: artifact.source,
      },
      data: {
        darPath: artifact.darPath,
        sizeBytes: artifact.sizeBytes,
        source: artifact.source,
      },
      detail:
        artifact.source === 'explicit'
          ? `Using explicit DAR artifact ${artifact.darPath}. Build and codegen remain owned by DPM.`
          : `Using built DAR artifact ${artifact.darPath} from ${DIST_DIR}.`,
      status: 'completed' as const,
    }
  })
  const artifact = 'artifact' in resolution ? resolution.artifact : undefined

  return {
    ...operation,
    partial: steps.some(step => step.status === 'completed')
      && steps.some(step => step.status !== 'completed'),
    resume: {
      canResume: false,
      checkpoints: artifact
        ? [{checkpoint: {darPath: artifact.darPath, source: artifact.source}, stepId: 'resolve-dar'}]
        : [],
      completedStepIds: artifact ? ['resolve-dar'] : [],
      nextStepId: undefined,
    },
    steps,
    success: !steps.some(step => step.status === 'blocked' || step.status === 'failed'),
    summary: summarizeDeploySteps(steps),
  }
}

function serializeDeployError(error: CantonctlError) {
  const serialized = error.toJSON()
  return {
    code: serialized.code as string | undefined,
    context: serialized.context as Record<string, unknown> | undefined,
    docsUrl: serialized.docsUrl as string | undefined,
    message: error.message,
    suggestion: serialized.suggestion as string | undefined,
  }
}

function summarizeDeploySteps(steps: ControlPlaneOperationResult['steps']) {
  return {
    blocked: steps.filter(step => step.status === 'blocked').length,
    completed: steps.filter(step => step.status === 'completed').length,
    dryRun: steps.filter(step => step.status === 'dry-run').length,
    failed: steps.filter(step => step.status === 'failed').length,
    manual: steps.filter(step => step.status === 'manual').length,
    pending: steps.filter(step => step.status === 'pending').length,
    ready: steps.filter(step => step.status === 'ready').length,
    warned: steps.reduce((count, step) => count + step.warnings.length, 0),
  }
}
