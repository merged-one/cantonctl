import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen, waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {ReactNode} from 'react'
import React from 'react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {App} from './app'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  window.__CANTONCTL_UI__ = {sessionToken: 'session-token'}
  window.localStorage.clear()
  fetchMock.mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    expect(init?.headers).toEqual(expect.objectContaining({
      'X-Cantonctl-Ui-Session': 'session-token',
    }))

    if (url.startsWith('/ui/session')) {
      return jsonResponse({
        data: {
          configPath: '/repo/cantonctl.yaml',
          defaultProfile: 'sandbox',
          profiles: [
            {
              auth: {authenticated: true, mode: 'bearer-token', source: 'fallback', warnings: []},
              experimental: false,
              isDefault: true,
              kind: 'sandbox',
              name: 'sandbox',
              networkName: 'local',
              readiness: {detail: 'Local runtime', tone: 'info'},
              services: ['ledger'],
            },
            {
              auth: {authenticated: true, mode: 'bearer-token', source: 'fallback', warnings: []},
              experimental: false,
              isDefault: false,
              kind: 'splice-localnet',
              name: 'splice-localnet',
              networkName: 'localnet',
              readiness: {detail: 'Local runtime', tone: 'info'},
              services: ['ledger', 'validator', 'scan', 'localnet'],
            },
            {
              auth: {authenticated: false, mode: 'env-or-keychain-jwt', source: 'missing', warnings: []},
              experimental: false,
              isDefault: false,
              kind: 'remote-validator',
              name: 'splice-devnet',
              networkName: 'devnet',
              readiness: {detail: 'Auth required', tone: 'fail'},
              services: ['ledger', 'validator', 'scan', 'auth'],
            },
          ],
          project: {name: 'demo', sdkVersion: '3.4.11'},
          selectedProfile: 'sandbox',
          storageKey: 'cantonctl-ui:/repo/cantonctl.yaml',
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/overview')) {
      return jsonResponse({
        data: {
          advisories: [],
          environmentPath: [
            {active: true, label: 'Sandbox', profiles: ['sandbox'], stage: 'sandbox'},
            {active: false, label: 'Local Control Plane', profiles: ['splice-localnet'], stage: 'local'},
            {active: false, label: 'Remote Network', profiles: ['splice-devnet'], stage: 'remote'},
          ],
          profile: {kind: 'sandbox', name: 'sandbox'},
          readiness: {failed: 0, passed: 4, skipped: 1, success: true, warned: 0},
          services: [
            {detail: 'json-api-port 7575', name: 'ledger', stability: 'stable-external', status: 'healthy', tone: 'pass'},
          ],
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/runtime?profile=splice-localnet')) {
      return jsonResponse({
        data: {
          autoPoll: true,
          mode: 'splice-localnet',
          profile: {kind: 'splice-localnet', name: 'splice-localnet'},
          serviceMap: {
            edges: [{from: 'workspace', label: 'sv', to: 'validator'}],
            nodes: [
              {id: 'workspace', kind: 'workspace', label: 'LocalNet Workspace', status: 'configured', tone: 'info', url: '/workspace'},
              {id: 'validator', kind: 'service', label: 'Validator', status: 'healthy', tone: 'pass', url: 'http://wallet.localhost:4000/api/validator'},
            ],
          },
          summary: {
            healthDetail: 'Validator readyz healthy.',
            ledgerUrl: 'http://canton.localhost:4000/v2',
            workspace: '/workspace',
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/runtime')) {
      return jsonResponse({
        data: {
          autoPoll: true,
          mode: 'sandbox',
          profile: {kind: 'sandbox', name: 'sandbox'},
          summary: {
            healthDetail: 'Ledger ready.',
            ledgerUrl: 'http://localhost:7575',
            partyCount: 2,
            version: '3.4.11',
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/profiles')) {
      return jsonResponse({
        data: {
          profiles: [],
          selected: {
            auth: {authenticated: false, mode: 'env-or-keychain-jwt', source: 'missing', warnings: []},
            experimental: false,
            imports: {scan: {url: 'https://scan.example.com'}},
            json: {kind: 'remote-validator'},
            kind: 'remote-validator',
            name: 'splice-devnet',
            networkMappings: ['devnet'],
            networkName: 'devnet',
            services: [],
            validation: {detail: 'valid', valid: true},
            yaml: 'profiles: {}',
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/checks')) {
      return jsonResponse({
        data: {
          auth: {authenticated: true, envVarName: 'JWT', mode: 'bearer-token', source: 'fallback', warnings: []},
          canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
          compatibility: {checks: [], failed: 0, passed: 1, warned: 0},
          doctor: {checks: [], failed: 0, passed: 1, warned: 0},
          preflight: {
            checks: [],
            network: {checklist: [], name: 'local', reminders: [], resetExpectation: 'local-only', tier: 'local'},
            success: true,
          },
          profile: {kind: 'sandbox', name: 'sandbox'},
          readiness: {failed: 0, passed: 3, skipped: 1, success: true, warned: 0},
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/support')) {
      return jsonResponse({
        data: {
          defaults: {
            diagnosticsOutputDir: '/repo/.cantonctl/diagnostics/splice-devnet',
            exportTargets: ['dapp-sdk', 'wallet-sdk'],
            scanUrl: 'https://scan.example.com',
          },
          profile: {kind: 'remote-validator', name: 'splice-devnet'},
        },
        success: true,
      })
    }

    throw new Error(`Unhandled fetch for ${url}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('renders the read-only control center, switches profiles, and shows CLI handoff commands', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<App />)

    expect(await screen.findByText('Project-local control center')).toBeTruthy()
    expect(await screen.findByText('sandbox readiness')).toBeTruthy()
    expect(screen.getByText('Visualization first')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-localnet')
    await user.click(screen.getByText('Runtime').closest('button')!)

    expect(await screen.findByText('LocalNet Service Map')).toBeTruthy()
    expect(screen.getByText('LocalNet Workspace')).toBeTruthy()
    expect(screen.getByText('Validator readyz healthy.')).toBeTruthy()
    expect(screen.getByText('Inspect the upstream LocalNet workspace status')).toBeTruthy()
    expect(screen.getByText(/cantonctl localnet status --workspace \/workspace --json/)).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-devnet')
    await user.click(screen.getAllByText('Profiles')[0].closest('button')!)
    expect(await screen.findByText('Credential missing')).toBeTruthy()
    expect(screen.getByText('Resolve credentials for the selected remote profile')).toBeTruthy()
    expect(screen.getByText(/cantonctl auth login devnet/)).toBeTruthy()

    await user.click(screen.getByText('Support').closest('button')!)
    expect(await screen.findByText('CLI-only Support Actions')).toBeTruthy()
    expect(screen.getByText('Write a diagnostics bundle from the CLI')).toBeTruthy()
    expect(screen.getByText(/cantonctl diagnostics bundle --profile splice-devnet/)).toBeTruthy()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/ui/support?profile=splice-devnet', expect.objectContaining({
        headers: expect.objectContaining({'X-Cantonctl-Ui-Session': 'session-token'}),
      }))
    })
  })
})

function renderWithQueryClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={client}>
      {node}
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}
