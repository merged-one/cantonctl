import * as fs from 'node:fs'

import type {NormalizedProfile} from '../config-profile.js'
import {createLocalnet, type Localnet, type LocalnetStatusResult} from '../localnet.js'
import {createLocalnetWorkspaceDetector, type LocalnetProfileName} from '../localnet-workspace.js'
import {createProcessRunner} from '../process-runner.js'

export interface LocalnetCycleResult {
  selectedProfile: LocalnetProfileName
  status: LocalnetStatusResult
  workspace: string
}

export function createDefaultLocalnet(): Localnet {
  const detector = createLocalnetWorkspaceDetector({
    access: (filePath: string) => fs.promises.access(filePath),
    readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
  })

  return createLocalnet({
    detectWorkspace: (workspace: string) => detector.detect(workspace),
    fetch: (url: string) => fetch(url),
    runner: createProcessRunner(),
  })
}

export async function cycleLocalnetWorkspace(options: {
  createLocalnet?: () => Localnet
  profile: Pick<NormalizedProfile, 'services'>
  workspace: string
}): Promise<LocalnetCycleResult> {
  const localnet = options.createLocalnet ? options.createLocalnet() : createDefaultLocalnet()
  const before = await localnet.status({workspace: options.workspace})
  const selectedProfile = inferLocalnetProfile(before, options.profile)
  await localnet.down({workspace: options.workspace})
  const after = await localnet.up({
    profile: selectedProfile,
    workspace: options.workspace,
  })

  return {
    selectedProfile: after.selectedProfile,
    status: after,
    workspace: after.workspace.root,
  }
}

export function inferLocalnetProfile(
  status: Pick<LocalnetStatusResult, 'profiles' | 'selectedProfile'>,
  profile: Pick<NormalizedProfile, 'services'>,
): LocalnetProfileName {
  const ledgerUrl = profile.services.ledger?.url
  const validatorUrl = profile.services.validator?.url
  const scanUrl = profile.services.scan?.url

  for (const [profileName, candidate] of Object.entries(status.profiles) as Array<[LocalnetProfileName, LocalnetStatusResult['profiles'][LocalnetProfileName]]>) {
    if (ledgerUrl && candidate.urls.ledger !== ledgerUrl) {
      continue
    }

    if (validatorUrl && candidate.urls.validator !== validatorUrl) {
      continue
    }

    if (scanUrl && candidate.urls.scan !== scanUrl) {
      continue
    }

    return profileName
  }

  return status.selectedProfile
}

export function isLocalnetLifecycleProfile(profile: Pick<NormalizedProfile, 'kind'>): boolean {
  return profile.kind === 'splice-localnet'
}
