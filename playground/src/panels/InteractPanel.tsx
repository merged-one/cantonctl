import {FileText, Plus, ArrowRightLeft, Coins, Flame, RefreshCw, Loader2} from 'lucide-react'
import {useState} from 'react'
import type {ActiveContract, PartyDetails} from '../lib/api'
import {api} from '../lib/api'

interface InteractPanelProps {
  parties: PartyDetails[]
  activeParty: string | null
  contracts: ActiveContract[]
  loading: boolean
  onRefresh: () => void
  onContractChange: () => void
}

export function InteractPanel({parties, activeParty, contracts, loading, onRefresh, onContractChange}: InteractPanelProps) {
  return (
    <div className="h-full flex flex-col bg-canton-950 overflow-y-auto">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/50">
        Interact
      </div>

      {/* Create section */}
      <CreateSection activeParty={activeParty} onCreated={onContractChange} />

      {/* Active contracts */}
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
            {contracts.map(contract => (
              <ContractCard
                key={contract.contractId}
                contract={contract}
                parties={parties}
                activeParty={activeParty}
                onExercised={onContractChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Create Contract Section ──────────────────────────────────────────────

function CreateSection({activeParty, onCreated}: {activeParty: string | null; onCreated: () => void}) {
  const [symbol, setSymbol] = useState('CTK')
  const [amount, setAmount] = useState('1000')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!activeParty) return
    setCreating(true)
    try {
      await api.submitCommand([activeParty], [{
        CreateCommand: {
          templateId: 'Main:Token',
          createArguments: {owner: activeParty, symbol, amount},
        },
      }])
      onCreated()
      setAmount('1000')
    } catch (err) {
      console.error('Create failed:', err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Plus className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Create Token</span>
      </div>
      <div className="space-y-1.5">
        <input
          type="text"
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          placeholder="Symbol"
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-canton-500 focus:outline-none"
        />
        <input
          type="text"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="Amount"
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-canton-500 focus:outline-none"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !activeParty}
          className="w-full bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs py-1.5 rounded font-medium transition disabled:opacity-40 flex items-center justify-center gap-1"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create
        </button>
      </div>
    </div>
  )
}

// ── Contract Card ────────────────────────────────────────────────────────

function ContractCard({contract, parties, activeParty, onExercised}: {
  contract: ActiveContract
  parties: PartyDetails[]
  activeParty: string | null
  onExercised: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [exercising, setExercising] = useState(false)
  const payload = contract.payload

  async function exerciseChoice(choice: string, args: Record<string, unknown>) {
    if (!activeParty) return
    setExercising(true)
    try {
      await api.submitCommand([activeParty], [{
        ExerciseCommand: {
          templateId: contract.templateId,
          contractId: contract.contractId,
          choice,
          choiceArgument: args,
        },
      }])
      onExercised()
    } catch (err) {
      console.error(`Exercise ${choice} failed:`, err)
    } finally {
      setExercising(false)
    }
  }

  return (
    <div className="rounded border border-zinc-800/50 bg-zinc-900/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2.5 py-2 flex items-center justify-between hover:bg-zinc-800/30 transition"
      >
        <div className="text-left">
          <div className="text-[10px] text-canton-400 font-mono">{contract.templateId}</div>
          {'symbol' in payload && (
            <div className="text-xs text-zinc-200 font-semibold mt-0.5">
              {String(payload.amount)} {String(payload.symbol)}
            </div>
          )}
        </div>
        <div className="text-[9px] text-zinc-600 font-mono truncate max-w-[60px]">
          {contract.contractId.slice(-8)}
        </div>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-zinc-800/30">
          {/* Payload fields */}
          <div className="pt-2 space-y-0.5">
            {Object.entries(payload).map(([key, value]) => (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-zinc-500">{key}</span>
                <span className="text-zinc-300 font-mono truncate max-w-[120px]">{String(value)}</span>
              </div>
            ))}
          </div>

          {/* Choice buttons */}
          <div className="flex gap-1 pt-1">
            <ChoiceButton
              icon={<ArrowRightLeft className="h-3 w-3" />}
              label="Transfer"
              color="canton"
              disabled={exercising}
              onClick={() => {
                const to = parties.find(p => (p.party ?? p.identifier ?? '') !== activeParty)
                if (to) exerciseChoice('Transfer', {newOwner: to.identifier, transferAmount: String(Number(payload.amount) / 2)})
              }}
            />
            <ChoiceButton
              icon={<Coins className="h-3 w-3" />}
              label="Mint"
              color="emerald"
              disabled={exercising}
              onClick={() => exerciseChoice('Mint', {mintAmount: '100'})}
            />
            <ChoiceButton
              icon={<Flame className="h-3 w-3" />}
              label="Burn"
              color="red"
              disabled={exercising}
              onClick={() => exerciseChoice('Burn', {})}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ChoiceButton({icon, label, color, disabled, onClick}: {
  icon: React.ReactNode
  label: string
  color: 'canton' | 'emerald' | 'red'
  disabled: boolean
  onClick: () => void
}) {
  const colorClasses = {
    canton: 'bg-canton-600/20 text-canton-400 hover:bg-canton-600/30',
    emerald: 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30',
    red: 'bg-red-600/20 text-red-400 hover:bg-red-600/30',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition disabled:opacity-40 ${colorClasses[color]}`}
    >
      {icon}
      {label}
    </button>
  )
}
