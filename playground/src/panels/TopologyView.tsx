import {Activity, Box, FileText, Network, RefreshCw, Server, Users} from 'lucide-react'
import {useTopology} from '../hooks/useTopology'

export function TopologyView() {
  const {mode, topology, participants, refetch} = useTopology()

  return (
    <div className="h-full flex flex-col bg-canton-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-canton-400" />
          <span className="text-xs font-semibold text-zinc-300">Network Topology</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            mode === 'multi'
              ? 'bg-canton-600/20 text-canton-400'
              : 'bg-zinc-800 text-zinc-500'
          }`}>
            {mode === 'multi' ? 'Multi-Node' : 'Single Node'}
          </span>
        </div>
        <button onClick={() => refetch()} className="text-zinc-500 hover:text-zinc-300 transition">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Topology visualization */}
      <div className="flex-1 overflow-auto p-6">
        {/* Synchronizer */}
        {topology?.synchronizer && (
          <div className="flex justify-center mb-8">
            <SynchronizerNode
              admin={topology.synchronizer.admin}
              publicApi={topology.synchronizer.publicApi}
            />
          </div>
        )}

        {/* Connection lines */}
        {topology?.synchronizer && participants.length > 0 && (
          <div className="flex justify-center mb-4">
            <div className="w-px h-8 bg-zinc-700/50" />
          </div>
        )}

        {/* Participant nodes */}
        <div className="flex justify-center gap-6 flex-wrap">
          {participants.map(participant => (
            <ParticipantNode
              key={participant.name}
              name={participant.name}
              healthy={participant.healthy}
              version={participant.version}
              port={participant.port}
              parties={participant.parties}
              contractCount={participant.contractCount}
            />
          ))}
        </div>

        {participants.length === 0 && (
          <div className="text-center text-zinc-600 text-sm mt-8">
            No participants detected. Start the sandbox or use --full for multi-node.
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="px-4 py-2 border-t border-zinc-800/50 flex gap-4 text-[10px] text-zinc-500 shrink-0">
        <span className="flex items-center gap-1">
          <Server className="h-3 w-3" />
          {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {participants.filter(p => p.healthy).length} healthy
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {participants.reduce((sum, p) => sum + p.parties.length, 0)} parties
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {participants.reduce((sum, p) => sum + p.contractCount, 0)} contracts
        </span>
      </div>
    </div>
  )
}

// ── Synchronizer Node ────────────────────────────────────────────────

function SynchronizerNode({admin, publicApi}: {admin: number; publicApi: number}) {
  return (
    <div className="rounded-xl border border-canton-600/30 bg-canton-950/80 backdrop-blur p-4 w-64 text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        <Network className="h-4 w-4 text-canton-400" />
        <span className="text-sm font-semibold text-canton-300">Synchronizer</span>
      </div>
      <div className="space-y-1 text-[10px] text-zinc-500">
        <div>Admin: <span className="text-zinc-400 font-mono">:{admin}</span></div>
        <div>Public API: <span className="text-zinc-400 font-mono">:{publicApi}</span></div>
      </div>
    </div>
  )
}

// ── Participant Node ─────────────────────────────────────────────────

function ParticipantNode({name, healthy, version, port, parties, contractCount}: {
  name: string
  healthy: boolean
  version?: string
  port: number
  parties: Array<Record<string, unknown>>
  contractCount: number
}) {
  return (
    <div className={`rounded-xl border backdrop-blur p-4 w-64 ${
      healthy
        ? 'border-emerald-600/30 bg-zinc-900/80'
        : 'border-red-600/30 bg-zinc-900/80'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Box className={`h-4 w-4 ${healthy ? 'text-emerald-400' : 'text-red-400'}`} />
          <span className="text-sm font-semibold text-zinc-200">{name}</span>
        </div>
        <div className={`h-2 w-2 rounded-full ${
          healthy ? 'bg-emerald-400 shadow shadow-emerald-400/50' : 'bg-red-400 shadow shadow-red-400/50'
        }`} />
      </div>

      {/* Version + Port */}
      <div className="space-y-1 text-[10px] mb-3">
        <div className="flex justify-between text-zinc-500">
          <span>Version</span>
          <span className="text-zinc-400 font-mono">{version ?? 'unknown'}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>JSON API</span>
          <span className="text-zinc-400 font-mono">:{port}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>Contracts</span>
          <span className="text-zinc-400 font-mono">{contractCount}</span>
        </div>
      </div>

      {/* Parties */}
      {parties.length > 0 && (
        <div className="border-t border-zinc-800/50 pt-2">
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">Parties</div>
          <div className="space-y-1">
            {parties.map((party, i) => {
              const id = String(party.party ?? party.identifier ?? '')
              const displayName = String(party.displayName ?? id.split('::')[0] ?? `party-${i}`)
              return (
                <div key={id || i} className="flex items-center gap-1.5 text-[10px]">
                  <Users className="h-3 w-3 text-canton-400/60" />
                  <span className="text-zinc-300">{displayName}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {parties.length === 0 && (
        <div className="text-[10px] text-zinc-600 text-center pt-2 border-t border-zinc-800/50">
          No parties
        </div>
      )}
    </div>
  )
}
