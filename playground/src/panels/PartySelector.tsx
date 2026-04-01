import {Users} from 'lucide-react'
import type {PartyDetails} from '../lib/api'

interface PartySelectorProps {
  parties: PartyDetails[]
  activeParty: string | null
  onSelect: (partyId: string) => void
}

export function PartySelector({parties, activeParty, onSelect}: PartySelectorProps) {
  if (parties.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Users className="h-3.5 w-3.5" />
        <span>No parties</span>
      </div>
    )
  }

  const partyId = (p: PartyDetails) => p.party ?? p.identifier ?? ''
  const partyName = (p: PartyDetails) => {
    const id = partyId(p)
    return p.displayName || id.split('::')[0] || id.slice(0, 12)
  }

  return (
    <div className="flex items-center gap-2">
      <Users className="h-3.5 w-3.5 text-zinc-500" />
      <div className="flex gap-1">
        {parties.map(party => {
          const id = partyId(party)
          const isActive = id === activeParty
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium transition ${
                isActive
                  ? 'bg-canton-600 text-white shadow-sm shadow-canton-600/25'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
              title={id}
            >
              {partyName(party)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
