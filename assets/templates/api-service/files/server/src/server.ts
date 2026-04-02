/**
 * Express.js API service consuming the Canton JSON Ledger API.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /api/contracts
 *   POST /api/commands
 *   GET  /api/parties
 */

import express from 'express'

const app = express()
app.use(express.json())

const LEDGER_API = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const JWT_TOKEN = process.env.LEDGER_JWT ?? ''

async function ledgerFetch(resourcePath: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${LEDGER_API}${resourcePath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${JWT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    },
  })
}

app.get('/health', (_req, res) => {
  res.json({status: 'ok'})
})

app.get('/api/contracts', async (_req, res) => {
  try {
    const response = await ledgerFetch('/v2/state/active-contracts', {
      body: JSON.stringify({filter: {}}),
      method: 'POST',
    })
    const data = await response.json()
    res.json(data)
  } catch {
    res.status(502).json({error: 'Failed to query ledger'})
  }
})

app.post('/api/commands', async (req, res) => {
  try {
    const response = await ledgerFetch('/v2/commands/submit-and-wait', {
      body: JSON.stringify(req.body),
      method: 'POST',
    })
    const data = await response.json()
    res.json(data)
  } catch {
    res.status(502).json({error: 'Failed to submit command'})
  }
})

app.get('/api/parties', async (_req, res) => {
  try {
    const response = await ledgerFetch('/v2/parties')
    const data = await response.json()
    res.json(data)
  } catch {
    res.status(502).json({error: 'Failed to list parties'})
  }
})

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10)
app.listen(PORT, () => {
  console.log(`{{PROJECT_NAME}} API listening on http://localhost:${PORT}`)
  console.log(`Ledger API: ${LEDGER_API}`)
})
