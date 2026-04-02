import {createHash} from 'node:crypto'
import {mkdir, readdir, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import yaml from 'js-yaml'

import {getUpstreamSource} from '../../src/lib/upstream/manifest.ts'

const SYNCED_SOURCE_IDS = [
  'canton-json-ledger-api-openapi',
  'splice-scan-external-openapi',
  'splice-scan-proxy-openapi',
  'splice-ans-external-openapi',
  'splice-dapp-api-openrpc',
]

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..')
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'third_party', 'upstream-specs')
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json')

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDocument(rawContent, fileExtension) {
  if (fileExtension === '.json') {
    return JSON.parse(rawContent)
  }

  const parsed = yaml.load(rawContent)
  if (!isObject(parsed)) {
    throw new Error(`Expected object-like upstream document, received ${typeof parsed}`)
  }

  return parsed
}

function serializeDocument(document, fileExtension) {
  if (fileExtension === '.json') {
    return `${JSON.stringify(document, null, 2)}\n`
  }

  return yaml.dump(document, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
}

function extractExternalRefs(node, refs = new Set()) {
  if (Array.isArray(node)) {
    for (const value of node) {
      extractExternalRefs(value, refs)
    }

    return refs
  }

  if (!isObject(node)) {
    return refs
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      refs.add(value)
      continue
    }

    extractExternalRefs(value, refs)
  }

  return refs
}

function toGitHubRawUrl(repoUrl, ref, repoPath) {
  const repoPathname = repoUrl.replace('https://github.com/', '')
  return `https://raw.githubusercontent.com/${repoPathname}/${ref}/${repoPath}`
}

async function mirrorOpenApiSupportFiles({document, outputDirectory, source}) {
  const mirroredDependencies = []
  const seenRepoPaths = new Set([source.source.path])
  const queue = [{document, repoPath: source.source.path}]

  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) {
      break
    }

    for (const refValue of extractExternalRefs(next.document)) {
      const [relativePath] = refValue.split('#')
      if (!relativePath || /^https?:\/\//.test(relativePath)) {
        continue
      }

      const resolvedRepoPath = path.posix.normalize(path.posix.join(path.posix.dirname(next.repoPath), relativePath))
      if (seenRepoPaths.has(resolvedRepoPath)) {
        continue
      }

      const dependencyUrl = toGitHubRawUrl(source.source.repo, source.source.ref, resolvedRepoPath)
      const dependencyContent = await fetchText(dependencyUrl)
      const dependencyExtension = path.extname(resolvedRepoPath) || '.yaml'
      const dependencyDocument = parseDocument(dependencyContent, dependencyExtension)
      const mirrorDependencyPath = path.join(outputDirectory, 'mirror', ...resolvedRepoPath.split('/'))

      await mkdir(path.dirname(mirrorDependencyPath), {recursive: true})
      await writeFile(mirrorDependencyPath, dependencyContent)

      mirroredDependencies.push({
        path: `mirror/${resolvedRepoPath}`,
        sha256: sha256(dependencyContent),
      })
      seenRepoPaths.add(resolvedRepoPath)
      queue.push({document: dependencyDocument, repoPath: resolvedRepoPath})
    }
  }

  return mirroredDependencies
}

function matchesTags(tags, selector) {
  if (!selector.tagsAllOf?.length && !selector.tagsNoneOf?.length) {
    return true
  }

  const tagList = Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string') : []
  const tagSet = new Set(tagList)

  if (selector.tagsAllOf?.some(tag => !tagSet.has(tag))) {
    return false
  }

  if (selector.tagsNoneOf?.some(tag => tagSet.has(tag))) {
    return false
  }

  return true
}

function matchesPath(pathname, selector) {
  if (!selector.pathPrefixes?.length) {
    return true
  }

  return selector.pathPrefixes.some(prefix => pathname.startsWith(prefix))
}

function applyOpenApiSelector(document, selector) {
  if (!selector) {
    return document
  }

  const inputPaths = isObject(document.paths) ? document.paths : {}
  const filteredPaths = {}

  for (const [pathname, pathItem] of Object.entries(inputPaths)) {
    if (!matchesPath(pathname, selector) || !isObject(pathItem)) {
      continue
    }

    const retainedPathItem = {}
    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key)) {
        retainedPathItem[key] = value
        continue
      }

      if (isObject(value) && matchesTags(value.tags, selector)) {
        retainedPathItem[key] = value
      }
    }

    const retainedOperationCount = Object.keys(retainedPathItem).filter(key => HTTP_METHODS.has(key)).length
    if (retainedOperationCount > 0) {
      filteredPaths[pathname] = retainedPathItem
    }
  }

  const retainedTagNames = new Set()
  for (const pathItem of Object.values(filteredPaths)) {
    if (!isObject(pathItem)) {
      continue
    }

    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(key) || !isObject(value) || !Array.isArray(value.tags)) {
        continue
      }

      for (const tag of value.tags) {
        if (typeof tag === 'string') {
          retainedTagNames.add(tag)
        }
      }
    }
  }

  return {
    ...document,
    paths: filteredPaths,
    tags: Array.isArray(document.tags)
      ? document.tags.filter(tag => isObject(tag) && typeof tag.name === 'string' && retainedTagNames.has(tag.name))
      : document.tags,
  }
}

