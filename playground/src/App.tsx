import {Columns2, LayoutPanelLeft, Network, WifiOff} from 'lucide-react'
import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {api} from './lib/api'
import {useBuild} from './hooks/useBuild'
import {useContracts} from './hooks/useContracts'
import {useFiles} from './hooks/useFiles'
import {useProfile} from './hooks/useProfile'
import {useTemplates} from './hooks/useTemplates'
import {Editor} from './panels/Editor'
import {FileExplorer} from './panels/FileExplorer'
import {InteractPanel} from './panels/InteractPanel'
import {PartySelector} from './panels/PartySelector'
import {SplitView} from './panels/SplitView'
import {Terminal} from './panels/Terminal'
import {TopologyView} from './panels/TopologyView'

type ViewMode = 'editor' | 'split' | 'topology'

export function App() {
  const files = useFiles()
  const contracts = useContracts()
  const build = useBuild()
  const profile = useProfile()
  const {templates} = useTemplates()
  const [viewMode, setViewMode] = useState<ViewMode>('editor')

  // Get project name from daml.yaml via API
  const {data: projectData} = useQuery({
    queryKey: ['project'],
    queryFn: api.getProject,
    staleTime: 60000,
  })
  const projectName = projectData?.name ?? 'my-app'

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50 bg-canton-950 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-tight">
            <span className="text-canton-400">Canton</span>
            <span className="text-zinc-300"> Playground</span>
          </h1>
          <div className="h-4 w-px bg-zinc-800" />
          {profile.profiles.length > 0 && (
            <>
              <select
                value={profile.selectedProfile?.name ?? ''}
                onChange={(event) => { void profile.switchProfile(event.target.value) }}
                disabled={profile.switching}
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px] rounded px-2 py-1 outline-none"
              >
                {profile.profiles.map(entry => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name} ({entry.kind})
                  </option>
                ))}
              </select>
              <div className="h-4 w-px bg-zinc-800" />
            </>
          )}
          <PartySelector
            parties={contracts.parties}
            activeParty={contracts.activeParty}
            onSelect={contracts.setActiveParty}
          />
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex bg-zinc-800/50 rounded-md p-0.5">
            <button
              onClick={() => setViewMode('editor')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                viewMode === 'editor'
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <LayoutPanelLeft className="h-3 w-3" />
              Editor
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                viewMode === 'split'
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Columns2 className="h-3 w-3" />
              Multi-Party
            </button>
            <button
              onClick={() => setViewMode('topology')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition ${
                viewMode === 'topology'
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Network className="h-3 w-3" />
              Topology
            </button>
          </div>

          {/* Connection status */}
          {build.connected ? (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow shadow-emerald-400/50" />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <WifiOff className="h-3 w-3 text-red-400" />
              <span>Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File Explorer (always visible) */}
        <div className="w-48 shrink-0 border-r border-zinc-800/50 overflow-hidden">
          <FileExplorer
            files={files.fileTree}
            activeFile={files.activeFile}
            onFileSelect={files.openFile}
          />
        </div>

        {viewMode === 'editor' ? (
          <>
            {/* Center: Editor + Terminal */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <Editor
                  activeFile={files.activeFile}
                  content={files.fileContent}
                  openTabs={files.openTabs}
                  saving={files.saving}
                  onContentChange={files.setFileContent}
                  onSave={files.saveFile}
                  onTabSelect={(tab) => files.openFile(tab)}
                  onTabClose={files.closeTab}
                />
              </div>
              <div className="h-48 shrink-0 border-t border-zinc-800/50">
                <Terminal
                  logs={build.logs}
                  building={build.building}
                  testing={build.testing}
                  onBuild={build.triggerBuild}
                  onTest={build.triggerTest}
                />
              </div>
            </div>

            {/* Right: Interact Panel */}
            <div className="w-64 shrink-0 border-l border-zinc-800/50 overflow-hidden">
              <InteractPanel
                parties={contracts.parties}
                activeParty={contracts.activeParty}
                contracts={contracts.contracts}
                templates={templates}
                projectName={projectName}
                loading={contracts.loading}
                onRefresh={() => contracts.refetch()}
                onContractChange={() => contracts.refetch()}
              />
            </div>
          </>
        ) : viewMode === 'split' ? (
          /* Split View: Multi-Party */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <SplitView
                parties={contracts.parties}
                templates={templates}
                projectName={projectName}
              />
            </div>
            <div className="h-40 shrink-0 border-t border-zinc-800/50">
              <Terminal
                logs={build.logs}
                building={build.building}
                testing={build.testing}
                onBuild={build.triggerBuild}
                onTest={build.triggerTest}
              />
            </div>
          </div>
        ) : (
          /* Topology View */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <TopologyView activeParty={contracts.activeParty} />
            </div>
            <div className="h-40 shrink-0 border-t border-zinc-800/50">
              <Terminal
                logs={build.logs}
                building={build.building}
                testing={build.testing}
                onBuild={build.triggerBuild}
                onTest={build.triggerTest}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
