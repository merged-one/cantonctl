import {Columns2, Eye, EyeOff, RefreshCw} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import type {ActiveContract, DamlTemplate, PartyDetails} from '../lib/api'
import {api} from '../lib/api'
import {DynamicChoiceForm} from './DynamicChoiceForm'

interface SplitViewProps {
  parties: PartyDetails[]
  templates: DamlTemplate[]
  projectName: string
}

function partyId(p: PartyDetails): string {
  return p.party ?? p.identifier ?? ''
}

function partyName(p: PartyDetails): string {
  return p.displayName || partyId(p).split('::')[0] || partyId(p).slice(0, 12)
}

export function SplitView({parties, templates, projectName}: SplitViewProps) {
  const [leftParty, setLeftParty] = useState<string>('')
  const [rightParty, setRightParty] = useState<string>('')

  // Auto-select first two parties
  useEffect(() => {
    if (parties.length >= 1 && !leftParty) setLeftParty(partyId(parties[0]))
    if (parties.length >= 2 && !rightParty) setRightParty(partyId(parties[1]))
  }, [parties, leftParty, rightParty])

  // Query contracts for both parties
  const {data: multiData, refetch} = useQuery({
    queryKey: ['contracts-multi', leftParty, rightParty],
    queryFn: () => {
      const partyIds = [leftParty, rightParty].filter(Boolean)
      if (partyIds.length === 0) return Promise.resolve({contracts: {}})
      return api.getMultiPartyContracts(partyIds)
    },
    enabled: !!(leftParty || rightParty),
    refetchInterval: 3000,
  })

  const contractsMap = (multiData?.contracts ?? {}) as Record<string, ActiveContract[]>
  const leftContracts: ActiveContract[] = contractsMap[leftParty] ?? []
  const rightContracts: ActiveContract[] = contractsMap[rightParty] ?? []

  // Find contracts visible to both parties (shared) vs only one (private)
  const leftContractIds = new Set(leftContracts.map(c => c.contractId))
  const rightContractIds = new Set(rightContracts.map(c => c.contractId))

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50 bg-canton-950 shrink-0">
        <div className="flex items-center gap-2">
          <Columns2 className="h-4 w-4 text-canton-400" />
          <span className="text-xs font-semibold text-zinc-300">Multi-Party View</span>
          <span className="text-[10px] text-zinc-500">Canton privacy model</span>
        </div>
        <button
          onClick={() => refetch()}
          className="text-zinc-500 hover:text-zinc-300 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Two columns */}
      <div className="flex-1 flex overflow-hidden">
        <PartyColumn
          party={leftParty}
          parties={parties}
          contracts={leftContracts}
          sharedContractIds={rightContractIds}
          templates={templates}
          projectName={projectName}
          onPartyChange={setLeftParty}
          onRefresh={() => refetch()}
          side="left"
        />

        <div className="w-px bg-zinc-700/50 shrink-0" />

        <PartyColumn
          party={rightParty}
          parties={parties}
          contracts={rightContracts}
          sharedContractIds={leftContractIds}
          templates={templates}
          projectName={projectName}
          onPartyChange={setRightParty}
          onRefresh={() => refetch()}
          side="right"
        />
      </div>
    </div>
  )
}

// ── Party Column ─────────────────────────────────────────────────────────

function PartyColumn({party, parties, contracts, sharedContractIds, templates, projectName, onPartyChange, onRefresh, side}: {
  party: string
  parties: PartyDetails[]
  contracts: ActiveContract[]
  sharedContractIds: Set<string>
  templates: DamlTemplate[]
  projectName: string
  onPartyChange: (id: string) => void
  onRefresh: () => void
  side: 'left' | 'right'
}) {
  const selectedParty = parties.find(p => partyId(p) === party)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Party selector */}
      <div className={`px-3 py-2 border-b border-zinc-800/50 ${side === 'left' ? 'bg-canton-950/80' : 'bg-zinc-900/80'}`}>
        <select
          value={party}
          onChange={e => onPartyChange(e.target.value)}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-200 focus:border-canton-500 focus:outline-none"
        >
          <option value="">Select party...</option>
          {parties.map(p => (
            <option key={partyId(p)} value={partyId(p)}>
              {partyName(p)}
            </option>
          ))}
        </select>
      </div>

      {/* Contract list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {!party ? (
          <div className="text-center text-xs text-zinc-600 py-8">
            Select a party to see their contracts
          </div>
        ) : contracts.length === 0 ? (
          <div className="text-center text-xs text-zinc-600 py-8">
            No contracts visible to {selectedParty ? partyName(selectedParty) : 'this party'}
          </div>
        ) : (
          contracts.map(contract => {
            const isShared = sharedContractIds.has(contract.contractId)
            const templateName = contract.templateId.split(':').pop() ?? ''
            const template = templates.find(t => t.name === templateName)

            return (
              <div key={contract.contractId} className="relative">
                {/* Shared/private indicator */}
                <div className="absolute top-2 right-2" title={isShared ? 'Visible to both parties' : 'Private to this party'}>
                  {isShared
                    ? <Eye className="h-3 w-3 text-emerald-400/60" />
                    : <EyeOff className="h-3 w-3 text-amber-400/60" />}
                </div>

                <DynamicChoiceForm
                  contract={contract}
                  template={template}
                  parties={parties}
                  activeParty={party}
                  projectName={projectName}
                  onExercised={onRefresh}
                />
              </div>
            )
          })
        )}
      </div>

      {/* Stats bar */}
      <div className="px-3 py-1.5 border-t border-zinc-800/50 text-[10px] text-zinc-500 flex gap-3">
        <span>{contracts.length} contract{contracts.length !== 1 ? 's' : ''}</span>
        {contracts.length > 0 && (
          <>
            <span className="text-emerald-400/60">
              {contracts.filter(c => sharedContractIds.has(c.contractId)).length} shared
            </span>
            <span className="text-amber-400/60">
              {contracts.filter(c => !sharedContractIds.has(c.contractId)).length} private
            </span>
          </>
        )}
      </div>
    </div>
  )
}
