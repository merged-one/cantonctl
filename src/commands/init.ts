import {Args, Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const TEMPLATES = ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm'] as const
type Template = typeof TEMPLATES[number]

export default class Init extends Command {
  static override args = {
    name: Args.string({
      description: 'Project name',
      required: true,
    }),
  }

  static override description = 'Scaffold a new Canton project from a template'

  static override examples = [
    '<%= config.bin %> init my-app',
    '<%= config.bin %> init my-defi-app --template token',
    '<%= config.bin %> init my-app --from https://github.com/user/template',
  ]

  static override flags = {
    from: Flags.string({
      char: 'f',
      description: 'Create from a community template (GitHub URL)',
      exclusive: ['template'],
    }),
    template: Flags.string({
      char: 't',
      default: 'basic',
      description: `Project template (${TEMPLATES.join(', ')})`,
      options: [...TEMPLATES],
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)
    const projectDir = path.resolve(args.name)

    if (fs.existsSync(projectDir)) {
      this.error(`Directory ${args.name} already exists`)
    }

    if (flags.from) {
      this.log(`Scaffolding from community template: ${flags.from}`)
      // TODO: Clone community template and apply cantonctl-template.yaml manifest
      return
    }

    const template = flags.template as Template
    this.log(`Creating new Canton project: ${args.name}`)
    this.log(`Template: ${template}`)

    // Create project structure
    await this.scaffold(projectDir, args.name, template)

    this.log('')
    this.log(`Project created at ./${args.name}`)
    this.log('')
    this.log('Next steps:')
    this.log(`  cd ${args.name}`)
    this.log('  cantonctl dev        # Start local Canton node')
    this.log('  cantonctl build      # Compile Daml contracts')
    this.log('  cantonctl test       # Run tests')
  }

  private async scaffold(dir: string, name: string, template: Template): Promise<void> {
    // Create directory structure
    const dirs = [
      dir,
      path.join(dir, 'daml'),
      path.join(dir, 'test'),
      path.join(dir, 'scripts'),
    ]

    if (['token', 'defi-amm', 'zenith-evm'].includes(template)) {
      dirs.push(
        path.join(dir, 'frontend'),
        path.join(dir, 'frontend', 'src'),
        path.join(dir, 'frontend', 'src', 'hooks'),
      )
    }

    for (const d of dirs) {
      fs.mkdirSync(d, {recursive: true})
    }

    // Write cantonctl.yaml
    fs.writeFileSync(
      path.join(dir, 'cantonctl.yaml'),
      this.generateConfig(name, template),
    )

    // Write daml.yaml
    fs.writeFileSync(
      path.join(dir, 'daml.yaml'),
      this.generateDamlYaml(name),
    )

    // Write template-specific Daml source
    fs.writeFileSync(
      path.join(dir, 'daml', 'Main.daml'),
      this.generateDamlSource(template),
    )

    // Write test file
    fs.writeFileSync(
      path.join(dir, 'test', 'Main.test.daml'),
      this.generateDamlTest(template),
    )

    // Write .gitignore
    fs.writeFileSync(
      path.join(dir, '.gitignore'),
      ['.cantonctl/', '.daml/', 'node_modules/', 'dist/', '*.dar'].join('\n'),
    )
  }

  private generateConfig(name: string, template: string): string {
    return `# cantonctl project configuration
version: 1

project:
  name: ${name}
  sdk-version: "3.4.9"
  template: ${template}

parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant

networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575

plugins: []
`
  }

  private generateDamlYaml(name: string): string {
    return `sdk-version: 3.4.9
name: ${name}
version: 1.0.0
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
`
  }

  private generateDamlSource(template: Template): string {
    switch (template) {
      case 'token': {
        return `module Main where

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
      }

      case 'defi-amm': {
        return `module Main where

template LiquidityPool
  with
    operator : Party
    tokenA : Text
    tokenB : Text
    reserveA : Decimal
    reserveB : Decimal
  where
    signatory operator

    choice AddLiquidity : ContractId LiquidityPool
      with
        amountA : Decimal
        amountB : Decimal
      controller operator
      do
        create this with
          reserveA = reserveA + amountA
          reserveB = reserveB + amountB

    choice Swap : (ContractId LiquidityPool, Decimal)
      with
        inputToken : Text
        inputAmount : Decimal
      controller operator
      do
        let (inputReserve, outputReserve) =
              if inputToken == tokenA then (reserveA, reserveB)
              else (reserveB, reserveA)
        let outputAmount = (inputAmount * outputReserve) / (inputReserve + inputAmount)
        let newPool = if inputToken == tokenA
              then this with reserveA = reserveA + inputAmount, reserveB = reserveB - outputAmount
              else this with reserveA = reserveA - outputAmount, reserveB = reserveB + inputAmount
        poolId <- create newPool
        return (poolId, outputAmount)
`
      }

      default: {
        return `module Main where

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
      do
        create this with message = newMessage
`
      }
    }
  }

  private generateDamlTest(template: Template): string {
    switch (template) {
      case 'token': {
        return `module Main.Test where

import Main
import Daml.Script

testMint : Script ()
testMint = script do
  alice <- allocateParty "Alice"
  tokenId <- submit alice do
    createCmd Token with owner = alice, symbol = "CTK", amount = 1000.0
  submit alice do
    exerciseCmd tokenId Mint with mintAmount = 500.0
  pure ()

testTransfer : Script ()
testTransfer = script do
  alice <- allocateParty "Alice"
  bob <- allocateParty "Bob"
  tokenId <- submit alice do
    createCmd Token with owner = alice, symbol = "CTK", amount = 1000.0
  submit alice do
    exerciseCmd tokenId Transfer with newOwner = bob, transferAmount = 250.0
  pure ()

testCannotOverTransfer : Script ()
testCannotOverTransfer = script do
  alice <- allocateParty "Alice"
  bob <- allocateParty "Bob"
  tokenId <- submit alice do
    createCmd Token with owner = alice, symbol = "CTK", amount = 100.0
  submitMustFail alice do
    exerciseCmd tokenId Transfer with newOwner = bob, transferAmount = 200.0
  pure ()

testBurn : Script ()
testBurn = script do
  alice <- allocateParty "Alice"
  tokenId <- submit alice do
    createCmd Token with owner = alice, symbol = "CTK", amount = 100.0
  submit alice do
    exerciseCmd tokenId Burn
  pure ()
`
      }

      default: {
        return `module Main.Test where

import Main
import Daml.Script

testCreate : Script ()
testCreate = script do
  alice <- allocateParty "Alice"
  submit alice do
    createCmd Hello with owner = alice, message = "Hello, Canton!"
  pure ()

testUpdate : Script ()
testUpdate = script do
  alice <- allocateParty "Alice"
  helloId <- submit alice do
    createCmd Hello with owner = alice, message = "Hello, Canton!"
  submit alice do
    exerciseCmd helloId UpdateMessage with newMessage = "Updated!"
  pure ()
`
      }
    }
  }
}
