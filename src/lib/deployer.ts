/**
 * @module deployer
 *
 * Deploy pipeline for cantonctl. Orchestrates the 6-step deployment of DAR
 * packages to Canton networks:
 *
 * 1. **Validate** — network exists in config, resolve connection details
 * 2. **Build** — compile Daml or resolve `--dar` path, read DAR bytes
 * 3. **Auth** — generate sandbox token (local) or retrieve credentials (remote)
 * 4. **Pre-flight** — check node reachability via version endpoint
 * 5. **Upload** — upload DAR via Ledger API
 * 6. **Verify** — confirm deployment via returned package ID
 *
 * Follows ADR-0008 (deploy pipeline) and ADR-0011 (wrap SDK, don't reimplement).
 *
 * @example
 * ```ts
 * const deployer = createDeployer({ builder, config, createLedgerClient, createToken, fs, output })
 * const result = await deployer.deploy({ network: 'local' })
 * console.log(result.mainPackageId) // 'abc123...'
 * ```
 */

import type {Builder} from './builder.js'
import type {CantonctlConfig} from './config.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {LedgerClient, LedgerClientOptions} from './ledger-client.js'
import type {OutputWriter} from './output.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployerDeps {
  /** Builder for compiling Daml to DAR. */
  builder: Builder
  /** Resolved cantonctl config. */
  config: CantonctlConfig
  /** Factory to create a LedgerClient for the target network. */
  createLedgerClient: (opts: LedgerClientOptions) => LedgerClient
  /** Token generator (sandbox token for local, credential store for remote). */
  createToken: (opts: {actAs: string[]; admin: boolean; applicationId: string; readAs: string[]}) => Promise<string>
  /** Filesystem abstraction for reading DAR files. */
  fs: {readFile: (path: string) => Promise<Uint8Array>}
  /** Output writer for progress messages. */
  output: OutputWriter
}

export interface DeployOptions {
  /** Target network name (must exist in config). */
  network: string
  /** Explicit path to .dar file (skips build). */
  darPath?: string
  /** Simulate deployment without uploading. */
  dryRun?: boolean
  /** Override deploying party. */
  party?: string
  /** Project directory for build. */
  projectDir?: string
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface DeployResult {
  success: boolean
  /** Target network name. */
  network: string
  /** Path to the deployed DAR file. */
  darPath: string | null
  /** Package ID returned by the ledger after upload. */
  mainPackageId: string | null
  /** Deploy duration in milliseconds. */
  durationMs: number
  /** Whether this was a dry run. */
  dryRun: boolean
}

export interface Deployer {
  /** Execute the 6-step deploy pipeline. */
  deploy(opts: DeployOptions): Promise<DeployResult>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a Deployer that orchestrates the DAR deployment pipeline.
 */
export function createDeployer(deps: DeployerDeps): Deployer {
  const {builder, config, createLedgerClient, createToken, fs, output} = deps

  return {
    async deploy(opts: DeployOptions): Promise<DeployResult> {
      const start = Date.now()
      const networkName = opts.network
      const projectDir = opts.projectDir ?? process.cwd()

      // Step 1: Validate configuration
      output.info(`[1/6] Validating configuration...`)
      const network = config.networks?.[networkName]
      if (!network) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          context: {availableNetworks: Object.keys(config.networks ?? {}), network: networkName},
          suggestion: `Network "${networkName}" not found in cantonctl.yaml. Available: ${Object.keys(config.networks ?? {}).join(', ') || 'none'}`,
        })
      }

      const jsonApiPort = network['json-api-port'] ?? 7575
      const baseUrl = network.url ?? `http://localhost:${jsonApiPort}`

      // Step 2: Build or resolve DAR path
      output.info(`[2/6] Building .dar package...`)
      let darPath: string | null = opts.darPath ?? null

      if (!darPath) {
        const buildResult = await builder.build({projectDir, signal: opts.signal})
        darPath = buildResult.darPath
        if (buildResult.cached) {
          output.info('  Build up to date (cached)')
        }
      }

      if (!darPath) {
        throw new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
          suggestion: 'No .dar file found. Run "cantonctl build" first or specify --dar.',
        })
      }

      // Read DAR bytes
      let darBytes: Uint8Array
      try {
        darBytes = await fs.readFile(darPath)
      } catch (err) {
        throw new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
          cause: err instanceof Error ? err : undefined,
          context: {darPath},
          suggestion: `Cannot read DAR file at ${darPath}. Check the path exists.`,
        })
      }

      // Step 3: Auth
      if (network.type === 'sandbox' || networkName === 'local') {
        output.info(`[3/6] Auth: local sandbox`)
      } else {
        output.info(`[3/6] Authenticating...`)
      }

      const partyNames = config.parties?.map(p => p.name) ?? []
      const actAs = opts.party ? [opts.party] : (partyNames.length > 0 ? partyNames : ['admin'])
      let token: string
      try {
        token = await createToken({
          actAs,
          admin: true,
          applicationId: 'cantonctl',
          readAs: partyNames,
        })
      } catch (err) {
        throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
          cause: err instanceof Error ? err : undefined,
          context: {network: networkName},
          suggestion: `Authentication failed for "${networkName}". Run "cantonctl auth login ${networkName}" to configure credentials.`,
        })
      }

      // Step 4: Pre-flight checks
      output.info(`[4/6] Pre-flight checks...`)
      const client = createLedgerClient({baseUrl, token})

      try {
        await client.getVersion(opts.signal)
      } catch (err) {
        if (err instanceof CantonctlError && err.code === ErrorCode.LEDGER_CONNECTION_FAILED) {
          throw new CantonctlError(ErrorCode.DEPLOY_NETWORK_UNREACHABLE, {
            cause: err,
            context: {baseUrl, network: networkName},
            suggestion: `Cannot reach "${networkName}" at ${baseUrl}. Is the Canton sandbox running? Try "cantonctl dev" first.`,
          })
        }

        throw err
      }

      // Dry run exits here
      if (opts.dryRun) {
        output.success('Dry run complete. No changes made.')
        return {
          darPath,
          dryRun: true,
          durationMs: Date.now() - start,
          mainPackageId: null,
          network: networkName,
          success: true,
        }
      }

      // Step 5: Upload DAR
      output.info(`[5/6] Uploading .dar...`)
      let mainPackageId: string
      try {
        const uploadResult = await client.uploadDar(darBytes, opts.signal)
        mainPackageId = uploadResult.mainPackageId
      } catch (err) {
        if (err instanceof CantonctlError) {
          if (err.code === ErrorCode.DEPLOY_UPLOAD_FAILED) {
            throw err
          }

          // Check for package-exists scenario (409 Conflict)
          if (err.context?.status === 409) {
            throw new CantonctlError(ErrorCode.DEPLOY_PACKAGE_EXISTS, {
              cause: err,
              context: {darPath, network: networkName},
              suggestion: 'A package with this version already exists. Increment the version in daml.yaml.',
            })
          }
        }

        throw err
      }

      // Step 6: Verify deployment
      output.info(`[6/6] Verifying deployment...`)
      output.success(`Deployed successfully to ${networkName}`)
      output.info(`  Package ID: ${mainPackageId}`)

      return {
        darPath,
        dryRun: false,
        durationMs: Date.now() - start,
        mainPackageId,
        network: networkName,
        success: true,
      }
    },
  }
}
