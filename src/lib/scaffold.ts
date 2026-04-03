/**
 * @module scaffold
 *
 * Pure scaffolding logic for `cantonctl init`. Built-in template content lives
 * under `assets/templates/`, while common config files are generated from the
 * repo's upstream manifest pins and profile model.
 */

import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import {CantonctlError, ErrorCode} from './errors.js'
import type {ProcessRunner} from './process-runner.js'
import {
  getPinnedCantonSdkVersion,
  getPinnedPublicSdkVersion,
} from './upstream/manifest.js'

export const TEMPLATES = [
  'basic',
  'token',
  'defi-amm',
  'api-service',
  'zenith-evm',
  'splice-token-app',
  'splice-scan-reader',
  'splice-dapp-sdk',
] as const

export type Template = typeof TEMPLATES[number]

type TemplateConfigPreset = 'sandbox' | 'splice'

export interface TemplateManifest {
  configPreset?: TemplateConfigPreset
  description: string
  extraDirectories: string[]
  gitignore: string[]
}

export interface TemplateSummary {
  description: string
  template: Template
}

export interface ScaffoldFileSystem {
  mkdirSync(path: string, opts?: {recursive?: boolean}): void
  writeFileSync(path: string, content: string): void
  existsSync(path: string): boolean
}

export interface ScaffoldOptions {
  dir: string
  fs?: ScaffoldFileSystem
  name: string
  template: Template
}

export interface ScaffoldResult {
  files: string[]
  projectDir: string
  template: Template
}

export interface ScaffoldFromUrlOptions {
  dir: string
  fs?: ScaffoldFileSystem
  runner: ProcessRunner
  url: string
}

interface TemplateRenderContext {
  CANTON_NETWORK_DAPP_SDK_VERSION: string
  CANTON_NETWORK_WALLET_SDK_VERSION: string
  PINNED_CANTON_SDK_VERSION: string
  PROJECT_NAME: string
}

const TEMPLATE_ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/templates',
)
const PINNED_CANTON_SDK_VERSION = getPinnedCantonSdkVersion()
const CANTON_NETWORK_DAPP_SDK_VERSION = getPinnedPublicSdkVersion('canton-network-dapp-sdk')
const CANTON_NETWORK_WALLET_SDK_VERSION = getPinnedPublicSdkVersion('canton-network-wallet-sdk')
const BASE_DIRECTORIES = ['daml', 'test', 'scripts'] as const
const DEFAULT_TEMPLATE_RENDER_CONTEXT: TemplateRenderContext = {
  CANTON_NETWORK_DAPP_SDK_VERSION,
  CANTON_NETWORK_WALLET_SDK_VERSION,
  PINNED_CANTON_SDK_VERSION,
  PROJECT_NAME: 'example-app',
}

export const TEMPLATE_MANIFESTS: Record<Template, TemplateManifest> = Object.fromEntries(
  TEMPLATES.map(template => [template, loadTemplateManifest(template)]),
) as Record<Template, TemplateManifest>

export const TEMPLATE_CHOICES: TemplateSummary[] = TEMPLATES.map(template => ({
  description: TEMPLATE_MANIFESTS[template].description,
  template,
}))

export function scaffoldProject(opts: ScaffoldOptions): ScaffoldResult {
  const fsImpl = opts.fs ?? nodeFs
  const {dir, name, template} = opts

  if (fsImpl.existsSync(dir)) {
    throw new CantonctlError(ErrorCode.CONFIG_DIRECTORY_EXISTS, {
      context: {dir},
      suggestion: `Directory "${name}" already exists. Choose a different name or remove the existing directory.`,
    })
  }

  const manifest = TEMPLATE_MANIFESTS[template]
  const files: string[] = []
  const renderContext = createTemplateRenderContext(name)

  const directories = [
    dir,
    ...BASE_DIRECTORIES.map(baseDir => path.join(dir, baseDir)),
    ...manifest.extraDirectories.map(extraDir => path.join(dir, extraDir)),
  ]

  for (const directory of directories) {
    fsImpl.mkdirSync(directory, {recursive: true})
  }

  const writeFile = (relPath: string, content: string) => {
    const absolutePath = path.join(dir, relPath)
    fsImpl.mkdirSync(path.dirname(absolutePath), {recursive: true})
    fsImpl.writeFileSync(absolutePath, content)
    files.push(relPath)
  }

  writeFile('cantonctl.yaml', generateConfig(name, template))
  writeFile('daml.yaml', generateDamlYaml(name))
  writeFile('.gitignore', generateGitignore(template))

  for (const relPath of listTemplateFiles(template)) {
    writeFile(relPath, readRenderedTemplateFile(template, relPath, renderContext))
  }

  return {files, projectDir: dir, template}
}

