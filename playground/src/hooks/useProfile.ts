import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'

import {api} from '../lib/api'

export function useProfile() {
  const queryClient = useQueryClient()

  const {data} = useQuery({
    queryKey: ['profile'],
    queryFn: api.getProfile,
    staleTime: 5000,
  })

  const mutation = useMutation({
    mutationFn: (profile: string) => api.setProfile(profile),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
    },
  })

  return {
    profiles: data?.profiles ?? [],
    selectedProfile: data?.selectedProfile ?? null,
    source: data?.source ?? null,
    switching: mutation.isPending,
    switchProfile: mutation.mutateAsync,
  }
}
