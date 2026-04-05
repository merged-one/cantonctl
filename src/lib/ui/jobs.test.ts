import {describe, expect, it} from 'vitest'

import {CantonctlError, ErrorCode} from '../errors.js'

import {createUiJobStore} from './jobs.js'

describe('ui job store', () => {
  it('tracks successful job lifecycle and activity ordering', async () => {
    const jobs = createUiJobStore()

    const started = jobs.start(
      {
        action: 'support/discover-network',
        mutating: false,
        preview: 'cantonctl discover network --scan-url https://scan.example.com',
      },
      async () => ({
        result: {scanUrl: 'https://scan.example.com'},
        summary: 'Fetched discovery',
      }),
    )

    expect(jobs.get(started.id)).toEqual(expect.objectContaining({
      action: 'support/discover-network',
      status: 'running',
    }))

    await waitForSettledJob(jobs, started.id)

    expect(jobs.get(started.id)).toEqual(expect.objectContaining({
      result: {scanUrl: 'https://scan.example.com'},
      status: 'success',
      summary: 'Fetched discovery',
    }))
    expect(jobs.list()).toHaveLength(1)
  })

  it('serializes structured errors on failed jobs', async () => {
    const jobs = createUiJobStore()
    const started = jobs.start(
      {
        action: 'support/diagnostics-bundle',
        mutating: true,
        preview: 'cantonctl diagnostics bundle --profile splice-devnet',
      },
      async () => {
        throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
          suggestion: 'Configure a profile first.',
        })
      },
    )

    await waitForSettledJob(jobs, started.id)

    expect(jobs.get(started.id)).toEqual(expect.objectContaining({
      error: {
        code: ErrorCode.SERVICE_NOT_CONFIGURED,
        message: 'The requested service endpoint is not configured in the active profile.',
        suggestion: 'Configure a profile first.',
      },
      status: 'error',
    }))
  })
})

async function waitForSettledJob(
  jobs: ReturnType<typeof createUiJobStore>,
  id: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const record = jobs.get(id)
    if (record && record.status !== 'running') {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 0))
  }

  throw new Error(`Job ${id} did not settle`)
}
