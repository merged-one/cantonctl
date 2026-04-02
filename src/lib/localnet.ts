import {CantonctlError, ErrorCode} from './errors.js'
import type {LocalnetProfileName, LocalnetWorkspace} from './localnet-workspace.js'
import type {ProcessRunner} from './process-runner.js'

export interface LocalnetContainerStatus {
  healthy: boolean | null
  name: string
  ports?: string
  service: string
  status: string
}

export interface LocalnetReadyzStatus {
  body: string
  healthy: boolean
  status: number
  url: string
}

export interface LocalnetStatusResult {
  containers: LocalnetContainerStatus[]
  health: {
    validatorReadyz: LocalnetReadyzStatus
  }
  profiles: LocalnetWorkspace['profiles']
  selectedProfile: LocalnetProfileName
  services: {
    ledger: {url: string}
    scan?: {url: string}
    validator: {url: string}
    wallet: {url: string}
  }
  workspace: LocalnetWorkspace
}

export interface LocalnetCommandResult {
  target: string
  workspace: LocalnetWorkspace
}

interface LocalnetFetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export interface LocalnetDeps {
  detectWorkspace: (workspace: string) => Promise<LocalnetWorkspace>
  fetch: (url: string) => Promise<LocalnetFetchResponse>
  runner: ProcessRunner
}

export interface Localnet {
  down(opts: {workspace: string}): Promise<LocalnetCommandResult>
  status(opts: {profile?: string; workspace: string}): Promise<LocalnetStatusResult>
  up(opts: {profile?: string; workspace: string}): Promise<LocalnetStatusResult>
}

export function createLocalnet(deps: LocalnetDeps): Localnet {
  const {detectWorkspace, fetch, runner} = deps

  return {
    async up(opts) {
      const workspace = await detectWorkspace(opts.workspace)
      await runMakeTarget(runner, workspace, workspace.makeTargets.up, opts.profile)
      return getStatus(workspace, opts.profile, runner, fetch)
    },

    async down(opts) {
      const workspace = await detectWorkspace(opts.workspace)
      await runMakeTarget(runner, workspace, workspace.makeTargets.down)
      return {
        target: workspace.makeTargets.down,
        workspace,
      }
    },

    async status(opts) {
      const workspace = await detectWorkspace(opts.workspace)
      return getStatus(workspace, opts.profile, runner, fetch)
    },
  }
}

export function parseLocalnetStatusOutput(stdout: string): LocalnetContainerStatus[] {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
  const headerIndex = lines.findIndex(line => /^\s*NAME\s{2,}/.test(line))

  return stdout
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .slice(headerIndex >= 0 ? headerIndex + 1 : 0)
    .map(parseStatusLine)
    .filter((entry): entry is LocalnetContainerStatus => entry !== null)
}

async function getStatus(
  workspace: LocalnetWorkspace,
  profileHint: string | undefined,
  runner: ProcessRunner,
  fetch: (url: string) => Promise<LocalnetFetchResponse>,
): Promise<LocalnetStatusResult> {
  const selectedProfile = resolveProfile(profileHint)
  const statusResult = await runMakeTarget(runner, workspace, workspace.makeTargets.status)
  const profile = workspace.profiles[selectedProfile]
  const services: LocalnetStatusResult['services'] = {
    ledger: {url: profile.urls.ledger},
    validator: {url: profile.urls.validator},
    wallet: {url: profile.urls.wallet},
  }

  if (profile.urls.scan) {
    services.scan = {url: profile.urls.scan}
  }

  return {
    containers: parseLocalnetStatusOutput(statusResult.stdout),
    health: {
      validatorReadyz: await checkValidatorReadyz(fetch, profile.health.validatorReadyz),
    },
    profiles: workspace.profiles,
    selectedProfile,
    services,
    workspace,
  }
}

function resolveProfile(profileHint?: string): LocalnetProfileName {
  if (profileHint === 'app-provider' || profileHint === 'app-user' || profileHint === 'sv') {
    return profileHint
  }

  return 'sv'
}

function parseStatusLine(line: string): LocalnetContainerStatus | null {
  const columns = line.trim().split(/\s{2,}/)
  if (columns.length < 6) return null

  const [name, , , service, , status, ports] = columns
  return {
    healthy: status.includes('(healthy)') ? true : status.includes('(unhealthy)') ? false : null,
    name,
    ports,
    service,
    status,
  }
}

async function runMakeTarget(
  runner: ProcessRunner,
  workspace: LocalnetWorkspace,
  target: string,
  profileHint?: string,
): Promise<{exitCode: number; stderr: string; stdout: string}> {
  const makePath = await runner.which('make')
  if (!makePath) {
    throw new CantonctlError(ErrorCode.LOCALNET_COMMAND_FAILED, {
      context: {target, workspace: workspace.root},
      suggestion: 'Install GNU make and confirm the upstream LocalNet workspace runs manually.',
    })
  }

  const args = [target]
  if (profileHint) args.push(`PROFILE=${profileHint}`)

  const result = await runner.run('make', args, {
    cwd: workspace.root,
    ignoreExitCode: true,
  })

  if (result.exitCode !== 0) {
    throw new CantonctlError(ErrorCode.LOCALNET_COMMAND_FAILED, {
      context: {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        target,
        workspace: workspace.root,
      },
      suggestion: `The upstream LocalNet workspace failed while running "make ${target}". Re-run "cd ${workspace.root} && make ${target}" for full logs.`,
    })
  }

  return result
}

async function checkValidatorReadyz(
  fetch: (url: string) => Promise<LocalnetFetchResponse>,
  url: string,
): Promise<LocalnetReadyzStatus> {
  try {
    const response = await fetch(url)
    const body = await response.text()
    return {
      body,
      healthy: response.ok,
      status: response.status,
      url,
    }
  } catch (error) {
    return {
      body: error instanceof Error ? error.message : String(error),
      healthy: false,
      status: 0,
      url,
    }
  }
}
