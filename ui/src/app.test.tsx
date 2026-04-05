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
              services: ['ledger', 'auth'],
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
              auth: {authenticated: false, mode: 'env-or-keychain-jwt', source: 'missing', warnings: ['No stored credential found.']},
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

    if (url.startsWith('/ui/map?profile=sandbox')) {
      return jsonResponse({
        data: {
          autoPoll: true,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth'},
            {from: 'auth', label: 'talks to', to: 'ledger'},
          ],
          findings: [
            {
              detail: 'Wallet endpoint not reachable.',
              id: 'preflight:wallet',
              nodeIds: ['profile'],
              source: 'preflight',
              title: 'Wallet',
              tone: 'fail',
            },
          ],
          groups: [
            {id: 'environment', label: 'Environment'},
            {id: 'runtime', label: 'Runtime'},
          ],
          mode: 'sandbox',
          nodes: [
            {groupId: 'environment', id: 'profile', kind: 'profile', label: 'sandbox', status: 'attention', tone: 'warn'},
            {groupId: 'environment', id: 'auth', kind: 'auth', label: 'Auth', status: 'fallback', tone: 'warn'},
            {
              detail: 'Ledger ready.',
              findingIds: [],
              groupId: 'runtime',
              id: 'ledger',
              kind: 'service',
              label: 'Ledger',
              parties: ['Alice', 'Bob'],
              ports: {'json-api': 7575, port: 5001},
              status: 'healthy',
              tone: 'pass',
              url: 'http://localhost:7575',
            },
          ],
          overlays: ['health', 'parties', 'ports', 'auth', 'checks'],
          profile: {kind: 'sandbox', name: 'sandbox'},
          summary: {
            detail: 'Sandbox profile on local; 2 visible parties.',
            headline: '1 blocking issue',
            readiness: {failed: 1, passed: 2, skipped: 0, success: false, warned: 1},
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/map?profile=splice-localnet')) {
      return jsonResponse({
        data: {
          autoPoll: true,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth'},
            {from: 'workspace', label: 'sv', to: 'validator'},
            {from: 'validator', label: 'submits', to: 'ledger'},
          ],
          findings: [
            {
              detail: 'Validator readyz healthy.',
              id: 'validator-info',
              nodeIds: ['validator'],
              source: 'preflight',
              title: 'Validator',
              tone: 'warn',
            },
          ],
          groups: [
            {id: 'environment', label: 'Environment'},
            {id: 'workspace', label: 'Workspace'},
            {id: 'services', label: 'Services'},
          ],
          mode: 'splice-localnet',
          nodes: [
            {groupId: 'environment', id: 'profile', kind: 'profile', label: 'splice-localnet', status: 'ready', tone: 'pass'},
            {groupId: 'environment', id: 'auth', kind: 'auth', label: 'Auth', status: 'fallback', tone: 'warn'},
            {detail: '/workspace', groupId: 'workspace', id: 'workspace', kind: 'workspace', label: 'LocalNet Workspace', status: 'configured', tone: 'info', url: '/workspace'},
            {detail: 'Ledger ready.', groupId: 'services', id: 'ledger', kind: 'service', label: 'Ledger', status: 'healthy', tone: 'pass', url: 'http://canton.localhost:4000/v2'},
            {detail: 'Validator readyz healthy.', findingIds: ['validator-info'], groupId: 'services', id: 'validator', kind: 'service', label: 'Validator', status: 'healthy', tone: 'pass', url: 'http://wallet.localhost:4000/api/validator'},
          ],
          overlays: ['health', 'parties', 'ports', 'auth', 'checks'],
          profile: {kind: 'splice-localnet', name: 'splice-localnet'},
          summary: {
            detail: 'Workspace /workspace.',
            headline: '1 advisory finding',
            readiness: {failed: 0, passed: 3, skipped: 0, success: true, warned: 1},
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/map?profile=splice-devnet')) {
      return jsonResponse({
        data: {
          autoPoll: false,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth'},
            {from: 'auth', label: 'authenticates', to: 'ledger'},
            {from: 'validator', label: 'submits', to: 'ledger'},
          ],
          findings: [
            {
              detail: 'No credential is currently resolved for this profile.',
              id: 'auth-missing',
              nodeIds: ['auth'],
              source: 'auth',
              title: 'Credential required',
              tone: 'fail',
            },
            {
              detail: 'Validator unreachable.',
              id: 'validator-unreachable',
              nodeIds: ['validator'],
              source: 'preflight',
              title: 'Validator',
              tone: 'warn',
            },
          ],
          groups: [
            {id: 'environment', label: 'Environment'},
            {id: 'services', label: 'Services'},
          ],
          mode: 'remote',
          nodes: [
            {groupId: 'environment', id: 'profile', kind: 'profile', label: 'splice-devnet', status: 'attention', tone: 'fail'},
            {badges: ['env-or-keychain-jwt'], detail: 'No stored credential found.', groupId: 'services', id: 'auth', kind: 'auth', label: 'Auth', status: 'missing', tone: 'fail', findingIds: ['auth-missing']},
            {detail: 'https://ledger.example.com', groupId: 'services', id: 'ledger', kind: 'service', label: 'ledger', status: 'configured', tone: 'info', url: 'https://ledger.example.com'},
            {detail: 'https://validator.example.com', groupId: 'services', id: 'validator', kind: 'service', label: 'validator', status: 'unreachable', tone: 'fail', url: 'https://validator.example.com', findingIds: ['validator-unreachable']},
          ],
          overlays: ['health', 'parties', 'ports', 'auth', 'checks'],
          profile: {kind: 'remote-validator', name: 'splice-devnet'},
          summary: {
            detail: 'Remote service graph on devnet.',
            headline: '1 blocking issue',
            readiness: {failed: 1, passed: 2, skipped: 0, success: false, warned: 1},
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/checks?profile=splice-devnet')) {
      return jsonResponse({
        data: {
          auth: {authenticated: false, envVarName: 'JWT', mode: 'env-or-keychain-jwt', source: 'missing', warnings: ['No stored credential found.']},
          canary: {checks: [{detail: 'Validator public API reachable.', status: 'pass', suite: 'validator-public', warnings: []}], selectedSuites: ['validator-public'], skippedSuites: ['scan'], success: true},
          compatibility: {checks: [{detail: 'Project SDK pinned.', name: 'Project SDK', status: 'pass'}], failed: 0, passed: 1, warned: 0},
          doctor: {checks: [{detail: 'Environment healthy.', name: 'Node.js', required: true, status: 'pass'}], failed: 0, passed: 1, warned: 0},
          preflight: {
            checks: [{category: 'service', detail: 'Ledger reachable.', endpoint: 'https://ledger.example.com', name: 'Ledger', status: 'pass'}],
            network: {checklist: [], name: 'devnet', reminders: [], resetExpectation: 'unknown', tier: 'remote'},
            success: true,
          },
          profile: {kind: 'remote-validator', name: 'splice-devnet'},
          readiness: {failed: 1, passed: 2, skipped: 0, success: false, warned: 1},
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/profiles?profile=splice-devnet')) {
      return jsonResponse({
        data: {
          profiles: [
            {auth: {authenticated: false, mode: 'env-or-keychain-jwt', source: 'missing', warnings: []}, experimental: false, isDefault: false, kind: 'remote-validator', name: 'splice-devnet', networkName: 'devnet', readiness: {detail: 'Auth required', tone: 'fail'}, services: ['ledger', 'validator', 'scan', 'auth']},
          ],
          selected: {
            auth: {authenticated: false, mode: 'env-or-keychain-jwt', source: 'missing', warnings: []},
            experimental: false,
            imports: {scan: {url: 'https://scan.example.com'}},
            json: {auth: {kind: 'oidc'}, kind: 'remote-validator', validator: {url: 'https://validator.example.com'}},
            kind: 'remote-validator',
            name: 'splice-devnet',
            networkMappings: ['devnet'],
            networkName: 'devnet',
            services: [{detail: 'Remote validator.', name: 'validator', stability: 'stable-external', status: 'configured', tone: 'info'}],
            validation: {detail: 'cantonctl.yaml validates against the canonical schema.', valid: true},
            yaml: 'profiles:\n  splice-devnet: {}',
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/profiles?profile=splice-localnet')) {
      return jsonResponse({
        data: {
          profiles: [],
          selected: {
            auth: {authenticated: true, mode: 'bearer-token', source: 'fallback', warnings: []},
            experimental: false,
            imports: {localnet: {workspace: '/workspace'}},
            json: {kind: 'splice-localnet', localnet: {workspace: '/workspace'}},
            kind: 'splice-localnet',
            name: 'splice-localnet',
            networkMappings: ['localnet'],
            networkName: 'localnet',
            services: [{detail: 'Workspace imported.', name: 'localnet', stability: 'local', status: 'configured', tone: 'info'}],
            validation: {detail: 'cantonctl.yaml validates against the canonical schema.', valid: true},
            yaml: 'profiles:\n  splice-localnet: {}',
          },
        },
        success: true,
      })
    }

    if (url.startsWith('/ui/support?profile=splice-devnet')) {
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
  it('renders the map-first control center, switches modes, and loads secondary views', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<App />)

    expect(await screen.findByText('Topology-first control map')).toBeTruthy()
    expect((await screen.findAllByText('1 blocking issue')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ledger').length).toBeGreaterThan(0)
    expect(screen.getByText('Wallet')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-localnet')
    expect(await screen.findByText('LocalNet Workspace')).toBeTruthy()
    expect(screen.getByText('Workspace /workspace.')).toBeTruthy()
    expect(screen.getAllByText('Validator readyz healthy.').length).toBeGreaterThan(0)

    await user.selectOptions(screen.getByLabelText('Selected profile'), 'splice-devnet')
    expect(await screen.findByText('Credential required')).toBeTruthy()
    expect(screen.getByText('Remote service graph on devnet.')).toBeTruthy()

    await user.click(screen.getAllByText('Checks')[0].closest('button')!)
    expect(await screen.findByText('Failure-oriented view')).toBeTruthy()
    expect(screen.getByText('Locate on map: auth')).toBeTruthy()

    await user.click(screen.getAllByText('Profiles')[0].closest('button')!)
    expect(await screen.findByText('Diff Panel')).toBeTruthy()
    expect(screen.getAllByText('splice-localnet').length).toBeGreaterThan(0)

    await user.click(screen.getAllByText('Support')[0].closest('button')!)
    expect(await screen.findByText('/repo/.cantonctl/diagnostics/splice-devnet')).toBeTruthy()
    expect(screen.getByText('wallet-sdk')).toBeTruthy()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/ui/map?profile=splice-devnet', expect.objectContaining({
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
