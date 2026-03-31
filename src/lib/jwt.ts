/**
 * @module jwt
 *
 * JWT generation for Canton sandbox authentication. The Canton JSON Ledger
 * API always requires a Bearer token, even in local development. The sandbox
 * decodes but does **not** validate the token signature, so we use a
 * well-known secret for local development.
 *
 * Tokens follow the Canton Ledger API V2 JWT claims format:
 * - `actAs`: parties the token holder can act as
 * - `readAs`: parties the token holder can read as
 * - `admin`: whether the token grants admin access
 * - `applicationId`: application identifier
 * - `ledgerId`: ledger identifier (optional)
 *
 * @example
 * ```ts
 * import { createSandboxToken } from './jwt.js'
 *
 * const token = await createSandboxToken({
 *   actAs: ['Alice::1234'],
 *   readAs: ['Alice::1234', 'Public'],
 *   applicationId: 'cantonctl',
 * })
 * // Use token as Bearer header for Ledger API requests
 * ```
 */

import * as jose from 'jose'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Well-known secret for local sandbox JWT signing. Canton sandbox decodes
 * but does not validate signatures, so this value is intentionally public.
 * NEVER use this for production environments.
 */
const SANDBOX_SECRET = 'canton-sandbox-secret-do-not-use-in-production'

/** Default token lifetime: 24 hours. */
const DEFAULT_EXPIRY_SECONDS = 24 * 60 * 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxTokenOptions {
  /** Parties the token holder can act as. */
  actAs: string[]
  /** Parties the token holder can read as. */
  readAs: string[]
  /** Application identifier included in the token. */
  applicationId: string
  /** Whether the token grants admin access. Defaults to `false`. */
  admin?: boolean
  /** Ledger ID claim. Optional. */
  ledgerId?: string
  /** Token lifetime in seconds. Defaults to 24 hours. */
  expiresInSeconds?: number
}

/** Decoded claims from a sandbox JWT. */
export interface SandboxTokenClaims {
  actAs: string[]
  readAs: string[]
  applicationId: string
  admin?: boolean
  ledgerId?: string
  exp?: number
  iat?: number
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Generate an HS256-signed JWT for local Canton sandbox authentication.
 *
 * The token is signed with a well-known secret that is intentionally public.
 * Canton sandbox decodes tokens but does not validate signatures, making
 * this suitable only for local development and testing.
 *
 * @param options - Token claims and configuration
 * @returns Compact JWS string (three dot-separated base64url segments)
 */
export async function createSandboxToken(options: SandboxTokenOptions): Promise<string> {
  const secret = new TextEncoder().encode(SANDBOX_SECRET)
  const expiresIn = options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS

  const claims: Record<string, unknown> = {
    actAs: options.actAs,
    applicationId: options.applicationId,
    readAs: options.readAs,
  }

  if (options.admin) {
    claims.admin = true
  }

  if (options.ledgerId) {
    claims.ledgerId = options.ledgerId
  }

  return new jose.SignJWT(claims)
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret)
}

/**
 * Decode and verify a sandbox JWT signed with the well-known secret.
 *
 * @param token - Compact JWS string
 * @returns Decoded claims from the token
 * @throws If the token is malformed or signature verification fails
 */
export async function decodeSandboxToken(token: string): Promise<SandboxTokenClaims> {
  const secret = new TextEncoder().encode(SANDBOX_SECRET)
  const {payload} = await jose.jwtVerify(token, secret)

  return {
    actAs: payload.actAs as string[],
    admin: payload.admin as boolean | undefined,
    applicationId: payload.applicationId as string,
    exp: payload.exp,
    iat: payload.iat,
    ledgerId: payload.ledgerId as string | undefined,
    readAs: payload.readAs as string[],
  }
}
