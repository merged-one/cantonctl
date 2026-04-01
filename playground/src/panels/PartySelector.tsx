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

  return (
    <div className="flex items-center gap-2">
      <Users className="h-3.5 w-3.5 text-zinc-500" />
      <div className="flex gap-1">
        {parties.map(party => {
          const name = party.displayName || party.identifier.split('::')[0]
          const isActive = party.identifier === activeParty
          return (
            <button
              key={party.identifier}
              onClick={() => onSelect(party.identifier)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium transition ${
                isActive
                  ? 'bg-canton-600 text-white shadow-sm shadow-canton-600/25'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
              title={party.identifier}
            >
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
