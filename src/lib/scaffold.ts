/**
 * @module scaffold
 *
 * Pure scaffolding logic for `cantonctl init`. Generates project directory
 * structures, configuration files, Daml source code, and template-specific
 * artifacts (Express.js for api-service, Solidity/Hardhat for zenith-evm).
 *
 * All filesystem operations go through an injectable {@link ScaffoldFileSystem}
 * interface, enabling tests to capture writes without touching disk.
 *
 * @example
 * ```ts
 * import { scaffoldProject } from './scaffold.js'
 *
 * const result = scaffoldProject({
 *   name: 'my-app',
 *   template: 'token',
 *   dir: '/home/user/my-app',
 * })
 * console.log(`Created ${result.files.length} files in ${result.projectDir}`)
 * ```
 */

import * as nodeFs from 'node:fs'
import * as path from 'node:path'

import {CantonctlError, ErrorCode} from './errors.js'
import type {ProcessRunner} from './process-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TEMPLATES = ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm'] as const
export type Template = typeof TEMPLATES[number]

/** Minimal filesystem interface for scaffolding. Inject a mock in tests. */
export interface ScaffoldFileSystem {
  mkdirSync(path: string, opts?: {recursive?: boolean}): void
  writeFileSync(path: string, content: string): void
  existsSync(path: string): boolean
}

export interface ScaffoldOptions {
  /** Project name (used in config and package metadata). */
  name: string
  /** Which template to scaffold. */
  template: Template
  /** Absolute path to the target project directory. */
  dir: string
  /** Filesystem implementation. Defaults to Node's `fs`. */
  fs?: ScaffoldFileSystem
}

export interface ScaffoldResult {
  /** Absolute path to the created project directory. */
  projectDir: string
  /** Template that was used. */
  template: Template
  /** List of created file paths (relative to projectDir). */
  files: string[]
}

export interface ScaffoldFromUrlOptions {
  /** URL of the community template repository. */
  url: string
  /** Absolute path to the target project directory. */
  dir: string
  /** Process runner for git operations. */
  runner: ProcessRunner
  /** Filesystem implementation. */
  fs?: ScaffoldFileSystem
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SDK_VERSION = '3.4.9'

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * Scaffold a new Canton project from a built-in template.
 *
 * Creates directory structure, generates `cantonctl.yaml`, `daml.yaml`,
 * template-specific Daml source, tests, and any additional files
 * required by the template (e.g., Express.js server for api-service).
 *
 * @throws {CantonctlError} If the target directory already exists
 */
export function scaffoldProject(opts: ScaffoldOptions): ScaffoldResult {
  const fsImpl = opts.fs ?? nodeFs
  const {dir, name, template} = opts

  if (fsImpl.existsSync(dir)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {dir},
      suggestion: `Directory "${name}" already exists. Choose a different name or remove the existing directory.`,
    })
  }

  const files: string[] = []

  // Create directory structure
  const dirs = [dir, path.join(dir, 'daml'), path.join(dir, 'test'), path.join(dir, 'scripts')]

  if (['token', 'defi-amm', 'zenith-evm'].includes(template)) {
    dirs.push(path.join(dir, 'frontend'), path.join(dir, 'frontend', 'src'))
  }

  if (template === 'api-service') {
    dirs.push(path.join(dir, 'server'), path.join(dir, 'server', 'src'))
  }

  if (template === 'zenith-evm') {
    dirs.push(path.join(dir, 'contracts'))
  }

  for (const d of dirs) {
    fsImpl.mkdirSync(d, {recursive: true})
  }

  // Write common files
  const writeFile = (relPath: string, content: string) => {
    fsImpl.writeFileSync(path.join(dir, relPath), content)
    files.push(relPath)
  }

  writeFile('cantonctl.yaml', generateConfig(name, template))
  writeFile('daml.yaml', generateDamlYaml(name))
  writeFile(path.join('daml', 'Main.daml'), generateDamlSource(template))
  writeFile(path.join('test', 'Main.test.daml'), generateDamlTest(template))
  writeFile('.gitignore', generateGitignore(template))

  // Template-specific files
  if (template === 'api-service') {
    const apiFiles = generateApiServiceFiles(name)
    for (const [relPath, content] of Object.entries(apiFiles)) {
      writeFile(relPath, content)
    }
  }

  if (template === 'zenith-evm') {
    const evmFiles = generateZenithEvmFiles(name)
    for (const [relPath, content] of Object.entries(evmFiles)) {
      writeFile(relPath, content)
    }
  }

  return {files, projectDir: dir, template}
}

