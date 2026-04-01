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

  return {
    mode: topologyData?.mode ?? 'single',
    topology: topologyData?.topology ?? null,
    synchronizer: topologyData?.synchronizer ?? null,
    participants: statusData?.participants ?? [],
    refetch,
  }
}
