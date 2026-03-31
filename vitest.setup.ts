/**
 * Vitest setup file — polyfills for cross-Node-version compatibility.
 *
 * Node 18 doesn't expose `globalThis.crypto` by default, but the `jose`
 * JWT library requires it. This polyfill ensures tests pass on Node 18+.
 */

import {webcrypto} from 'node:crypto'

if (!globalThis.crypto) {
  // @ts-expect-error — webcrypto is compatible but types don't perfectly overlap
  globalThis.crypto = webcrypto
}
