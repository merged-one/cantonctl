import {ChevronDown, ChevronRight, Loader2, Zap} from 'lucide-react'
import {useState} from 'react'
import type {ActiveContract, DamlChoice, DamlTemplate, PartyDetails} from '../lib/api'
import {api} from '../lib/api'

interface DynamicChoiceFormProps {
  contract: ActiveContract
  template: DamlTemplate | undefined
  parties: PartyDetails[]
  activeParty: string | null
  projectName: string
  onExercised: () => void
}

function partyId(p: PartyDetails): string {
  return p.party ?? p.identifier ?? ''
}

export function DynamicChoiceForm({contract, template, parties, activeParty, projectName, onExercised}: DynamicChoiceFormProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeChoice, setActiveChoice] = useState<string | null>(null)
  const [choiceArgs, setChoiceArgs] = useState<Record<string, string>>({})
  const [exercising, setExercising] = useState(false)

  const choices = template?.choices ?? []

  // Extract template name from fully qualified ID (e.g., "pkg:Main:Token" -> "Token")
  const templateName = contract.templateId.split(':').pop() ?? contract.templateId

  async function handleExercise(choice: DamlChoice) {
    if (!activeParty) return
    setExercising(true)

    const args: Record<string, string> = {}
    for (const arg of choice.args) {
      args[arg.name] = choiceArgs[`${choice.name}.${arg.name}`] ?? ''
    }

    try {
      await api.submitCommand([activeParty], [{
        ExerciseCommand: {
          templateId: `#${projectName}:${template?.module ?? 'Main'}:${templateName}`,
          contractId: contract.contractId,
          choice: choice.name,
          choiceArgument: choice.args.length > 0 ? args : {},
        },
      }])
      onExercised()
      setChoiceArgs({})
      setActiveChoice(null)
    } catch (err) {
      console.error(`Exercise ${choice.name} failed:`, err)
    } finally {
      setExercising(false)
    }
  }

  return (
    <div className="rounded border border-zinc-800/50 bg-zinc-900/30 overflow-hidden">
      {/* Contract header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2.5 py-2 flex items-center justify-between hover:bg-zinc-800/30 transition"
      >
        <div className="flex items-center gap-1.5 text-left">
          {expanded ? <ChevronDown className="h-3 w-3 text-zinc-500" /> : <ChevronRight className="h-3 w-3 text-zinc-500" />}
          <div>
            <div className="text-[10px] text-canton-400 font-mono">{templateName}</div>
            <div className="flex gap-2 mt-0.5">
              {Object.entries(contract.payload).slice(0, 3).map(([key, value]) => (
                <span key={key} className="text-[10px] text-zinc-400">
                  <span className="text-zinc-600">{key}:</span> {String(value).slice(0, 20)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="text-[9px] text-zinc-600 font-mono">
          {contract.contractId.slice(-8)}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/30 px-2.5 pb-2.5">
          {/* All payload fields */}
          <div className="pt-2 space-y-0.5 mb-3">
            {Object.entries(contract.payload).map(([key, value]) => (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-zinc-500">{key}</span>
                <span className="text-zinc-300 font-mono truncate max-w-[140px]">{String(value)}</span>
              </div>
            ))}
          </div>

          {/* Dynamic choice buttons */}
          {choices.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Choices</div>
              {choices.map(choice => (
                <div key={choice.name}>
                  <button
                    onClick={() => {
                      if (choice.args.length === 0) {
                        handleExercise(choice)
                      } else {
                        setActiveChoice(activeChoice === choice.name ? null : choice.name)
                      }
                    }}
                    disabled={exercising || !activeParty}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-medium transition disabled:opacity-40 ${
                      choice.consuming
                        ? 'bg-amber-600/15 text-amber-400 hover:bg-amber-600/25'
                        : 'bg-canton-600/15 text-canton-400 hover:bg-canton-600/25'
                    }`}
                  >
                    {exercising && activeChoice === choice.name
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Zap className="h-3 w-3" />}
                    {choice.name}
                    {choice.args.length > 0 && (
                      <span className="ml-auto text-[9px] opacity-60">
                        {choice.args.length} arg{choice.args.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </button>

                  {/* Choice argument form */}
                  {activeChoice === choice.name && choice.args.length > 0 && (
                    <div className="mt-1.5 ml-2 pl-2 border-l border-zinc-800/50 space-y-1.5">
                      {choice.args.map(arg => (
                        <div key={arg.name}>
                          <label className="block text-[9px] text-zinc-500">
                            {arg.name} <span className="text-zinc-600">: {arg.type}</span>
                          </label>
                          {arg.type === 'Party' ? (
                            <select
                              value={choiceArgs[`${choice.name}.${arg.name}`] ?? ''}
                              onChange={e => setChoiceArgs(prev => ({...prev, [`${choice.name}.${arg.name}`]: e.target.value}))}
                              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 focus:border-canton-500 focus:outline-none"
                            >
                              <option value="">Select...</option>
                              {parties.map(p => (
                                <option key={partyId(p)} value={partyId(p)}>
                                  {p.displayName || partyId(p).split('::')[0]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={choiceArgs[`${choice.name}.${arg.name}`] ?? ''}
                              onChange={e => setChoiceArgs(prev => ({...prev, [`${choice.name}.${arg.name}`]: e.target.value}))}
                              placeholder={arg.type}
                              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 placeholder-zinc-600 focus:border-canton-500 focus:outline-none"
                            />
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => handleExercise(choice)}
                        disabled={exercising}
                        className="w-full bg-canton-600/80 hover:bg-canton-600 text-white text-[10px] py-1 rounded font-medium transition disabled:opacity-40 flex items-center justify-center gap-1"
                      >
                        {exercising ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Execute {choice.name}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
