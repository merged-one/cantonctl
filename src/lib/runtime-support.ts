import {execFile} from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

type DirEntry = {isDirectory(): boolean; name: string}

export async function findDarFile(
  dir: string,
  deps: {
    join?: typeof path.join
    readdir?: typeof fs.promises.readdir
  } = {},
): Promise<string | null> {
  const join = deps.join ?? path.join
  const readDir = deps.readdir ?? fs.promises.readdir

  try {
    const entries = await readDir(dir)
    const darFile = entries.find(entry => entry.endsWith('.dar'))
    return darFile ? join(dir, darFile) : null
  } catch {
    return null
  }
}

export async function getFileMtime(
  filePath: string,
  deps: {
    stat?: typeof fs.promises.stat
  } = {},
): Promise<number | null> {
  const stat = deps.stat ?? fs.promises.stat

  try {
    const result = await stat(filePath)
    return result.mtimeMs
  } catch {
    return null
  }
}

export async function getNewestDamlSourceMtime(
  dir: string,
  deps: {
    join?: typeof path.join
    readdir?: typeof fs.promises.readdir
    stat?: typeof fs.promises.stat
  } = {},
): Promise<number> {
  const join = deps.join ?? path.join
  const readDir = deps.readdir ?? fs.promises.readdir
  const stat = deps.stat ?? fs.promises.stat

  let newest = 0

  try {
    const entries = await readDir(dir, {withFileTypes: true}) as unknown as DirEntry[]
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const child = await getNewestDamlSourceMtime(fullPath, deps)
        if (child > newest) {
          newest = child
        }
      } else if (entry.name.endsWith('.daml')) {
        const fileStat = await stat(fullPath)
        if (fileStat.mtimeMs > newest) {
          newest = fileStat.mtimeMs
        }
      }
    }
  } catch {
    return newest
  }

  return newest
}

export function isTcpPortInUse(
  port: number,
  deps: {
    createServer?: typeof net.createServer
    host?: string
  } = {},
): Promise<boolean> {
  const createServer = deps.createServer ?? net.createServer
  const host = deps.host ?? '127.0.0.1'

  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE')
    })
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, host)
  })
}

export function openBrowserUrl(
  url: string,
  deps: {
    execFile?: typeof execFile
    platform?: NodeJS.Platform
  } = {},
): void {
  const execFileImpl = deps.execFile ?? execFile
  const platform = deps.platform ?? process.platform
  const command = platform === 'darwin'
    ? {file: 'open', args: [url]}
    : platform === 'win32'
      ? {file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url]}
      : {file: 'xdg-open', args: [url]}

  const child = execFileImpl(command.file, command.args, () => {})
  child.on('error', () => {})
}
