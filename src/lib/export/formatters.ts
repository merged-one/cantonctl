import type {ExportedSdkConfig} from './sdk-config.js'

export function renderSdkConfigJson(config: ExportedSdkConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function renderSdkConfigEnv(config: ExportedSdkConfig): string {
  const lines = [
    `CANTONCTL_PROFILE=${config.profile.name}`,
    `CANTONCTL_NETWORK=${config.profile.network}`,
    `CANTONCTL_SDK_TARGET=${config.target}`,
    `CANTONCTL_CIP_STANDARD=${config.cip}`,
    config.endpoints.scanUrl ? `SPLICE_SCAN_URL=${config.endpoints.scanUrl}` : undefined,
    config.endpoints.ledgerUrl ? `CANTON_LEDGER_URL=${config.endpoints.ledgerUrl}` : undefined,
    config.endpoints.authUrl ? `SPLICE_AUTH_URL=${config.endpoints.authUrl}` : undefined,
    config.endpoints.validatorUrl ? `SPLICE_VALIDATOR_URL=${config.endpoints.validatorUrl}` : undefined,
    config.endpoints.tokenStandardUrl ? `SPLICE_TOKEN_STANDARD_URL=${config.endpoints.tokenStandardUrl}` : undefined,
    config.endpoints.walletGatewayUrl ? `CIP_0103_WALLET_GATEWAY_URL=${config.endpoints.walletGatewayUrl}` : undefined,
    config.endpoints.dappApiUrl ? `CIP_0103_DAPP_API_URL=${config.endpoints.dappApiUrl}` : undefined,
    `SPLICE_AUTH_MODE=${config.auth.mode}`,
    `SPLICE_AUTH_TOKEN_ENV=${config.auth.envVarName}`,
    `SPLICE_AUTH_TOKEN_PLACEHOLDER=\${${config.auth.envVarName}}`,
  ]

  return `${lines.filter(Boolean).join('\n')}\n`
}

