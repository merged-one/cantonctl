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
  window.localStorage.clear()
  fetchMock.mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url

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
          recentOutputs: {},
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
            network: {checklist: [], name: 'local', reminders: [], resetExpectation: 'n/a', tier: 'local'},
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
          activity: [],
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

    if (url.startsWith('/ui/actions/support/export-sdk-config') && init?.method === 'POST') {
      return jsonResponse({
        data: {jobId: 'job-1'},
        success: true,
      }, 202)
    }

    if (url.startsWith('/ui/jobs/job-1')) {
      return jsonResponse({
        data: {
          action: 'support/export-sdk-config',
          createdAt: '2026-04-04T00:00:00.000Z',
          id: 'job-1',
          mutating: true,
          preview: 'cantonctl export sdk-config --profile splice-devnet --target dapp-sdk --format json',
          result: {format: 'json', rendered: '{"validator":"https://validator.example.com"}', target: 'dapp-sdk'},
          status: 'success',
          summary: 'Exported dapp-sdk config as json',
          updatedAt: '2026-04-04T00:00:00.000Z',
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
  it('renders the profile-centric control center, switches profiles, and runs a drawer action', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<App />)

    expect(await screen.findByText('Project-local control center')).toBeTruthy()
    expect(await screen.findByText('sandbox readiness')).toBeTruthy()
    expect(screen.getByText('Passed')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-localnet')
    await user.click(screen.getByText('Runtime').closest('button')!)

    expect(await screen.findByText('LocalNet Service Map')).toBeTruthy()
    expect(screen.getByText('LocalNet Workspace')).toBeTruthy()
    expect(screen.getByText('Validator readyz healthy.')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-devnet')
    await user.click(screen.getByText('Support').closest('button')!)
    expect(await screen.findByText('Export')).toBeTruthy()

    await user.click(screen.getByRole('button', {name: 'Export'}))
    expect(await screen.findByText('Export SDK Config')).toBeTruthy()
    expect(screen.getByText(/cantonctl export sdk-config --profile splice-devnet/)).toBeTruthy()

    await user.click(screen.getByRole('button', {name: 'Confirm'}))
    expect(await screen.findByText('Exported dapp-sdk config as json')).toBeTruthy()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/ui/actions/support/export-sdk-config?profile=splice-devnet', expect.objectContaining({
        method: 'POST',
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
