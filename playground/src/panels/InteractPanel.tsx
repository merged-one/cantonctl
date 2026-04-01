import {FileText, RefreshCw} from 'lucide-react'
import type {ActiveContract, DamlTemplate, PartyDetails} from '../lib/api'
import {DynamicCreateForm} from './DynamicCreateForm'
import {DynamicChoiceForm} from './DynamicChoiceForm'

interface InteractPanelProps {
  parties: PartyDetails[]
  activeParty: string | null
  contracts: ActiveContract[]
  templates: DamlTemplate[]
  projectName: string
  loading: boolean
  onRefresh: () => void
  onContractChange: () => void
}

export function InteractPanel({parties, activeParty, contracts, templates, projectName, loading, onRefresh, onContractChange}: InteractPanelProps) {
  return (
    <div className="h-full flex flex-col bg-canton-950 overflow-y-auto">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/50">
        Interact
      </div>

      {/* Dynamic create form from template metadata */}
      <DynamicCreateForm
        templates={templates}
        parties={parties}
        activeParty={activeParty}
        projectName={projectName}
        onCreated={onContractChange}
      />

      {/* Active contracts with dynamic choice forms */}
      <div className="border-t border-zinc-800/50">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-canton-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Contracts
            </span>
            <span className="text-[10px] text-zinc-600">{contracts.length}</span>
          </div>
          <button onClick={onRefresh} className="text-zinc-500 hover:text-zinc-300 transition">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {contracts.length === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-600 text-center">
            {activeParty ? 'No contracts visible to this party' : 'Select a party above'}
          </div>
        ) : (
          <div className="space-y-1 px-2 pb-2">
            {contracts.map(contract => {
              const templateName = contract.templateId.split(':').pop() ?? ''
              const template = templates.find(t => t.name === templateName)
              return (
                <DynamicChoiceForm
                  key={contract.contractId}
                  contract={contract}
                  template={template}
                  parties={parties}
                  activeParty={activeParty}
                  projectName={projectName}
                  onExercised={onContractChange}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
