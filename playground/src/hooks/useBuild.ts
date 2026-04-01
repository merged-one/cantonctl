import {useCallback, useEffect, useRef, useState} from 'react'
import {api} from '../lib/api'
import {createWsClient, type PlaygroundEvent} from '../lib/ws'

export interface LogEntry {
  id: number
  type: 'build' | 'test' | 'info' | 'error' | 'success'
  message: string
  timestamp: number
}

let logId = 0

export function useBuild() {
  const [connected, setConnected] = useState(false)
  const [building, setBuilding] = useState(false)
  const [testing, setTesting] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const wsRef = useRef<ReturnType<typeof createWsClient> | null>(null)

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev.slice(-200), {id: ++logId, type, message, timestamp: Date.now()}])
  }, [])

  useEffect(() => {
    const ws = createWsClient()
    wsRef.current = ws

    ws.onEvent((event: PlaygroundEvent) => {
      switch (event.type) {
        case 'ws:connected':
          setConnected(true)
          addLog('info', 'Connected to Canton Playground')
          break
        case 'ws:disconnected':
          setConnected(false)
          addLog('error', 'Disconnected from server')
          break
        case 'build:start':
          setBuilding(true)
          addLog('build', 'Building...')
          break
        case 'build:success':
          setBuilding(false)
          addLog('success', `Build successful (${((event.durationMs as number) / 1000).toFixed(1)}s)`)
          break
        case 'build:cached':
          setBuilding(false)
          addLog('info', 'Build up to date (cached)')
          break
        case 'build:error':
          setBuilding(false)
          addLog('error', `Build failed: ${event.output}`)
          break
        case 'test:start':
          setTesting(true)
          addLog('build', 'Running tests...')
          break
        case 'test:result':
          setTesting(false)
          addLog(event.passed ? 'success' : 'error',
            event.passed ? 'All tests passed' : `Tests failed:\n${event.output}`)
          break
        case 'contracts:update':
          addLog('info', 'Contract state updated')
          break
        case 'log':
          addLog('info', event.message as string)
          break
      }
    })

    ws.connect()
    return () => ws.disconnect()
  }, [addLog])

  const triggerBuild = useCallback(async () => {
    setBuilding(true)
    try {
      await api.build()
    } catch (err) {
      addLog('error', `Build failed: ${err}`)
      setBuilding(false)
    }
  }, [addLog])

  const triggerTest = useCallback(async () => {
    setTesting(true)
    try {
      await api.test()
    } catch (err) {
      addLog('error', `Test failed: ${err}`)
      setTesting(false)
    }
  }, [addLog])

  return {connected, building, testing, logs, triggerBuild, triggerTest, addLog}
}
