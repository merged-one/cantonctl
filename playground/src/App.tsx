import {WifiOff} from 'lucide-react'
import {useBuild} from './hooks/useBuild'
import {useContracts} from './hooks/useContracts'
import {useFiles} from './hooks/useFiles'
import {Editor} from './panels/Editor'
import {FileExplorer} from './panels/FileExplorer'
import {InteractPanel} from './panels/InteractPanel'
import {PartySelector} from './panels/PartySelector'
import {Terminal} from './panels/Terminal'

export function App() {
  const files = useFiles()
  const contracts = useContracts()
  const build = useBuild()

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
          <PartySelector
            parties={contracts.parties}
            activeParty={contracts.activeParty}
            onSelect={contracts.setActiveParty}
          />
        </div>
        <div className="flex items-center gap-2">
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

      {/* Main content — 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: File Explorer */}
        <div className="w-48 shrink-0 border-r border-zinc-800/50 overflow-hidden">
          <FileExplorer
            files={files.fileTree}
            activeFile={files.activeFile}
            onFileSelect={files.openFile}
          />
        </div>

        {/* Center: Editor */}
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

          {/* Bottom: Terminal */}
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
            loading={contracts.loading}
            onRefresh={() => contracts.refetch()}
            onContractChange={() => contracts.refetch()}
          />
        </div>
      </div>
    </div>
  )
}
