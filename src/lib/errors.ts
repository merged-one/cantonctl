/**
 * @module errors
 *
 * Structured error system for cantonctl. Every error has:
 * - A unique code (e.g., E1001) for programmatic handling
 * - A human-readable message explaining what went wrong
 * - A suggestion for how to fix it
 * - A docs URL linking to detailed troubleshooting
 *
 * Error code ranges by subsystem:
 * - E1xxx: Configuration errors
 * - E2xxx: SDK/tool errors (`dpm` current, `daml` legacy fallback)
 * - E3xxx: Sandbox/node errors
 * - E4xxx: Build errors
 * - E5xxx: Test errors
 * - E6xxx: Deploy errors
 * - E7xxx: Ledger and service API errors
 *
 * @example
 * ```ts
 * import { CantonctlError, ErrorCode } from './errors.js'
 *
 * throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
 *   suggestion: 'Run "cantonctl init" to create a project.',
 * })
 * ```
 */

const DOCS_BASE_URL = 'https://cantonctl.dev/errors'

/**
 * All known cantonctl error codes. Each code maps to a specific failure mode
 * with documented troubleshooting steps.
 */
export enum ErrorCode {
  // E1xxx: Configuration
  CONFIG_NOT_FOUND = 'E1001',
  CONFIG_INVALID_YAML = 'E1002',
  CONFIG_SCHEMA_VIOLATION = 'E1003',
  CONFIG_DIRECTORY_EXISTS = 'E1004',
  SERVICE_NOT_CONFIGURED = 'E1005',
  EXPERIMENTAL_CONFIRMATION_REQUIRED = 'E1006',

  // E2xxx: SDK/Tools
  SDK_NOT_INSTALLED = 'E2001',
  SDK_VERSION_MISMATCH = 'E2002',
  SDK_COMMAND_FAILED = 'E2003',

  // E3xxx: Sandbox/Node
  SANDBOX_START_FAILED = 'E3001',
  SANDBOX_PORT_IN_USE = 'E3002',
  SANDBOX_HEALTH_TIMEOUT = 'E3003',
  DOCKER_NOT_AVAILABLE = 'E3004',
  DOCKER_COMPOSE_FAILED = 'E3005',
  LOCALNET_WORKSPACE_INVALID = 'E3006',
  LOCALNET_COMMAND_FAILED = 'E3007',

  // E4xxx: Build
  BUILD_DAML_ERROR = 'E4001',
  BUILD_DAR_NOT_FOUND = 'E4002',

  // E5xxx: Test
  TEST_EXECUTION_FAILED = 'E5001',

  // E6xxx: Deploy
  DEPLOY_AUTH_FAILED = 'E6001',
  DEPLOY_NETWORK_UNREACHABLE = 'E6002',
  DEPLOY_UPLOAD_FAILED = 'E6003',
  DEPLOY_PACKAGE_EXISTS = 'E6004',

  // E7xxx: Ledger and service APIs
  LEDGER_CONNECTION_FAILED = 'E7001',
  LEDGER_COMMAND_REJECTED = 'E7002',
  LEDGER_AUTH_EXPIRED = 'E7003',
  SERVICE_CONNECTION_FAILED = 'E7004',
  SERVICE_REQUEST_FAILED = 'E7005',
  SERVICE_AUTH_FAILED = 'E7006',
}

