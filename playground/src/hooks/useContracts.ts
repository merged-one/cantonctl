import {useQuery} from '@tanstack/react-query'
import {useState} from 'react'
import {api, type PartyDetails} from '../lib/api'

export function useContracts() {
  const [activeParty, setActiveParty] = useState<string | null>(null)

  const {data: partiesData} = useQuery({
    queryKey: ['parties'],
    queryFn: api.getParties,
    refetchInterval: 10000,
  })

  const parties: PartyDetails[] = partiesData?.partyDetails ?? []

  const {data: contractsData, isLoading, refetch} = useQuery({
    queryKey: ['contracts', activeParty],
    queryFn: () => activeParty ? api.getContracts(activeParty) : Promise.resolve({activeContracts: []}),
    enabled: !!activeParty,
  })

  const contracts = contractsData?.activeContracts ?? []

  return {
    parties,
    activeParty,
    setActiveParty,
    contracts,
    loading: isLoading,
    refetch,
  }
}
