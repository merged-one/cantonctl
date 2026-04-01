import {useQuery} from '@tanstack/react-query'
import {api} from '../lib/api'

export function useTemplates() {
  const {data, isLoading, refetch} = useQuery({
    queryKey: ['templates'],
    queryFn: api.getTemplates,
    refetchInterval: 30000, // Re-scan after builds
    staleTime: 10000,
  })

  return {
    templates: data?.templates ?? [],
    loading: isLoading,
    refetch,
  }
}
