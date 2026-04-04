import {useQuery} from '@tanstack/react-query'
import {api} from '../lib/api'

export function useTopology() {
  const {data: topologyData} = useQuery({
    queryKey: ['topology'],
    queryFn: api.getTopology,
    staleTime: 30000,
  })

  const {data: statusData, refetch} = useQuery({
    queryKey: ['topology-status'],
    queryFn: api.getTopologyStatus,
    refetchInterval: 5000,
  })

  const {data: profileStatusData} = useQuery({
    queryKey: ['profile-status'],
    queryFn: api.getProfileStatus,
    refetchInterval: 5000,
  })

  const {data: compatData} = useQuery({
    queryKey: ['profile-compat'],
    queryFn: api.getProfileCompat,
    staleTime: 30000,
  })

  return {
    compat: compatData ?? null,
    mode: topologyData?.mode ?? 'single',
    profile: profileStatusData?.profile ?? null,
    profileHealthy: profileStatusData?.healthy ?? false,
    services: profileStatusData?.services ?? [],
    topology: topologyData?.topology ?? null,
    synchronizer: topologyData?.synchronizer ?? null,
    participants: statusData?.participants ?? [],
    refetch,
  }
}