/** Human-readable descriptions for each error code. */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.CONFIG_NOT_FOUND]: 'No cantonctl.yaml found in this directory or any parent directory.',
  [ErrorCode.CONFIG_INVALID_YAML]: 'cantonctl.yaml contains invalid YAML syntax.',
  [ErrorCode.CONFIG_SCHEMA_VIOLATION]: 'cantonctl.yaml does not match the expected schema.',
  [ErrorCode.CONFIG_DIRECTORY_EXISTS]: 'Target directory already exists.',
  [ErrorCode.SERVICE_NOT_CONFIGURED]: 'The requested service endpoint is not configured in the active profile.',
  [ErrorCode.EXPERIMENTAL_CONFIRMATION_REQUIRED]: 'This command requires explicit experimental confirmation.',
  [ErrorCode.SDK_NOT_INSTALLED]: 'No supported SDK CLI found on PATH (install dpm; daml is legacy-only).',
  [ErrorCode.SDK_VERSION_MISMATCH]: 'Installed SDK version is incompatible with this project.',
  [ErrorCode.SDK_COMMAND_FAILED]: 'SDK command exited with a non-zero status.',
  [ErrorCode.SANDBOX_START_FAILED]: 'Canton sandbox process exited unexpectedly during startup.',
  [ErrorCode.SANDBOX_PORT_IN_USE]: 'The requested port is already in use.',
  [ErrorCode.SANDBOX_HEALTH_TIMEOUT]: 'Canton sandbox did not become healthy within the timeout.',
  [ErrorCode.DOCKER_NOT_AVAILABLE]: 'Docker is not installed or not running.',
  [ErrorCode.DOCKER_COMPOSE_FAILED]: 'Docker Compose operation failed.',
  [ErrorCode.LOCALNET_WORKSPACE_INVALID]: 'The LocalNet workspace does not match the expected upstream layout.',
  [ErrorCode.LOCALNET_COMMAND_FAILED]: 'The upstream LocalNet workspace command failed.',
  [ErrorCode.BUILD_DAML_ERROR]: 'Daml compilation failed.',
  [ErrorCode.BUILD_DAR_NOT_FOUND]: 'Expected .dar file was not produced by the build.',
  [ErrorCode.TEST_EXECUTION_FAILED]: 'One or more Daml Script tests failed.',
  [ErrorCode.DEPLOY_AUTH_FAILED]: 'Authentication failed for the target network.',
  [ErrorCode.DEPLOY_NETWORK_UNREACHABLE]: 'Cannot connect to the target Canton participant.',
  [ErrorCode.DEPLOY_UPLOAD_FAILED]: 'DAR upload was rejected by the participant.',
  [ErrorCode.DEPLOY_PACKAGE_EXISTS]: 'A package with this name and version already exists.',
  [ErrorCode.LEDGER_CONNECTION_FAILED]: 'Cannot connect to the Canton JSON Ledger API.',
  [ErrorCode.LEDGER_COMMAND_REJECTED]: 'Command was rejected by the ledger.',
  [ErrorCode.LEDGER_AUTH_EXPIRED]: 'JWT token has expired or is invalid.',
  [ErrorCode.SERVICE_CONNECTION_FAILED]: 'Cannot connect to the configured service endpoint.',
  [ErrorCode.SERVICE_REQUEST_FAILED]: 'The configured service rejected the request.',
  [ErrorCode.SERVICE_AUTH_FAILED]: 'Authentication failed for the configured service endpoint.',
}

export interface CantonctlErrorOptions {
  /** Actionable suggestion for how to fix the error. */
  suggestion?: string
  /** Override the default docs URL for this error code. */
  docsUrl?: string
  /** Additional structured context (included in --json output). */
  context?: Record<string, unknown>
  /** The underlying cause, if any. */
  cause?: Error
}

/**
 * Structured error class for cantonctl. Carries an error code, suggestion,
 * and docs URL alongside the standard Error message.
 *
 * @example
 * ```ts
 * const err = new CantonctlError(ErrorCode.SDK_NOT_INSTALLED, {
 *   suggestion: 'Install DPM: curl https://get.digitalasset.com/install/install.sh | sh',
 * })
 * console.log(err.code)       // 'E2001'
 * console.log(err.docsUrl)    // 'https://cantonctl.dev/errors#e2001'
 * console.log(err.toJSON())   // { code, message, suggestion, docsUrl }
 * ```
 */
export class CantonctlError extends Error {
  readonly code: ErrorCode
  readonly suggestion: string
  readonly docsUrl: string
  readonly context: Record<string, unknown>

  constructor(code: ErrorCode, options: CantonctlErrorOptions = {}) {
    const message = ERROR_MESSAGES[code]
    super(message, options.cause ? {cause: options.cause} : undefined)
    this.name = 'CantonctlError'
    this.code = code
    this.suggestion = options.suggestion ?? ''
    this.docsUrl = options.docsUrl ?? `${DOCS_BASE_URL}#${code.toLowerCase()}`
    this.context = options.context ?? {}
  }

  /**
   * Format the error for terminal display.
   * Returns a multi-line string with code, message, suggestion, and docs link.
   */
  format(): string {
    const lines = [`Error ${this.code}: ${this.message}`]
    if (this.suggestion) {
      lines.push(`  Suggestion: ${this.suggestion}`)
    }

    lines.push(`  Docs: ${this.docsUrl}`)
    return lines.join('\n')
  }

  /**
   * Serialize for --json output. Includes all structured fields.
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      context: Object.keys(this.context).length > 0 ? this.context : undefined,
      docsUrl: this.docsUrl,
      message: this.message,
      suggestion: this.suggestion || undefined,
    }
  }
}
