import type {
  UpstreamFamily,
  UpstreamFormat,
  UpstreamSourceId,
  UpstreamStabilityClass,
} from '../lib/upstream/manifest.js'

export interface SyncedSpecRegistryEntry {
  sourceId: UpstreamSourceId
  family: UpstreamFamily
  format: UpstreamFormat
  stability: UpstreamStabilityClass
  stableGenerated: boolean
  fetchedAt: string
  selectedSha256: string
  thirdPartyDir: string
  selectedSpecFile: string
  modulePath: string | null
}

export const SYNCED_SPEC_REGISTRY = [
  {
    "sourceId": "canton-json-ledger-api-openapi",
    "family": "ledger-json-api",
    "format": "openapi",
    "stability": "stable-external",
    "stableGenerated": true,
    "fetchedAt": "2026-04-02T20:11:16.928Z",
    "selectedSha256": "72760bdd836ab6316430590d353dbe05c0d7953eb8e59344beced0665e8c0f0d",
    "thirdPartyDir": "third_party/upstream-specs/canton-json-ledger-api-openapi",
    "selectedSpecFile": "third_party/upstream-specs/canton-json-ledger-api-openapi/selected.yaml",
    "modulePath": "src/generated/ledger-json-api/canton-json-ledger-api.ts"
  },
  {
    "sourceId": "splice-scan-external-openapi",
    "family": "scan",
    "format": "openapi",
    "stability": "stable-external",
    "stableGenerated": true,
    "fetchedAt": "2026-04-02T20:11:16.928Z",
    "selectedSha256": "d8c78d8e2b5a69991d2e19d28f2e423dc0cc2a4e8ebd98fc707849f23e99cde3",
    "thirdPartyDir": "third_party/upstream-specs/splice-scan-external-openapi",
    "selectedSpecFile": "third_party/upstream-specs/splice-scan-external-openapi/selected.yaml",
    "modulePath": "src/generated/splice/scan-external.ts"
  },
  {
    "sourceId": "splice-scan-proxy-openapi",
    "family": "validator",
    "format": "openapi",
    "stability": "experimental-internal",
    "stableGenerated": false,
    "fetchedAt": "2026-04-02T20:11:16.928Z",
    "selectedSha256": "8114d4089b873af0eb142798acd4033e770c13c12e7a819880c56d3e088620aa",
    "thirdPartyDir": "third_party/upstream-specs/splice-scan-proxy-openapi",
    "selectedSpecFile": "third_party/upstream-specs/splice-scan-proxy-openapi/selected.yaml",
    "modulePath": null
  },
  {
    "sourceId": "splice-ans-external-openapi",
    "family": "validator",
    "format": "openapi",
    "stability": "stable-external",
    "stableGenerated": true,
    "fetchedAt": "2026-04-02T20:11:16.928Z",
    "selectedSha256": "2999da38ddc9bfdadcf687a18386e3f60de4f96e3697d57a868ffc191f691bc5",
    "thirdPartyDir": "third_party/upstream-specs/splice-ans-external-openapi",
    "selectedSpecFile": "third_party/upstream-specs/splice-ans-external-openapi/selected.yaml",
    "modulePath": "src/generated/splice/ans-external.ts"
  },
  {
    "sourceId": "splice-dapp-api-openrpc",
    "family": "wallet",
    "format": "openrpc",
    "stability": "stable-external",
    "stableGenerated": true,
    "fetchedAt": "2026-04-02T20:11:16.928Z",
    "selectedSha256": "b55b5b59353426e3aa98918a350f16e9d69da083dc88b2818292638bc023a2cb",
    "thirdPartyDir": "third_party/upstream-specs/splice-dapp-api-openrpc",
    "selectedSpecFile": "third_party/upstream-specs/splice-dapp-api-openrpc/selected.json",
    "modulePath": "src/generated/openrpc/dapp-api.ts"
  }
] as const satisfies readonly SyncedSpecRegistryEntry[]

export const STABLE_GENERATED_SOURCE_IDS = [
  "canton-json-ledger-api-openapi",
  "splice-scan-external-openapi",
  "splice-ans-external-openapi",
  "splice-dapp-api-openrpc"
] as const satisfies readonly UpstreamSourceId[]
export const STABLE_GENERATED_OPENAPI_SOURCE_IDS = [
  "canton-json-ledger-api-openapi",
  "splice-scan-external-openapi",
  "splice-ans-external-openapi"
] as const satisfies readonly UpstreamSourceId[]
export const STABLE_GENERATED_OPENRPC_SOURCE_IDS = [
  "splice-dapp-api-openrpc"
] as const satisfies readonly UpstreamSourceId[]

export * as ledgerJsonApi from './ledger-json-api/index.js'
export * as splice from './splice/index.js'
export * as openrpc from './openrpc/index.js'