/**
 * Scaffold a project from a community template repository.
 *
 * Clones the repository via git and validates that a `cantonctl-template.yaml`
 * manifest exists in the root.
 *
 * @throws {CantonctlError} If git clone fails or manifest is missing
 */
export async function scaffoldFromUrl(opts: ScaffoldFromUrlOptions): Promise<void> {
  const fsImpl = opts.fs ?? nodeFs

  const result = await opts.runner.run('git', ['clone', '--depth', '1', opts.url, opts.dir], {
    ignoreExitCode: true,
    timeout: 60_000, // 60s timeout for git clone
  })

  if (result.exitCode !== 0) {
    throw new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
      context: {stderr: result.stderr, url: opts.url},
      suggestion: `Failed to clone template from ${opts.url}. Check the URL and your network connection.`,
    })
  }

  const manifestPath = path.join(opts.dir, 'cantonctl-template.yaml')
  if (!fsImpl.existsSync(manifestPath)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {url: opts.url},
      suggestion: `The repository at ${opts.url} does not contain a cantonctl-template.yaml manifest. Community templates must include this file.`,
    })
  }
}

// ---------------------------------------------------------------------------
// Config generation
// ---------------------------------------------------------------------------

/** Generate `cantonctl.yaml` content for a project. */
export function generateConfig(name: string, template: string): string {
  return `# cantonctl project configuration
version: 1

project:
  name: ${name}
  sdk-version: "${SDK_VERSION}"
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

/** Generate `daml.yaml` content for a project. */
function generateDamlYaml(name: string): string {
  return `sdk-version: ${SDK_VERSION}
name: ${name}
version: 1.0.0
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
`
}

// ---------------------------------------------------------------------------
// Daml source generation
// ---------------------------------------------------------------------------

/** Generate the main Daml source file for a template. */
export function generateDamlSource(template: Template): string {
  switch (template) {
    case 'token':
      return DAML_TOKEN

    case 'defi-amm':
      return DAML_DEFI_AMM

    case 'api-service':
      return DAML_API_SERVICE

    case 'zenith-evm':
      return DAML_ZENITH_EVM

    default:
      return DAML_BASIC
  }
}

/** Generate the Daml Script test file for a template. */
export function generateDamlTest(template: Template): string {
  switch (template) {
    case 'token':
      return TEST_TOKEN

    case 'defi-amm':
      return TEST_DEFI_AMM

    case 'api-service':
      return TEST_API_SERVICE

    case 'zenith-evm':
      return TEST_ZENITH_EVM

    default:
      return TEST_BASIC
  }
}

// ---------------------------------------------------------------------------
// Template-specific file generation
// ---------------------------------------------------------------------------

/** Generate Express.js + Ledger API client files for api-service template. */
function generateApiServiceFiles(name: string): Record<string, string> {
  return {
    [path.join('server', 'package.json')]: JSON.stringify({
      dependencies: {
        express: '^4.18.0',
      },
      description: `${name} API service for Canton Ledger`,
      devDependencies: {
        '@types/express': '^4.17.0',
        '@types/node': '^22',
        tsx: '^4',
        typescript: '^5',
      },
      main: 'dist/server.js',
      name: `${name}-server`,
      scripts: {
        build: 'tsc',
        dev: 'tsx watch src/server.ts',
        start: 'node dist/server.js',
      },
      type: 'module',
      version: '0.1.0',
    }, null, 2) + '\n',

    [path.join('server', 'src', 'server.ts')]: `/**
 * Express.js API service consuming the Canton JSON Ledger API.
 *
 * Endpoints:
 *   GET  /health          — Service health check
 *   GET  /api/contracts   — Query active contracts
 *   POST /api/commands    — Submit a command to the ledger
 *   GET  /api/parties     — List known parties
 */

import express from 'express'

const app = express()
app.use(express.json())

const LEDGER_API = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const JWT_TOKEN = process.env.LEDGER_JWT ?? ''

/** Helper to make authenticated requests to the Canton Ledger API. */
async function ledgerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(\`\${LEDGER_API}\${path}\`, {
    ...options,
    headers: {
      Authorization: \`Bearer \${JWT_TOKEN}\`,
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    },
  })
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/contracts', async (_req, res) => {
  try {
    const response = await ledgerFetch('/v2/state/active-contracts', {
      body: JSON.stringify({ filter: {} }),
      method: 'POST',
    })
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to query ledger' })
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
  } catch (err) {
    res.status(502).json({ error: 'Failed to submit command' })
  }
})

app.get('/api/parties', async (_req, res) => {
  try {
    const response = await ledgerFetch('/v2/parties')
    const data = await response.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to list parties' })
  }
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)
app.listen(PORT, () => {
  console.log(\`\${name} API listening on http://localhost:\${PORT}\`)
  console.log(\`Ledger API: \${LEDGER_API}\`)
})
`,

    [path.join('server', 'tsconfig.json')]: JSON.stringify({
      compilerOptions: {
        esModuleInterop: true,
        module: 'Node16',
        moduleResolution: 'Node16',
        outDir: './dist',
        rootDir: './src',
        strict: true,
        target: 'ES2022',
      },
      include: ['src/**/*'],
    }, null, 2) + '\n',
  }
}

