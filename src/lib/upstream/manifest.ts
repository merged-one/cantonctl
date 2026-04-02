export const UPSTREAM_STABILITY_CLASSES = [
  'stable-external',
  'stable-daml-interface',
  'public-sdk',
  'experimental-internal',
  'operator-only',
] as const

export type UpstreamStabilityClass = typeof UPSTREAM_STABILITY_CLASSES[number]

export const UPSTREAM_FORMATS = ['openapi', 'openrpc', 'daml-interface', 'npm-package'] as const
export type UpstreamFormat = typeof UPSTREAM_FORMATS[number]

export const UPSTREAM_INTENDED_USES = [
  'generate-client',
  'generate-bindings',
  'runtime-integration',
  'compatibility-check',
  'manual-reference',
] as const

export type UpstreamIntendedUse = typeof UPSTREAM_INTENDED_USES[number]

export const UPSTREAM_FAMILIES = [
  'ledger-json-api',
  'scan',
  'validator',
  'wallet',
  'token-standard',
  'sdk',
] as const

export type UpstreamFamily = typeof UPSTREAM_FAMILIES[number]

export interface UpstreamSelector {
  tagsAllOf?: readonly string[]
  tagsNoneOf?: readonly string[]
  pathPrefixes?: readonly string[]
}

export interface GitUpstreamSourceLocation {
  kind: 'git'
  repo: string
  ref: string
  path: string
  url: string
}

export interface NpmUpstreamSourceLocation {
  kind: 'npm'
  packageName: string
  version: string
  packageUrl: string
  tarballUrl: string
}

export type UpstreamSourceLocation = GitUpstreamSourceLocation | NpmUpstreamSourceLocation

export interface UpstreamSource {
  id: string
  name: string
  family: UpstreamFamily
  stability: UpstreamStabilityClass
  format: UpstreamFormat
  intendedUse: readonly UpstreamIntendedUse[]
  source: UpstreamSourceLocation
  artifactVersion?: string
  selector?: UpstreamSelector
  notes?: string
}

export interface UpstreamManifest {
  version: 1
  policy: {
    generatedArtifactsMustUseManifest: true
    notes: readonly string[]
  }
  sources: readonly UpstreamSource[]
}

const CANTON_REPO = 'digital-asset/canton'
const CANTON_LEDGER_OPENAPI_TAG = 'v3.4.11'
const CANTON_LEDGER_OPENAPI_PATH =
  'community/ledger/ledger-json-api/src/test/resources/json-api-docs/openapi.yaml'

const SPLICE_REPO = 'hyperledger-labs/splice'
const SPLICE_REF = '275c31b8545ba33e66576e8298521e251eb34b21'

const WALLET_KERNEL_REPO = 'hyperledger-labs/splice-wallet-kernel'
const WALLET_KERNEL_REF = '84e89330978979d4df8905bc67939b6473f23d1c'

function githubRawUrl(repo: string, ref: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`
}

function npmPackageUrl(packageName: string, version: string): string {
  return `https://www.npmjs.com/package/${packageName}/v/${version}`
}

function npmTarballUrl(packageName: string, tarballName: string, version: string): string {
  return `https://registry.npmjs.org/${packageName}/-/${tarballName}-${version}.tgz`
}

