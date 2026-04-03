import {describe, expect, it, vi} from 'vitest'

import {createExternalSigningAdapter} from './external-signing.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createExternalSigningAdapter', () => {
  it('routes prepareSubmission through the interactive-submission API', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      preparedTransaction: 'prepared-tx',
      preparedTransactionHash: 'hash-1',
    }))

    const adapter = createExternalSigningAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    await adapter.prepareSubmission({
      actAs: ['Alice'],
      commandId: 'cmd-1',
      commands: [],
    })

    const [, init] = fetch.mock.calls[0]
    expect(fetch.mock.calls[0][0]).toBe('https://ledger.example.com/v2/interactive-submission/prepare')
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({Authorization: 'Bearer jwt-token'}),
      method: 'POST',
    }))
    expect(JSON.parse(String(init.body))).toEqual({
      actAs: ['Alice'],
      commandId: 'cmd-1',
      commands: [],
    })
    expect(adapter.metadata.warnings.join(' ')).toContain('experimental')
  })

  it('covers execute submission variants against the ledger interactive API', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({submissionId: 'submit-1'}))
      .mockResolvedValueOnce(createJsonResponse({completionOffset: '42'}))
      .mockResolvedValueOnce(createJsonResponse({transaction: {transactionId: 'tx-1'}}))

    const adapter = createExternalSigningAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    await expect(adapter.executeSubmission({signedTransaction: 'signed'} as never)).resolves.toEqual({
      submissionId: 'submit-1',
    })
    await expect(adapter.executeSubmissionAndWait({signedTransaction: 'signed'} as never)).resolves.toEqual({
      completionOffset: '42',
    })
    await expect(adapter.executeSubmissionAndWaitForTransaction({signedTransaction: 'signed'} as never)).resolves.toEqual({
      transaction: {transactionId: 'tx-1'},
    })

    expect(String(fetch.mock.calls[0][0])).toContain('/v2/interactive-submission/execute')
    expect(String(fetch.mock.calls[1][0])).toContain('/v2/interactive-submission/executeAndWait')
    expect(String(fetch.mock.calls[2][0])).toContain('/v2/interactive-submission/executeAndWaitForTransaction')
  })
})