/** Generate Solidity + Hardhat config files for zenith-evm template. */
function generateZenithEvmFiles(name: string): Record<string, string> {
  return {
    [path.join('contracts', 'Token.sol')]: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Simple ERC-20-like token deployed via Zenith to Canton Network.
 * This contract runs on the Zenith EVM execution layer, which bridges
 * to Canton's privacy-preserving ledger underneath.
 */
contract Token {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        balanceOf[from] -= value;
        allowance[from][msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
        return true;
    }
}
`,

    'hardhat.config.ts': `import { HardhatUserConfig } from "hardhat/config";

/**
 * Hardhat configuration for Zenith EVM development on Canton Network.
 *
 * The "zenith" network connects to the Zenith EVM execution layer,
 * which bridges Solidity contracts to Canton's privacy-preserving ledger.
 */
const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    zenith: {
      url: process.env.ZENITH_RPC_URL ?? "http://localhost:8545",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

export default config;
`,

    'package.json': JSON.stringify({
      dependencies: {
        ethers: '^6',
      },
      description: `${name} — Zenith EVM project on Canton Network`,
      devDependencies: {
        '@nomicfoundation/hardhat-toolbox': '^4',
        hardhat: '^2.19.0',
      },
      name,
      scripts: {
        compile: 'hardhat compile',
        deploy: 'hardhat run scripts/deploy.ts --network zenith',
        test: 'hardhat test',
      },
      type: 'module',
      version: '0.1.0',
    }, null, 2) + '\n',
  }
}

// ---------------------------------------------------------------------------
// .gitignore generation
// ---------------------------------------------------------------------------

function generateGitignore(template: Template): string {
  const lines = ['.cantonctl/', '.daml/', 'node_modules/', 'dist/', '*.dar']
  if (template === 'zenith-evm') {
    lines.push('artifacts/', 'cache/', 'typechain-types/')
  }

  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Daml source templates
// ---------------------------------------------------------------------------

const DAML_BASIC = `module Main where

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

const DAML_TOKEN = `module Main where

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

const DAML_DEFI_AMM = `module Main where

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

const DAML_API_SERVICE = `module Main where

-- Data contract for the API service template.
-- Represents a record that can be created, updated, and archived via the REST API.

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
      do
        create this with value = newValue

    choice Archive_Record : ()
      controller owner
      do return ()
`

const DAML_ZENITH_EVM = `module Main where

-- Bridge contract for the Zenith EVM template.
-- Represents a Canton-side record that mirrors state from the Zenith EVM layer.
-- The operator manages the bridge between Solidity contracts and Canton ledger.

template EvmBridgeRecord
  with
    operator : Party
    evmContractAddress : Text
    tokenName : Text
    totalSupply : Decimal
  where
    signatory operator

    choice UpdateSupply : ContractId EvmBridgeRecord
      with
        newSupply : Decimal
      controller operator
      do
        create this with totalSupply = newSupply

    choice SyncFromEvm : ContractId EvmBridgeRecord
      with
        newAddress : Text
        newSupply : Decimal
      controller operator
      do
        create this with evmContractAddress = newAddress, totalSupply = newSupply
`

// ---------------------------------------------------------------------------
// Daml test templates
// ---------------------------------------------------------------------------

const TEST_BASIC = `module Main.Test where

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

const TEST_TOKEN = `module Main.Test where

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

const TEST_DEFI_AMM = `module Main.Test where

import Main
import Daml.Script

testAddLiquidity : Script ()
testAddLiquidity = script do
  operator <- allocateParty "Operator"
  poolId <- submit operator do
    createCmd LiquidityPool with
      operator, tokenA = "USDC", tokenB = "ETH", reserveA = 0.0, reserveB = 0.0
  submit operator do
    exerciseCmd poolId AddLiquidity with amountA = 10000.0, amountB = 5.0
  pure ()

testSwap : Script ()
testSwap = script do
  operator <- allocateParty "Operator"
  poolId <- submit operator do
    createCmd LiquidityPool with
      operator, tokenA = "USDC", tokenB = "ETH", reserveA = 10000.0, reserveB = 5.0
  submit operator do
    exerciseCmd poolId Swap with inputToken = "USDC", inputAmount = 1000.0
  pure ()
`

const TEST_API_SERVICE = `module Main.Test where

import Main
import Daml.Script

testCreateRecord : Script ()
testCreateRecord = script do
  alice <- allocateParty "Alice"
  submit alice do
    createCmd Record with owner = alice, key = "greeting", value = "Hello"
  pure ()

testUpdateRecord : Script ()
testUpdateRecord = script do
  alice <- allocateParty "Alice"
  recordId <- submit alice do
    createCmd Record with owner = alice, key = "greeting", value = "Hello"
  submit alice do
    exerciseCmd recordId UpdateValue with newValue = "Updated"
  pure ()
`

const TEST_ZENITH_EVM = `module Main.Test where

import Main
import Daml.Script

testCreateBridgeRecord : Script ()
testCreateBridgeRecord = script do
  operator <- allocateParty "Operator"
  submit operator do
    createCmd EvmBridgeRecord with
      operator
      evmContractAddress = "0x1234567890abcdef1234567890abcdef12345678"
      tokenName = "ZenithToken"
      totalSupply = 1000000.0
  pure ()

testSyncFromEvm : Script ()
testSyncFromEvm = script do
  operator <- allocateParty "Operator"
  recordId <- submit operator do
    createCmd EvmBridgeRecord with
      operator
      evmContractAddress = "0x0000000000000000000000000000000000000000"
      tokenName = "ZenithToken"
      totalSupply = 0.0
  submit operator do
    exerciseCmd recordId SyncFromEvm with
      newAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      newSupply = 500000.0
  pure ()
`
