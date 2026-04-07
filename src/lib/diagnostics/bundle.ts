import * as fs from 'node:fs'
import * as path from 'node:path'

import type {DiagnosticsSnapshot} from './collect.js'
import {redactSupportArtifact} from './audit.js'

export interface DiagnosticsBundleWriter {
  write(options: {
    outputDir: string
    snapshot: DiagnosticsSnapshot
  }): Promise<{files: string[]; outputDir: string}>
}

export function createDiagnosticsBundleWriter(
  deps: {
    fs?: typeof fs
    path?: typeof path
  } = {},
): DiagnosticsBundleWriter {
  const fsImpl = deps.fs ?? fs
  const pathImpl = deps.path ?? path

  return {
    async write(options) {
      await fsImpl.promises.mkdir(options.outputDir, {recursive: true})
      const files = [
        writeJson(pathImpl.join(options.outputDir, 'profile.json'), options.snapshot.profile, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'auth.json'), options.snapshot.auth, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'compatibility.json'), options.snapshot.compatibility, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'services.json'), options.snapshot.services, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'inventory.json'), options.snapshot.inventory, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'drift.json'), options.snapshot.drift, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'health.json'), options.snapshot.health, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'metrics.json'), options.snapshot.metrics, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'validator-liveness.json'), options.snapshot.validatorLiveness ?? {}, fsImpl),
        writeJson(pathImpl.join(options.outputDir, 'last-operation.json'), options.snapshot.lastOperation ?? {}, fsImpl),
      ]

      return {
        files,
        outputDir: options.outputDir,
      }
    },
  }
}

function writeJson(filePath: string, value: unknown, fsImpl: typeof fs): string {
  fsImpl.writeFileSync(filePath, `${JSON.stringify(redactSupportArtifact(value), null, 2)}\n`, 'utf8')
  return filePath
}
