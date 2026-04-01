import {ChevronDown, ChevronRight, File, FolderOpen} from 'lucide-react'
import {useState} from 'react'
import type {FileNode} from '../lib/api'

interface FileExplorerProps {
  files: FileNode[]
  activeFile: string | null
  onFileSelect: (path: string) => void
}

function TreeNode({node, depth, activeFile, onFileSelect}: {
  node: FileNode
  depth: number
  activeFile: string | null
  onFileSelect: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const isActive = node.path === activeFile

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-xs hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition"
          style={{paddingLeft: `${depth * 12 + 8}px`}}
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 shrink-0" />
            : <ChevronRight className="h-3 w-3 shrink-0" />}
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-canton-400" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    )
  }

  const isDaml = node.name.endsWith('.daml')
  const isYaml = node.name.endsWith('.yaml') || node.name.endsWith('.yml')

  return (
    <button
      onClick={() => onFileSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs transition ${
        isActive
          ? 'bg-canton-600/20 text-canton-300'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
      style={{paddingLeft: `${depth * 12 + 8}px`}}
    >
      <File className={`h-3.5 w-3.5 shrink-0 ${
        isDaml ? 'text-emerald-400' : isYaml ? 'text-amber-400' : 'text-zinc-500'
      }`} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export function FileExplorer({files, activeFile, onFileSelect}: FileExplorerProps) {
  return (
    <div className="h-full flex flex-col bg-canton-950">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/50">
        Explorer
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </div>
  )
}
