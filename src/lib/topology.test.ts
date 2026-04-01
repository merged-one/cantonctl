/**
 * Tests for topology generation module.
 *
 * The topology module is a pure function — it takes config and returns strings.
 * No mocking needed, no I/O, just input → output verification.
 */

import {describe, expect, it} from 'vitest'
import type {CantonctlConfig} from './config.js'
import {generateTopology, type TopologyOptions} from './topology.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConfig(overrides: Partial<CantonctlConfig> = {}): CantonctlConfig {
  return {
    networks: {local: {type: 'sandbox' as const}},
    parties: [
      {name: 'Alice', role: 'operator' as const},
      {name: 'Bob', role: 'participant' as const},
    ],
    project: {name: 'test-project', 'sdk-version': '3.4.11'},
    version: 1,
    ...overrides,
  }
}

function createOpts(overrides: Partial<TopologyOptions> = {}): TopologyOptions {
  return {
    cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
    config: createConfig(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateTopology', () => {
  describe('participant assignment', () => {
    it('assigns operator parties to participant1', () => {
      const topology = generateTopology(createOpts())
      const p1 = topology.participants.find(p => p.name === 'participant1')
      expect(p1?.parties).toContain('Alice')
    })

    it('assigns participant-role parties to participant2', () => {
      const topology = generateTopology(createOpts())
      const p2 = topology.participants.find(p => p.name === 'participant2')
      expect(p2?.parties).toContain('Bob')
    })

    it('assigns observer parties to participant2', () => {
      const config = createConfig({
        parties: [
          {name: 'Alice', role: 'operator'},
          {name: 'Charlie', role: 'observer'},
        ],
      })
      const topology = generateTopology(createOpts({config}))
      const p2 = topology.participants.find(p => p.name === 'participant2')
      expect(p2?.parties).toContain('Charlie')
    })

    it('round-robins parties without roles', () => {
      const config = createConfig({
        parties: [
          {name: 'A'},
          {name: 'B'},
          {name: 'C'},
          {name: 'D'},
        ],
      })
      const topology = generateTopology(createOpts({config}))
      const p1 = topology.participants.find(p => p.name === 'participant1')!
      const p2 = topology.participants.find(p => p.name === 'participant2')!
      expect(p1.parties).toEqual(['A', 'C'])
      expect(p2.parties).toEqual(['B', 'D'])
    })

    it('creates at least 2 participants even with 0 parties', () => {
      const config = createConfig({parties: []})
      const topology = generateTopology(createOpts({config}))
      expect(topology.participants.length).toBeGreaterThanOrEqual(2)
    })

    it('creates at least 2 participants with only operator parties', () => {
      const config = createConfig({
        parties: [{name: 'Alice', role: 'operator'}],
      })
      const topology = generateTopology(createOpts({config}))
      expect(topology.participants.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('port assignment', () => {
    it('uses default base port of 10000', () => {
      const topology = generateTopology(createOpts())
      // Synchronizer uses range 0: 10001 (admin), 10002 (public)
      expect(topology.synchronizer.admin).toBe(10_001)
      expect(topology.synchronizer.publicApi).toBe(10_002)
    })

    it('assigns participant ports with 10-port stride', () => {
      const topology = generateTopology(createOpts())
      const p1 = topology.participants[0]
      // Participant 1 uses range 1: 10010+offsets
      expect(p1.ports.admin).toBe(10_011)
      expect(p1.ports.ledgerApi).toBe(10_012)
      expect(p1.ports.jsonApi).toBe(10_013)

      const p2 = topology.participants[1]
      // Participant 2 uses range 2: 10020+offsets
      expect(p2.ports.admin).toBe(10_021)
      expect(p2.ports.ledgerApi).toBe(10_022)
      expect(p2.ports.jsonApi).toBe(10_023)
    })

    it('respects custom base port', () => {
      const topology = generateTopology(createOpts({basePort: 20_000}))
      expect(topology.synchronizer.admin).toBe(20_001)
      expect(topology.participants[0].ports.jsonApi).toBe(20_013)
    })

    it('no port collisions between participants', () => {
      const config = createConfig({
        parties: [
          {name: 'A', role: 'operator'},
          {name: 'B', role: 'participant'},
          {name: 'C'},
          {name: 'D'},
          {name: 'E'},
        ],
      })
      const topology = generateTopology(createOpts({config}))
      const allPorts = new Set<number>()

      allPorts.add(topology.synchronizer.admin)
      allPorts.add(topology.synchronizer.publicApi)

      for (const p of topology.participants) {
        allPorts.add(p.ports.admin)
        allPorts.add(p.ports.ledgerApi)
        allPorts.add(p.ports.jsonApi)
      }

      // Total unique ports = 2 (sync) + 3 * N (participants)
      const expectedCount = 2 + 3 * topology.participants.length
      expect(allPorts.size).toBe(expectedCount)
    })
  })

  describe('Canton HOCON generation', () => {
    it('contains canton block', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('canton {')
    })

    it('contains domain definition', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('local-domain')
      expect(cantonConf).toContain('domains {')
    })

    it('uses in-memory storage for all nodes', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('storage.type = memory')
    })

    it('configures each participant with correct ports', () => {
      const topology = generateTopology(createOpts())
      const p1 = topology.participants[0]
      expect(topology.cantonConf).toContain(`port = ${p1.ports.ledgerApi}`)
      expect(topology.cantonConf).toContain(`port = ${p1.ports.admin}`)
      expect(topology.cantonConf).toContain(`port = ${p1.ports.jsonApi}`)
    })

    it('configures http-ledger-api for each participant', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('http-ledger-api')
    })

    it('configures synchronizer public and admin APIs', () => {
      const topology = generateTopology(createOpts())
      expect(topology.cantonConf).toContain(`port = ${topology.synchronizer.publicApi}`)
      expect(topology.cantonConf).toContain(`port = ${topology.synchronizer.admin}`)
    })

    it('includes non-standard-config flag', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('non-standard-config = yes')
    })

    it('includes auto-start (manual-start = no)', () => {
      const {cantonConf} = generateTopology(createOpts())
      expect(cantonConf).toContain('manual-start = no')
    })
  })

  describe('bootstrap script generation', () => {
    it('connects each participant to the local domain', () => {
      const topology = generateTopology(createOpts())
      for (const p of topology.participants) {
        expect(topology.bootstrapScript).toContain(
          `${p.name}.domains.connect_local(local_domain)`,
        )
      }
    })

    it('includes generated header comment', () => {
      const {bootstrapScript} = generateTopology(createOpts())
      expect(bootstrapScript).toContain('Generated by cantonctl')
    })
  })

  describe('Docker Compose generation', () => {
    it('includes canton service', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).toContain('services:')
      expect(dockerCompose).toContain('canton:')
    })

    it('uses the specified Canton image', () => {
      const image = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'
      const {dockerCompose} = generateTopology(createOpts({cantonImage: image}))
      expect(dockerCompose).toContain(`image: ${image}`)
    })

    it('mounts canton.conf and bootstrap.canton as volumes', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).toContain('canton.conf:/canton/canton.conf')
      expect(dockerCompose).toContain('bootstrap.canton:/canton/bootstrap.canton')
    })

    it('runs canton in daemon mode with config and bootstrap', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).toContain('daemon')
      expect(dockerCompose).toContain('--config')
      expect(dockerCompose).toContain('--bootstrap')
    })

    it('exposes all participant JSON API ports', () => {
      const topology = generateTopology(createOpts())
      for (const p of topology.participants) {
        expect(topology.dockerCompose).toContain(`${p.ports.jsonApi}:${p.ports.jsonApi}`)
      }
    })

    it('exposes synchronizer ports', () => {
      const topology = generateTopology(createOpts())
      expect(topology.dockerCompose).toContain(
        `${topology.synchronizer.publicApi}:${topology.synchronizer.publicApi}`,
      )
    })

    it('includes health check that polls all participant JSON APIs', () => {
      const topology = generateTopology(createOpts())
      for (const p of topology.participants) {
        expect(topology.dockerCompose).toContain(
          `curl -sf http://localhost:${p.ports.jsonApi}/v2/version`,
        )
      }
    })

    it('uses project name from config', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).toContain('name: test-project')
    })

    it('allows custom project name', () => {
      const {dockerCompose} = generateTopology(createOpts({projectName: 'custom-name'}))
      expect(dockerCompose).toContain('name: custom-name')
    })

    it('uses tmpfs for temp files', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).toContain('tmpfs:')
      expect(dockerCompose).toContain('/tmp')
    })
  })

  describe('end-to-end generation', () => {
    it('returns all required fields', () => {
      const topology = generateTopology(createOpts())
      expect(topology.cantonConf).toBeTruthy()
      expect(topology.bootstrapScript).toBeTruthy()
      expect(topology.dockerCompose).toBeTruthy()
      expect(topology.participants).toBeTruthy()
      expect(topology.synchronizer).toBeTruthy()
    })

    it('generates valid YAML (no tabs in Docker Compose)', () => {
      const {dockerCompose} = generateTopology(createOpts())
      expect(dockerCompose).not.toContain('\t')
    })
  })
})
