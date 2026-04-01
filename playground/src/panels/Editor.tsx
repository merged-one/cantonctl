import MonacoEditor, {type OnMount} from '@monaco-editor/react'
import {X} from 'lucide-react'
import {useCallback, useRef} from 'react'
import {DAML_LANGUAGE_ID, damlLanguageConfig, damlTokensProvider} from '../lib/daml-language'

interface EditorProps {
  activeFile: string | null
  content: string
  openTabs: string[]
  saving: boolean
  onContentChange: (content: string) => void
  onSave: (path: string, content: string) => void
  onTabSelect: (path: string) => void
  onTabClose: (path: string) => void
}

function getLanguage(filePath: string): string {
  if (filePath.endsWith('.daml')) return DAML_LANGUAGE_ID
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml'
  if (filePath.endsWith('.json')) return 'json'
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript'
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript'
  if (filePath.endsWith('.sol')) return 'sol'
  if (filePath.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

export function Editor({activeFile, content, openTabs, saving, onContentChange, onSave, onTabSelect, onTabClose}: EditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const damlRegistered = useRef(false)

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Register Daml language (once)
    if (!damlRegistered.current) {
      monaco.languages.register({id: DAML_LANGUAGE_ID})
      monaco.languages.setMonarchTokensProvider(DAML_LANGUAGE_ID, damlTokensProvider)
      monaco.languages.setLanguageConfiguration(DAML_LANGUAGE_ID, damlLanguageConfig)
      damlRegistered.current = true
    }

    // Ctrl+S / Cmd+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile) {
        onSave(activeFile, editor.getValue())
      }
    })
  }, [activeFile, onSave])

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900/30">
        <div className="text-center">
          <p className="text-zinc-500 text-sm">Select a file to edit</p>
          <p className="text-zinc-600 text-xs mt-1">or press Ctrl+S to save</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800/50 bg-canton-950 overflow-x-auto">
        {openTabs.map(tab => {
          const fileName = tab.split('/').pop() ?? tab
          const isActive = tab === activeFile
          return (
            <div
              key={tab}
              className={`group flex items-center gap-1 px-3 py-1.5 text-xs border-r border-zinc-800/50 cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-zinc-900 text-zinc-100 border-b-2 border-b-canton-500'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'
              }`}
            >
              <span onClick={() => onTabSelect(tab)}>{fileName}</span>
              <button
                onClick={(e) => {e.stopPropagation(); onTabClose(tab)}}
                className="ml-1 opacity-0 group-hover:opacity-100 hover:text-zinc-100 transition"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
        {saving && (
          <div className="flex items-center px-3 text-[10px] text-canton-400">
            Saving...
          </div>
        )}
      </div>

      {/* Monaco editor */}
      <div className="flex-1">
        <MonacoEditor
          language={getLanguage(activeFile)}
          value={content}
          theme="vs-dark"
          onMount={handleMount}
          onChange={(value) => onContentChange(value ?? '')}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            padding: {top: 12},
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            bracketPairColorization: {enabled: true},
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  )
}
