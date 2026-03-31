# ADR-0006: Testing as Core Value Proposition

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Every successful blockchain CLI makes testing excellent -- it is the top feature developers evaluate. Foundry introduced fuzz testing and cheatcodes, Hardhat enabled Solidity stack traces and console.log in contracts, Anchor generates IDL-based test clients, and Aptos provides formal verification via Move Prover. Canton's party-based privacy model creates unique testing needs (visibility boundaries, multi-party scenarios) that existing tools do not address.

## Decision
Testing is a first-class feature with structured output, Canton-specific cheatcodes (`advanceTime`, `impersonateParty`, `setContractState`), multi-party test scenarios for privacy boundary verification, coverage reporting for Daml templates/choices, and snapshot testing for resource usage regressions. Fuzz testing is deferred because Daml's strong type system makes certain bug classes (overflow, reentrancy) structurally impossible.

## Consequences
**Positive:**
- Canton cheatcodes and multi-party scenarios address unmet needs no other tool provides
- Structured output with `--json` flag enables seamless CI integration
- Coverage and snapshot testing catch regressions before deployment

**Negative:**
- Canton-specific cheatcodes create a testing DSL developers must learn
- Deferring fuzz testing leaves property-based testing gaps initially
- Coverage instrumentation adds complexity to the Daml compilation pipeline

## References
- [Testing design](../DESIGN_DECISIONS.md#decision-6-testing-as-core-value-proposition)
- Foundry fuzz testing, Hardhat stack traces, Anchor IDL clients, Aptos Move Prover
