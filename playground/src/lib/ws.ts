/**
 * WebSocket client for real-time playground events.
 */

export interface PlaygroundEvent {
  type: string
  [key: string]: unknown
}

type EventHandler = (event: PlaygroundEvent) => void

export function createWsClient() {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const handlers = new Set<EventHandler>()

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`

    ws = new WebSocket(url)

    ws.onopen = () => {
      handlers.forEach(h => h({type: 'ws:connected'}))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PlaygroundEvent
        handlers.forEach(h => h(data))
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      handlers.forEach(h => h({type: 'ws:disconnected'}))
      // Reconnect after 2 seconds
      reconnectTimer = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  return {
    connect,

    disconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    },

    onEvent(handler: EventHandler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}
