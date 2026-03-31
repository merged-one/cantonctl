import {describe, expect, it, vi} from 'vitest'

import {CantonctlError, ErrorCode} from '../errors.js'
import type {LedgerClient} from '../ledger-client.js'
import type {OutputWriter} from '../output.js'
import {createExecutor, type ExecutorDeps} from './executor.js'
import type {ReplCommand} from './parser.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockClient(): LedgerClient & {
  allocateParty: ReturnType<typeof vi.fn>
  getActiveContracts: ReturnType<typeof vi.fn>
  getParties: ReturnType<typeof vi.fn>
  getVersion: ReturnType<typeof vi.fn>
  submitAndWait: ReturnType<typeof vi.fn>
  uploadDar: ReturnType<typeof vi.fn>
} {
  return {
    allocateParty: vi.fn(),
    getActiveContracts: vi.fn().mockResolvedValue({activeContracts: []}),
    getParties: vi.fn().mockResolvedValue({partyDetails: []}),
    getVersion: vi.fn().mockResolvedValue({version: '3.4.9'}),
    submitAndWait: vi.fn().mockResolvedValue({transaction: {transactionId: 'tx-123'}}),
    uploadDar: vi.fn(),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

function createTestExecutor(overrides: Partial<ExecutorDeps> = {}) {
  const client = createMockClient()
  const output = createMockOutput()
  const executor = createExecutor({client, output, ...overrides})
  return {client, executor, output}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Executor', () => {
  describe('help', () => {
    it('prints help and continues', async () => {
      const {executor, output} = createTestExecutor()
      const cont = await executor.execute({type: 'help'})

      expect(cont).toBe(true)
      expect(output.log).toHaveBeenCalledWith(expect.stringContaining('Available commands'))
    })
  })

  describe('exit', () => {
    it('returns false to stop the REPL', async () => {
      const {executor} = createTestExecutor()
      const cont = await executor.execute({type: 'exit'})
      expect(cont).toBe(false)
    })
  })

  describe('status', () => {
    it('queries version and prints result', async () => {
      const {client, executor, output} = createTestExecutor()
      const cont = await executor.execute({type: 'status'})

      expect(cont).toBe(true)
      expect(client.getVersion).toHaveBeenCalled()
      expect(output.success).toHaveBeenCalledWith('Node healthy (v3.4.9)')
    })
  })

  describe('parties', () => {
    it('shows table when parties exist', async () => {
      const {client, executor, output} = createTestExecutor()
      client.getParties.mockResolvedValue({
        partyDetails: [
          {displayName: 'Alice', identifier: 'Alice::1234', isLocal: true},
        ],
      })

      const cont = await executor.execute({type: 'parties'})
      expect(cont).toBe(true)
      expect(output.table).toHaveBeenCalledWith(
        ['Party', 'ID', 'Local'],
        [['Alice', 'Alice::1234', 'true']],
      )
    })

    it('shows info when no parties', async () => {
      const {executor, output} = createTestExecutor()
      await executor.execute({type: 'parties'})
      expect(output.info).toHaveBeenCalledWith('No parties found')
    })
  })

  describe('query', () => {
    it('queries contracts with party and template', async () => {
      const {client, executor} = createTestExecutor()
      const cmd: ReplCommand = {party: 'Alice', templateId: 'MyModule:MyTemplate', type: 'query'}
      await executor.execute(cmd)

      expect(client.getActiveContracts).toHaveBeenCalledWith({
        filter: {party: 'Alice', templateIds: ['MyModule:MyTemplate']},
      })
    })

    it('uses default party when none specified', async () => {
      const {client, executor} = createTestExecutor({defaultParty: 'Bob'})
      await executor.execute({type: 'query'})
      expect(client.getActiveContracts).toHaveBeenCalledWith({
        filter: {party: 'Bob', templateIds: undefined},
      })
    })

    it('throws when no party available', async () => {
      const {executor} = createTestExecutor()
      await expect(executor.execute({type: 'query'})).rejects.toThrow(CantonctlError)
    })

    it('shows contracts when found', async () => {
      const {client, executor, output} = createTestExecutor({defaultParty: 'Alice'})
      client.getActiveContracts.mockResolvedValue({
        activeContracts: [{contractId: 'c1', payload: {}}],
      })

      await executor.execute({type: 'query'})
      expect(output.log).toHaveBeenCalledWith('Found 1 active contract(s):')
    })
  })

  describe('submit create', () => {
    it('creates a contract', async () => {
      const {client, executor, output} = createTestExecutor()
      const cmd: ReplCommand = {
        action: 'create',
        party: 'Alice',
        payload: '{"owner": "Alice"}',
        templateId: 'MyModule:MyTemplate',
        type: 'submit',
      }

      await executor.execute(cmd)
      expect(client.submitAndWait).toHaveBeenCalledWith(expect.objectContaining({
        actAs: ['Alice'],
        commands: [{CreateCommand: {payload: {owner: 'Alice'}, templateId: 'MyModule:MyTemplate'}}],
      }))
      expect(output.success).toHaveBeenCalledWith('Contract created')
    })

    it('throws on invalid JSON payload', async () => {
      const {executor} = createTestExecutor()
      const cmd: ReplCommand = {
        action: 'create',
        party: 'Alice',
        payload: 'not json',
        templateId: 'T',
        type: 'submit',
      }

      await expect(executor.execute(cmd)).rejects.toThrow(CantonctlError)
    })
  })

  describe('submit exercise', () => {
    it('exercises a choice', async () => {
      const {client, executor, output} = createTestExecutor()
      const cmd: ReplCommand = {
        action: 'exercise',
        choiceName: 'Accept',
        contractId: 'c123',
        party: 'Alice',
        payload: '{}',
        type: 'submit',
      }

      await executor.execute(cmd)
      expect(client.submitAndWait).toHaveBeenCalledWith(expect.objectContaining({
        actAs: ['Alice'],
        commands: [{ExerciseCommand: {argument: {}, choiceName: 'Accept', contractId: 'c123'}}],
      }))
      expect(output.success).toHaveBeenCalledWith('Choice exercised')
    })
  })

  describe('unknown command', () => {
    it('throws CONSOLE_UNKNOWN_COMMAND for non-empty unknown', async () => {
      const {executor} = createTestExecutor()
      await expect(executor.execute({raw: 'foobar', type: 'unknown'}))
        .rejects.toThrow(CantonctlError)

      try {
        await executor.execute({raw: 'foobar', type: 'unknown'})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.CONSOLE_UNKNOWN_COMMAND)
      }
    })

    it('continues silently for empty unknown', async () => {
      const {executor} = createTestExecutor()
      const cont = await executor.execute({raw: '', type: 'unknown'})
      expect(cont).toBe(true)
    })
  })
})