function applySelector(document, source) {
  if (!source.selector) {
    return document
  }

  if (source.format !== 'openapi') {
    throw new Error(`Unsupported selector on non-OpenAPI source ${source.id}`)
  }

  return applyOpenApiSelector(document, source.selector)
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'cantonctl-spec-sync/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  }

  return response.text()
}

async function cleanManagedDirectories() {
  await mkdir(OUTPUT_ROOT, {recursive: true})

  const managedIds = new Set(SYNCED_SOURCE_IDS)
  const entries = await readdir(OUTPUT_ROOT, {withFileTypes: true})
  for (const entry of entries) {
    if (entry.isDirectory() && !managedIds.has(entry.name)) {
      await rm(path.join(OUTPUT_ROOT, entry.name), {force: true, recursive: true})
    }
  }
}

async function main() {
  await cleanManagedDirectories()

  const fetchedAt = new Date().toISOString()
  const manifestEntries = []

  for (const sourceId of SYNCED_SOURCE_IDS) {
    const source = getUpstreamSource(sourceId)
    if (source.source.kind !== 'git') {
      throw new Error(`Expected git-backed upstream source for ${sourceId}`)
    }

    const fileExtension = path.extname(source.source.path) || (source.format === 'openrpc' ? '.json' : '.yaml')
    const outputDirectory = path.join(OUTPUT_ROOT, source.id)
    const sourceFileName = `source${fileExtension}`
    const selectedFileName = `selected${fileExtension}`

    const rawContent = await fetchText(source.source.url)
    const selectedDocument = source.format === 'openapi'
      ? source.selector
        ? applySelector(parseDocument(rawContent, fileExtension), source)
        : parseDocument(rawContent, fileExtension)
      : null
    const selectedContent = source.selector && selectedDocument
      ? serializeDocument(selectedDocument, fileExtension)
      : rawContent

    await rm(outputDirectory, {force: true, recursive: true})
    await mkdir(outputDirectory, {recursive: true})

    const mirrorEntry = source.format === 'openapi' ? `mirror/${source.source.path}` : null
    if (mirrorEntry) {
      const mirrorEntryPath = path.join(outputDirectory, ...mirrorEntry.split('/'))
      await mkdir(path.dirname(mirrorEntryPath), {recursive: true})
      await writeFile(mirrorEntryPath, selectedContent)
    }

    const mirroredDependencies = selectedDocument
      ? await mirrorOpenApiSupportFiles({document: selectedDocument, outputDirectory, source})
      : []

    const metadata = {
      version: 1,
      sourceId: source.id,
      name: source.name,
      family: source.family,
      stability: source.stability,
      format: source.format,
      artifactVersion: source.artifactVersion ?? null,
      fetchedAt,
      selectorApplied: Boolean(source.selector),
      selector: source.selector ?? null,
      upstream: source.source,
      files: {
        source: sourceFileName,
        selected: selectedFileName,
      },
      mirror: mirrorEntry
        ? {
          entry: mirrorEntry,
          dependencies: mirroredDependencies,
        }
        : null,
      hashes: {
        sourceSha256: sha256(rawContent),
        selectedSha256: sha256(selectedContent),
      },
    }

    await writeFile(path.join(outputDirectory, sourceFileName), rawContent)
    await writeFile(path.join(outputDirectory, selectedFileName), selectedContent)
    await writeFile(path.join(outputDirectory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`)

    manifestEntries.push({
      ...metadata,
      directory: source.id,
    })

    console.log(`synced ${source.id}`)
  }

  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify({
      version: 1,
      generatedAt: fetchedAt,
      syncedSourceIds: SYNCED_SOURCE_IDS,
      sources: manifestEntries,
    }, null, 2)}\n`,
  )

  console.log(`wrote ${path.relative(PROJECT_ROOT, MANIFEST_PATH)}`)
}

await main()
