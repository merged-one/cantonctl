import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useCallback, useState} from 'react'
import {api} from '../lib/api'

export function useFiles() {
  const queryClient = useQueryClient()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const {data: fileTree, isLoading} = useQuery({
    queryKey: ['files'],
    queryFn: api.getFiles,
    refetchInterval: 10000,
  })

  const openFile = useCallback(async (filePath: string) => {
    const result = await api.getFile(filePath)
    setFileContent(result.content)
    setActiveFile(filePath)
    setOpenTabs(prev => prev.includes(filePath) ? prev : [...prev, filePath])
  }, [])

  const closeTab = useCallback((filePath: string) => {
    setOpenTabs(prev => prev.filter(t => t !== filePath))
    if (activeFile === filePath) {
      setActiveFile(null)
      setFileContent('')
    }
  }, [activeFile])

  const saveFile = useCallback(async (filePath: string, content: string) => {
    setSaving(true)
    try {
      await api.saveFile(filePath, content)
      setFileContent(content)
      queryClient.invalidateQueries({queryKey: ['files']})
    } finally {
      setSaving(false)
    }
  }, [queryClient])

  return {
    fileTree: fileTree ?? [],
    loading: isLoading,
    activeFile,
    fileContent,
    openTabs,
    saving,
    openFile,
    closeTab,
    saveFile,
    setActiveFile,
    setFileContent,
  }
}