export const UPSTREAM_MANIFEST = {
  version: 1,
  policy: {
    generatedArtifactsMustUseManifest: true,
    notes: [
      'Generate clients and bindings only from manifest entries whose intendedUse includes generate-client or generate-bindings.',
      'Do not hard-code upstream URLs in README, CI, scaffold defaults, or ad hoc scripts.',
      'experimental-internal and operator-only entries are reference-only until a later milestone promotes them.',
    ],
  },
  sources: [
    {
      id: 'canton-json-ledger-api-openapi',
      name: 'Canton JSON Ledger API OpenAPI',
      family: 'ledger-json-api',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: CANTON_LEDGER_OPENAPI_PATH,
        ref: CANTON_LEDGER_OPENAPI_TAG,
        repo: `https://github.com/${CANTON_REPO}`,
        url: githubRawUrl(CANTON_REPO, CANTON_LEDGER_OPENAPI_TAG, CANTON_LEDGER_OPENAPI_PATH),
      },
      artifactVersion: '3.5.0-SNAPSHOT',
      notes:
        'Pinned to the Canton v3.4.11 release tag used by this repo. The upstream file advertises a 3.5.0-SNAPSHOT spec version; retain the tag pin as the source-of-truth fetch target.',
    },
    {
      id: 'splice-scan-external-openapi',
      name: 'Splice Scan external API',
      family: 'scan',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'apps/scan/src/main/openapi/scan.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/scan/src/main/openapi/scan.yaml'),
      },
      artifactVersion: '0.0.1',
      selector: {
        tagsAllOf: ['external', 'scan'],
        tagsNoneOf: ['internal', 'pre-alpha'],
      },
      notes: 'This spec mixes external and internal tags. Consumers must filter to the external subset declared above.',
    },
    {
      id: 'splice-scan-proxy-openapi',
      name: 'Splice Scan proxy API',
      family: 'validator',
      stability: 'experimental-internal',
      format: 'openapi',
      intendedUse: ['compatibility-check', 'manual-reference'],
      source: {
        kind: 'git',
        path: 'apps/validator/src/main/openapi/scan-proxy.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/validator/src/main/openapi/scan-proxy.yaml'),
      },
      artifactVersion: '0.0.1',
      selector: {
        pathPrefixes: ['/v0/scan-proxy/'],
      },
      notes: 'Keep reference-only until a later milestone proves the proxy contract is stable enough to automate against.',
    },
    {
      id: 'splice-ans-external-openapi',
      name: 'Splice ANS external API',
      family: 'validator',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'apps/validator/src/main/openapi/ans-external.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/validator/src/main/openapi/ans-external.yaml'),
      },
      artifactVersion: '0.0.1',
    },
    {
      id: 'splice-validator-internal-openapi',
      name: 'Splice validator internal API',
      family: 'validator',
      stability: 'operator-only',
      format: 'openapi',
      intendedUse: ['compatibility-check', 'manual-reference'],
      source: {
        kind: 'git',
        path: 'apps/validator/src/main/openapi/validator-internal.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/validator/src/main/openapi/validator-internal.yaml'),
      },
      artifactVersion: '0.0.1',
      notes: 'Treat as operator-facing and reference-only for now. Do not generate public clients from this surface.',
    },
    {
      id: 'splice-wallet-external-openapi',
      name: 'Splice wallet external API',
      family: 'wallet',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'apps/wallet/src/main/openapi/wallet-external.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/wallet/src/main/openapi/wallet-external.yaml'),
      },
      artifactVersion: '0.0.1',
    },
    {
      id: 'splice-wallet-internal-openapi',
      name: 'Splice wallet internal API',
      family: 'wallet',
      stability: 'experimental-internal',
      format: 'openapi',
      intendedUse: ['compatibility-check', 'manual-reference'],
      source: {
        kind: 'git',
        path: 'apps/wallet/src/main/openapi/wallet-internal.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'apps/wallet/src/main/openapi/wallet-internal.yaml'),
      },
      artifactVersion: '0.0.1',
      notes: 'Keep out of public code generation until the internal wallet surface is explicitly promoted upstream.',
    },
    {
      id: 'splice-dapp-api-openrpc',
      name: 'Splice Wallet Gateway dApp API',
      family: 'wallet',
      stability: 'stable-external',
      format: 'openrpc',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'api-specs/openrpc-dapp-api.json',
        ref: WALLET_KERNEL_REF,
        repo: `https://github.com/${WALLET_KERNEL_REPO}`,
        url: githubRawUrl(WALLET_KERNEL_REPO, WALLET_KERNEL_REF, 'api-specs/openrpc-dapp-api.json'),
      },
      artifactVersion: '0.5.0',
      notes: 'This is the public dApp-facing OpenRPC contract behind CIP-0103 style wallet connectivity.',
    },
    {
      id: 'splice-dapp-remote-api-openrpc',
      name: 'Splice Wallet Gateway remote dApp API',
      family: 'wallet',
      stability: 'stable-external',
      format: 'openrpc',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'api-specs/openrpc-dapp-remote-api.json',
        ref: WALLET_KERNEL_REF,
        repo: `https://github.com/${WALLET_KERNEL_REPO}`,
        url: githubRawUrl(
          WALLET_KERNEL_REPO,
          WALLET_KERNEL_REF,
          'api-specs/openrpc-dapp-remote-api.json',
        ),
      },
      artifactVersion: '0.1.0',
      notes: 'Use when the wallet provider is remotely hosted rather than injected directly into the browser context.',
    },
    {
      id: 'splice-wallet-user-api-openrpc',
      name: 'Splice Wallet Gateway user API',
      family: 'wallet',
      stability: 'operator-only',
      format: 'openrpc',
      intendedUse: ['compatibility-check', 'manual-reference'],
      source: {
        kind: 'git',
        path: 'api-specs/openrpc-user-api.json',
        ref: WALLET_KERNEL_REF,
        repo: `https://github.com/${WALLET_KERNEL_REPO}`,
        url: githubRawUrl(WALLET_KERNEL_REPO, WALLET_KERNEL_REF, 'api-specs/openrpc-user-api.json'),
      },
      artifactVersion: '0.1.0',
      notes: 'Reference-only for wallet-management and operator-facing flows. Not a public dApp integration surface.',
    },
    {
      id: 'canton-network-dapp-sdk',
      name: '@canton-network/dapp-sdk',
      family: 'sdk',
      stability: 'public-sdk',
      format: 'npm-package',
      intendedUse: ['runtime-integration', 'compatibility-check'],
      source: {
        kind: 'npm',
        packageName: '@canton-network/dapp-sdk',
        version: '0.24.0',
        packageUrl: npmPackageUrl('@canton-network/dapp-sdk', '0.24.0'),
        tarballUrl: npmTarballUrl('@canton-network/dapp-sdk', 'dapp-sdk', '0.24.0'),
      },
      notes: 'Prefer importing this package directly instead of regenerating an SDK from the dApp OpenRPC files.',
    },
    {
      id: 'canton-network-wallet-sdk',
      name: '@canton-network/wallet-sdk',
      family: 'sdk',
      stability: 'public-sdk',
      format: 'npm-package',
      intendedUse: ['runtime-integration', 'compatibility-check'],
      source: {
        kind: 'npm',
        packageName: '@canton-network/wallet-sdk',
        version: '0.21.1',
        packageUrl: npmPackageUrl('@canton-network/wallet-sdk', '0.21.1'),
        tarballUrl: npmTarballUrl('@canton-network/wallet-sdk', 'wallet-sdk', '0.21.1'),
      },
      notes: 'Pin the published package version, not the repo workspace version, for downstream compatibility checks.',
    },
    {
      id: 'splice-token-metadata-openapi',
      name: 'Splice Token Standard metadata API',
      family: 'token-standard',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-metadata-v1/openapi/token-metadata-v1.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-metadata-v1/openapi/token-metadata-v1.yaml',
        ),
      },
      artifactVersion: '1.0.0',
    },
    {
      id: 'splice-token-allocation-openapi',
      name: 'Splice Token Standard allocation API',
      family: 'token-standard',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-allocation-v1/openapi/allocation-v1.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-allocation-v1/openapi/allocation-v1.yaml',
        ),
      },
      artifactVersion: '1.1.0',
    },
    {
      id: 'splice-token-allocation-instruction-openapi',
      name: 'Splice Token Standard allocation instruction API',
      family: 'token-standard',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-allocation-instruction-v1/openapi/allocation-instruction-v1.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-allocation-instruction-v1/openapi/allocation-instruction-v1.yaml',
        ),
      },
      artifactVersion: '1.0.0',
    },
    {
      id: 'splice-token-transfer-instruction-openapi',
      name: 'Splice Token Standard transfer instruction API',
      family: 'token-standard',
      stability: 'stable-external',
      format: 'openapi',
      intendedUse: ['generate-client', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-transfer-instruction-v1/openapi/transfer-instruction-v1.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-transfer-instruction-v1/openapi/transfer-instruction-v1.yaml',
        ),
      },
      artifactVersion: '1.1.0',
    },
    {
      id: 'splice-token-metadata-daml',
      name: 'Splice Token Standard metadata Daml interface',
      family: 'token-standard',
      stability: 'stable-daml-interface',
      format: 'daml-interface',
      intendedUse: ['generate-bindings', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-metadata-v1/daml.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'token-standard/splice-api-token-metadata-v1/daml.yaml'),
      },
      artifactVersion: '1.0.0',
      notes: 'Stable Daml data-dependency anchor for token metadata contracts.',
    },
    {
      id: 'splice-token-holding-daml',
      name: 'Splice Token Standard holding Daml interface',
      family: 'token-standard',
      stability: 'stable-daml-interface',
      format: 'daml-interface',
      intendedUse: ['generate-bindings', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-holding-v1/daml.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'token-standard/splice-api-token-holding-v1/daml.yaml'),
      },
      artifactVersion: '1.0.0',
      notes: 'Stable Daml data-dependency anchor for token holding contracts.',
    },
    {
      id: 'splice-token-allocation-daml',
      name: 'Splice Token Standard allocation Daml interface',
      family: 'token-standard',
      stability: 'stable-daml-interface',
      format: 'daml-interface',
      intendedUse: ['generate-bindings', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-allocation-v1/daml.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(SPLICE_REPO, SPLICE_REF, 'token-standard/splice-api-token-allocation-v1/daml.yaml'),
      },
      artifactVersion: '1.0.0',
      notes: 'Stable Daml data-dependency anchor for allocation contracts.',
    },
    {
      id: 'splice-token-allocation-instruction-daml',
      name: 'Splice Token Standard allocation instruction Daml interface',
      family: 'token-standard',
      stability: 'stable-daml-interface',
      format: 'daml-interface',
      intendedUse: ['generate-bindings', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-allocation-instruction-v1/daml.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-allocation-instruction-v1/daml.yaml',
        ),
      },
      artifactVersion: '1.0.0',
      notes: 'Stable Daml data-dependency anchor for allocation instruction contracts.',
    },
    {
      id: 'splice-token-transfer-instruction-daml',
      name: 'Splice Token Standard transfer instruction Daml interface',
      family: 'token-standard',
      stability: 'stable-daml-interface',
      format: 'daml-interface',
      intendedUse: ['generate-bindings', 'compatibility-check'],
      source: {
        kind: 'git',
        path: 'token-standard/splice-api-token-transfer-instruction-v1/daml.yaml',
        ref: SPLICE_REF,
        repo: `https://github.com/${SPLICE_REPO}`,
        url: githubRawUrl(
          SPLICE_REPO,
          SPLICE_REF,
          'token-standard/splice-api-token-transfer-instruction-v1/daml.yaml',
        ),
      },
      artifactVersion: '1.0.0',
      notes: 'Stable Daml data-dependency anchor for transfer instruction contracts.',
    },
  ],
} as const satisfies UpstreamManifest

export type UpstreamSourceId = typeof UPSTREAM_MANIFEST.sources[number]['id']

export const UPSTREAM_SOURCES = UPSTREAM_MANIFEST.sources

export const UPSTREAM_SOURCES_BY_ID = Object.fromEntries(
  UPSTREAM_SOURCES.map(source => [source.id, source]),
) as {[K in UpstreamSourceId]: Extract<typeof UPSTREAM_SOURCES[number], {id: K}>}

export function getUpstreamSource(id: UpstreamSourceId): (typeof UPSTREAM_SOURCES)[number] {
  return UPSTREAM_SOURCES_BY_ID[id]
}
