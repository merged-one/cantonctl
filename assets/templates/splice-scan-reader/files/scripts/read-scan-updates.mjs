const SCAN_URL = process.env.SPLICE_SCAN_URL ?? 'https://scan.example.com'
const BEARER_TOKEN = process.env.BEARER_TOKEN ?? ''

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Scan request failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

const updates = await requestJson(`${SCAN_URL}/v2/updates`, {
  body: JSON.stringify({page_size: 10}),
  method: 'POST',
})

console.log(JSON.stringify(updates, null, 2))
