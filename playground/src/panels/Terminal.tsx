import {Terminal as TerminalIcon, Hammer, FlaskConical} from 'lucide-react'
import type {LogEntry} from '../hooks/useBuild'

interface TerminalProps {
  logs: LogEntry[]
  building: boolean
  testing: boolean
  onBuild: () => void
  onTest: () => void
}

export function Terminal({logs, building, testing, onBuild, onTest}: TerminalProps) {
  return (
    <div className="h-full flex flex-col bg-canton-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/50">
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Output
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onBuild}
            disabled={building}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-40"
          >
            <Hammer className={`h-3 w-3 ${building ? 'animate-pulse' : ''}`} />
            Build
          </button>
          <button
            onClick={onTest}
            disabled={testing}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-40"
          >
            <FlaskConical className={`h-3 w-3 ${testing ? 'animate-pulse' : ''}`} />
            Test
          </button>
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
        {logs.length === 0 ? (
          <div className="text-zinc-600 text-center py-4">
            Waiting for events...
          </div>
        ) : (
          logs.map(log => (
            <div key={log.id} className="flex gap-2">
              <span className="text-zinc-600 shrink-0 text-[10px]">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <LogIcon type={log.type} />
              <span className={`whitespace-pre-wrap ${logColor(log.type)}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function LogIcon({type}: {type: LogEntry['type']}) {
  switch (type) {
    case 'success': return <span className="text-emerald-400 shrink-0">✓</span>
    case 'error': return <span className="text-red-400 shrink-0">✗</span>
    case 'build': return <span className="text-canton-400 shrink-0">⟳</span>
    case 'info': return <span className="text-zinc-500 shrink-0">·</span>
    default: return <span className="text-zinc-600 shrink-0">·</span>
  }
}

function logColor(type: LogEntry['type']): string {
  switch (type) {
    case 'success': return 'text-emerald-400'
    case 'error': return 'text-red-400'
    case 'build': return 'text-canton-400'
    case 'info': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}
