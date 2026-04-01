import {Loader2, Plus} from 'lucide-react'
import {useEffect, useState} from 'react'
import type {DamlTemplate, PartyDetails} from '../lib/api'
import {api} from '../lib/api'

interface DynamicCreateFormProps {
  templates: DamlTemplate[]
  parties: PartyDetails[]
  activeParty: string | null
  projectName: string
  onCreated: () => void
}

function defaultValueForType(type: string): string {
  if (type === 'Party') return ''
  if (type === 'Decimal' || type === 'Int') return '0'
  if (type === 'Bool') return 'True'
  return ''
}

function partyId(p: PartyDetails): string {
  return p.party ?? p.identifier ?? ''
}

export function DynamicCreateForm({templates, parties, activeParty, projectName, onCreated}: DynamicCreateFormProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.name ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  // Sync selectedTemplate when templates load async
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplate) {
      setSelectedTemplate(templates[0].name)
    }
  }, [templates, selectedTemplate])

  const template = templates.find(t => t.name === selectedTemplate)

  function setField(name: string, value: string) {
    setFieldValues(prev => ({...prev, [name]: value}))
  }

  function getFieldValue(name: string, type: string): string {
    if (name in fieldValues) return fieldValues[name]
    // Auto-fill signatory field with active party
    if (type === 'Party' && name === template?.signatory && activeParty) return activeParty
    return defaultValueForType(type)
  }

  async function handleCreate() {
    if (!activeParty || !template) return
    setCreating(true)

    const args: Record<string, string> = {}
    for (const field of template.fields) {
      args[field.name] = getFieldValue(field.name, field.type)
    }

    try {
      await api.submitCommand([activeParty], [{
        CreateCommand: {
          templateId: `${projectName}:Main:${template.name}`,
          createArguments: args,
        },
      }])
      onCreated()
      // Reset non-party fields
      setFieldValues({})
    } catch (err) {
      console.error('Create failed:', err)
    } finally {
      setCreating(false)
    }
  }

  if (templates.length === 0) {
    return (
      <div className="p-3 text-xs text-zinc-500 text-center">
        No templates found. Build your Daml project first.
      </div>
    )
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <Plus className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Create</span>
      </div>

      {/* Template selector */}
      {templates.length > 1 && (
        <select
          value={selectedTemplate}
          onChange={e => {setSelectedTemplate(e.target.value); setFieldValues({})}}
          className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-200 focus:border-canton-500 focus:outline-none"
        >
          {templates.map(t => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      )}

      {templates.length === 1 && (
        <div className="text-xs text-canton-400 font-mono">{templates[0].name}</div>
      )}

      {/* Dynamic fields */}
      {template && (
        <div className="space-y-2">
          {template.fields.map(field => (
            <div key={field.name}>
              <label className="block text-[10px] text-zinc-500 mb-0.5">
                {field.name} <span className="text-zinc-600">: {field.type}</span>
              </label>
              {field.type === 'Party' ? (
                <select
                  value={getFieldValue(field.name, field.type)}
                  onChange={e => setField(field.name, e.target.value)}
                  className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-200 focus:border-canton-500 focus:outline-none"
                >
                  <option value="">Select party...</option>
                  {parties.map(p => (
                    <option key={partyId(p)} value={partyId(p)}>
                      {p.displayName || partyId(p).split('::')[0]}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={getFieldValue(field.name, field.type)}
                  onChange={e => setField(field.name, e.target.value)}
                  placeholder={field.type}
                  className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-canton-500 focus:outline-none"
                />
              )}
            </div>
          ))}

          <button
            onClick={handleCreate}
            disabled={creating || !activeParty}
            className="w-full bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs py-1.5 rounded font-medium transition disabled:opacity-40 flex items-center justify-center gap-1"
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create {template.name}
          </button>
        </div>
      )}
    </div>
  )
}
