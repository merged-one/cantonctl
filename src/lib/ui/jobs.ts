import {randomUUID} from 'node:crypto'

import {CantonctlError} from '../errors.js'

import type {UiActionKind, UiApiError, UiJobRecord} from './contracts.js'

export interface UiJobResult<T = unknown> {
  artifactPath?: string
  result: T
  summary?: string
}

export interface UiJobStore {
  get(id: string): UiJobRecord | undefined
  list(limit?: number): UiJobRecord[]
  start<T>(
    options: {
      action: UiActionKind
      mutating: boolean
      preview: string
    },
    task: () => Promise<UiJobResult<T>>,
  ): UiJobRecord
}

export function createUiJobStore(): UiJobStore {
  const jobs = new Map<string, UiJobRecord>()

  return {
    get(id) {
      return jobs.get(id)
    },

    list(limit = 20) {
      return [...jobs.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
    },

    start(options, task) {
      const now = new Date().toISOString()
      const record: UiJobRecord = {
        action: options.action,
        createdAt: now,
        id: randomUUID(),
        mutating: options.mutating,
        preview: options.preview,
        status: 'running',
        updatedAt: now,
      }
      jobs.set(record.id, record)

      void task()
        .then((result) => {
          const updated = jobs.get(record.id)
          if (!updated) return
          jobs.set(record.id, {
            ...updated,
            artifactPath: result.artifactPath,
            result: result.result,
            status: 'success',
            summary: result.summary,
            updatedAt: new Date().toISOString(),
          })
        })
        .catch((error: unknown) => {
          const updated = jobs.get(record.id)
          if (!updated) return
          jobs.set(record.id, {
            ...updated,
            error: toUiApiError(error),
            status: 'error',
            updatedAt: new Date().toISOString(),
          })
        })

      return record
    },
  }
}

export function toUiApiError(error: unknown): UiApiError {
  if (error instanceof CantonctlError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: error.suggestion || undefined,
    }
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED',
      message: error.message,
    }
  }

  return {
    code: 'UNEXPECTED',
    message: String(error),
  }
}
