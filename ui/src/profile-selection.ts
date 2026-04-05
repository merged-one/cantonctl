import type {UiSessionData} from '../../src/lib/ui/contracts'

export function resolveInitialProfileSelection(
  session: Pick<UiSessionData, 'defaultProfile' | 'profiles' | 'requestedProfile'>,
  storedProfileName?: string | null,
): string | undefined {
  const available = new Set(session.profiles.map(profile => profile.name))

  if (session.requestedProfile && available.has(session.requestedProfile)) {
    return session.requestedProfile
  }

  if (storedProfileName && available.has(storedProfileName)) {
    return storedProfileName
  }

  if (session.defaultProfile && available.has(session.defaultProfile)) {
    return session.defaultProfile
  }

  return session.profiles[0]?.name
}