export async function scaffoldFromUrl(opts: ScaffoldFromUrlOptions): Promise<void> {
  const fsImpl = opts.fs ?? nodeFs

  const result = await opts.runner.run('git', ['clone', '--depth', '1', opts.url, opts.dir], {
    ignoreExitCode: true,
    timeout: 60_000,
  })

  if (result.exitCode !== 0) {
    throw new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
      context: {stderr: result.stderr, url: opts.url},
      suggestion: `Failed to clone template from ${opts.url}. Check the URL and your network connection.`,
    })
  }

  const manifestPath = path.join(opts.dir, 'cantonctl-template.yaml')
  if (!fsImpl.existsSync(manifestPath)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {url: opts.url},
      suggestion: `The repository at ${opts.url} does not contain a cantonctl-template.yaml manifest. Community templates must include this file.`,
    })
  }
}

export function generateConfig(name: string, template: Template): string {
  const projectBlock = `# cantonctl project configuration
version: 1

project:
  name: ${name}
  sdk-version: "${PINNED_CANTON_SDK_VERSION}"
  template: ${template}

default-profile: sandbox

parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant
`

  if (TEMPLATE_MANIFESTS[template].configPreset === 'splice') {
    return `${projectBlock}
profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575

  splice-devnet:
    kind: remote-validator
    ledger:
      url: https://ledger.example.com
    scan:
      url: https://scan.example.com
    validator:
      url: https://validator.example.com
    tokenStandard:
      url: https://tokens.example.com
    ans:
      url: https://ans.example.com
    auth:
      kind: oidc
      issuer: https://login.example.com

networks:
  local:
    profile: sandbox
  devnet:
    profile: splice-devnet

plugins: []
`
  }

  return `${projectBlock}
profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575

networks:
  local:
    profile: sandbox

plugins: []
`
}

function generateDamlYaml(name: string): string {
  return `sdk-version: ${PINNED_CANTON_SDK_VERSION}
name: ${name}
version: 1.0.0
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
`
}

export function generateDamlSource(template: Template): string {
  return readRenderedTemplateFile(template, path.join('daml', 'Main.daml'))
}

export function generateDamlTest(template: Template): string {
  return readRenderedTemplateFile(template, path.join('test', 'Main.test.daml'))
}

function generateGitignore(template: Template): string {
  const lines = ['.cantonctl/', '.daml/', 'node_modules/', 'dist/', '*.dar']
  lines.push(...TEMPLATE_MANIFESTS[template].gitignore)
  return lines.join('\n') + '\n'
}

function createTemplateRenderContext(projectName: string): TemplateRenderContext {
  return {
    ...DEFAULT_TEMPLATE_RENDER_CONTEXT,
    PROJECT_NAME: projectName,
  }
}

function listTemplateFiles(template: Template): string[] {
  const filesRoot = path.join(getTemplateRoot(template), 'files')
  if (!nodeFs.existsSync(filesRoot)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {template},
      suggestion: `Restore the bundled template files under ${filesRoot}.`,
    })
  }

  return walkFiles(filesRoot).map(filePath => path.relative(filesRoot, filePath)).sort()
}

function walkFiles(directory: string): string[] {
  const results: string[] = []

  for (const entry of nodeFs.readdirSync(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkFiles(entryPath))
      continue
    }

    if (entry.isFile()) {
      results.push(entryPath)
    }
  }

  return results
}

function readRenderedTemplateFile(
  template: Template,
  relPath: string,
  renderContext: TemplateRenderContext = DEFAULT_TEMPLATE_RENDER_CONTEXT,
): string {
  const absolutePath = path.join(getTemplateRoot(template), 'files', relPath)
  if (!nodeFs.existsSync(absolutePath)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {relPath, template},
      suggestion: `Restore the bundled template file ${absolutePath}.`,
    })
  }

  const raw = nodeFs.readFileSync(absolutePath, 'utf8')
  return renderTemplateContent(raw, renderContext)
}

function renderTemplateContent(content: string, renderContext: TemplateRenderContext): string {
  let rendered = content

  for (const [key, value] of Object.entries(renderContext)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value)
  }

  return rendered
}

function loadTemplateManifest(template: Template): TemplateManifest {
  const manifestPath = path.join(getTemplateRoot(template), 'template.json')

  if (!nodeFs.existsSync(manifestPath)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {template},
      suggestion: `Restore the bundled template manifest at ${manifestPath}.`,
    })
  }

  try {
    const parsed = JSON.parse(nodeFs.readFileSync(manifestPath, 'utf8')) as TemplateManifest
    return {
      configPreset: parsed.configPreset ?? 'sandbox',
      description: parsed.description,
      extraDirectories: parsed.extraDirectories ?? [],
      gitignore: parsed.gitignore ?? [],
    }
  } catch (cause) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      cause: cause instanceof Error ? cause : undefined,
      context: {manifestPath, template},
      suggestion: `Fix the bundled template manifest at ${manifestPath}.`,
    })
  }
}

function getTemplateRoot(template: Template): string {
  return path.join(TEMPLATE_ASSET_ROOT, template)
}
