import {describe, expect, it} from 'vitest'

import {parseDamlSource} from './daml-parser.js'

// ---------------------------------------------------------------------------
// Test fixtures (matching cantonctl scaffold templates)
// ---------------------------------------------------------------------------

const TOKEN_TEMPLATE = `module Main where

template Token
  with
    owner : Party
    symbol : Text
    amount : Decimal
  where
    signatory owner

    choice Transfer : (ContractId Token, ContractId Token)
      with
        newOwner : Party
        transferAmount : Decimal
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        remaining <- create this with amount = amount - transferAmount
        transferred <- create Token with owner = newOwner, symbol, amount = transferAmount
        return (remaining, transferred)

    choice Burn : ()
      controller owner
      do return ()

    choice Mint : ContractId Token
      with
        mintAmount : Decimal
      controller owner
      do
        assert (mintAmount > 0.0)
        create this with amount = amount + mintAmount
`

const BASIC_TEMPLATE = `module Main where

template Hello
  with
    owner : Party
    message : Text
  where
    signatory owner

    choice UpdateMessage : ContractId Hello
      with
        newMessage : Text
      controller owner
      do create this with message = newMessage
`

const DEFI_AMM_TEMPLATE = `module Main where

template LiquidityPool
  with
    operator : Party
    tokenA : Text
    tokenB : Text
    reserveA : Decimal
    reserveB : Decimal
  where
    signatory operator

    choice AddLiquidity : (ContractId LiquidityPool, Decimal)
      with
        amountA : Decimal
        amountB : Decimal
      controller operator
      do
        let newReserveA = reserveA + amountA
        let newReserveB = reserveB + amountB
        let lpTokens = amountA
        pool <- create this with reserveA = newReserveA, reserveB = newReserveB
        return (pool, lpTokens)

    choice Swap : (ContractId LiquidityPool, Decimal)
      with
        inputToken : Text
        inputAmount : Decimal
      controller operator
      do
        let k = reserveA * reserveB
        let outputAmount = reserveB - (k / (reserveA + inputAmount))
        pool <- create this with reserveA = reserveA + inputAmount, reserveB = reserveB - outputAmount
        return (pool, outputAmount)
`

const API_SERVICE_TEMPLATE = `module Main where

template Record
  with
    owner : Party
    key : Text
    value : Text
  where
    signatory owner

    choice UpdateValue : ContractId Record
      with
        newValue : Text
      controller owner
      do create this with value = newValue

    choice Archive_Record : ()
      controller owner
      do return ()
`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DamlParser', () => {
  describe('parseDamlSource', () => {
    it('extracts module name', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      expect(result.module).toBe('Main')
    })

    it('finds all templates in a file', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      expect(result.templates).toHaveLength(1)
      expect(result.templates[0].name).toBe('Token')
    })

    it('extracts template fields with types', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const token = result.templates[0]

      expect(token.fields).toEqual([
        {name: 'owner', type: 'Party'},
        {name: 'symbol', type: 'Text'},
        {name: 'amount', type: 'Decimal'},
      ])
    })

    it('extracts signatory', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      expect(result.templates[0].signatory).toBe('owner')
    })

    it('extracts all choices', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const choices = result.templates[0].choices

      expect(choices).toHaveLength(3)
      expect(choices.map(c => c.name)).toEqual(['Transfer', 'Burn', 'Mint'])
    })

    it('extracts choice arguments', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const transfer = result.templates[0].choices.find(c => c.name === 'Transfer')!

      expect(transfer.args).toEqual([
        {name: 'newOwner', type: 'Party'},
        {name: 'transferAmount', type: 'Decimal'},
      ])
    })

    it('handles no-arg choices', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const burn = result.templates[0].choices.find(c => c.name === 'Burn')!

      expect(burn.args).toEqual([])
      expect(burn.returnType).toBe('()')
    })

    it('extracts return types including tuples', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const transfer = result.templates[0].choices.find(c => c.name === 'Transfer')!
      const mint = result.templates[0].choices.find(c => c.name === 'Mint')!

      expect(transfer.returnType).toBe('(ContractId Token, ContractId Token)')
      expect(mint.returnType).toBe('ContractId Token')
    })

    it('extracts controller', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      const transfer = result.templates[0].choices.find(c => c.name === 'Transfer')!
      expect(transfer.controller).toBe('owner')
    })

    it('marks all choices as consuming by default', () => {
      const result = parseDamlSource(TOKEN_TEMPLATE)
      for (const choice of result.templates[0].choices) {
        expect(choice.consuming).toBe(true)
      }
    })

    it('parses basic Hello template', () => {
      const result = parseDamlSource(BASIC_TEMPLATE)
      const hello = result.templates[0]

      expect(hello.name).toBe('Hello')
      expect(hello.fields).toEqual([
        {name: 'owner', type: 'Party'},
        {name: 'message', type: 'Text'},
      ])
      expect(hello.choices).toHaveLength(1)
      expect(hello.choices[0].name).toBe('UpdateMessage')
      expect(hello.choices[0].args).toEqual([{name: 'newMessage', type: 'Text'}])
    })

    it('parses DeFi AMM template with 5 fields', () => {
      const result = parseDamlSource(DEFI_AMM_TEMPLATE)
      const pool = result.templates[0]

      expect(pool.name).toBe('LiquidityPool')
      expect(pool.fields).toHaveLength(5)
      expect(pool.fields.map(f => f.name)).toEqual([
        'operator', 'tokenA', 'tokenB', 'reserveA', 'reserveB',
      ])
      expect(pool.signatory).toBe('operator')
      expect(pool.choices).toHaveLength(2)
      expect(pool.choices.map(c => c.name)).toEqual(['AddLiquidity', 'Swap'])
    })

    it('parses tuple return types from AMM choices', () => {
      const result = parseDamlSource(DEFI_AMM_TEMPLATE)
      const addLiq = result.templates[0].choices[0]

      expect(addLiq.returnType).toBe('(ContractId LiquidityPool, Decimal)')
      expect(addLiq.args).toEqual([
        {name: 'amountA', type: 'Decimal'},
        {name: 'amountB', type: 'Decimal'},
      ])
    })

    it('parses API service template with underscored choice', () => {
      const result = parseDamlSource(API_SERVICE_TEMPLATE)
      const record = result.templates[0]

      expect(record.name).toBe('Record')
      expect(record.choices).toHaveLength(2)
      expect(record.choices[1].name).toBe('Archive_Record')
      expect(record.choices[1].args).toEqual([])
    })

    it('returns empty templates for non-Daml content', () => {
      const result = parseDamlSource('-- just a comment\nsome random text')
      expect(result.templates).toEqual([])
      expect(result.module).toBe('Unknown')
    })

    it('handles empty source', () => {
      const result = parseDamlSource('')
      expect(result.templates).toEqual([])
      expect(result.module).toBe('Unknown')
    })
  })
})
