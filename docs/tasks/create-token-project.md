# Create and Run a Token Project

Create a Canton token contract with Mint, Transfer, and Burn operations, then start a local development environment.

**Difficulty:** Beginner
**Time:** 5 minutes
**Prerequisites:** Node.js 18+, `dpm` CLI installed

## Steps

### 1. Scaffold the project

<!-- doctest:begin -->
```bash
cantonctl init my-token --template splice-token-app
```
<!-- doctest:expect:stdout "Project created" -->
<!-- doctest:end -->

This creates `my-token/` with:
- `daml/Main.daml` — Token contract with Transfer, Burn, Mint choices
- `test/Main.test.daml` — Four test cases
- `cantonctl.yaml` — Project config with Alice (operator) and Bob (participant)

### 2. Inspect the generated contract

The Token template in `daml/Main.daml` looks like:

```daml
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
```

### 3. Start the development environment

<!-- doctest:begin -->
```bash
cd my-token
cantonctl dev
```
<!-- doctest:expect:stdout "Canton sandbox is ready" -->
<!-- doctest:end -->

This starts a Canton sandbox on `localhost:5001` with JSON API on `localhost:7575`, provisions Alice and Bob as parties, and watches `daml/` for changes.

### 4. Build the project

In a separate terminal:

<!-- doctest:begin -->
```bash
cd my-token
cantonctl build
```
<!-- doctest:end -->

### 5. Run the tests

<!-- doctest:begin -->
```bash
cd my-token
cantonctl test
```
<!-- doctest:end -->

The token template includes four tests:
- `testMint` — Alice creates a token and mints additional supply
- `testTransfer` — Alice transfers tokens to Bob
- `testCannotOverTransfer` — Verifies transfer fails when amount exceeds balance
- `testBurn` — Alice burns tokens (archives the contract)

## What's Next

- Modify `daml/Main.daml` and save — the dev server auto-rebuilds and uploads the new DAR
- Add more parties to `cantonctl.yaml` — they'll be provisioned on next `cantonctl dev`
- Deploy to DevNet (planned for Phase 4): `cantonctl deploy devnet`
