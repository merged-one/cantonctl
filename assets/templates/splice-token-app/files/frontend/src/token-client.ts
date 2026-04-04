type DemoCommand = 'holdings' | 'transfer'

const LEDGER_API_URL = process.env.LEDGER_API_URL ?? 'https://ledger.example.com'
const TOKEN_STANDARD_URL = process.env.TOKEN_STANDARD_URL ?? 'https://tokens.example.com'
const BEARER_TOKEN = process.env.BEARER_TOKEN ?? ''
const HOLDING_INTERFACE_ID = 'Splice.API.Token.Holding.V1:Holding'

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

async function readHoldings() {
  return requestJson(`${LEDGER_API_URL}/v2/state/active-contracts`, {
    body: JSON.stringify({
      filter: {
        interfaceIds: [HOLDING_INTERFACE_ID],
      },
    }),
    method: 'POST',
  })
}

async function requestTransferFactory() {
  return requestJson(`${TOKEN_STANDARD_URL}/transfer-instruction/v1/transfer-factory`, {
    body: JSON.stringify({
      amount: '10.0',
      instrumentAdmin: 'Registry',
      instrumentId: 'USD',
      receiver: 'Bob',
      sender: 'Alice',
    }),
    method: 'POST',
  })
}

const command = (process.argv[2] ?? 'holdings') as DemoCommand
const result = command === 'transfer'
  ? await requestTransferFactory()
  : await readHoldings()

console.log(JSON.stringify(result, null, 2))
