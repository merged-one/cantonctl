# ADR-0001: TypeScript + oclif Framework

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
cantonctl needs a CLI framework that serves its primary audience (71% EVM developers from the JS/TS ecosystem) while providing a production-proven plugin system. Go/Cobra dominates infrastructure tooling and Rust/Clap wins on raw speed, but neither offers formal plugin architectures. The Truffle-to-Hardhat transition demonstrated that plugin extensibility, not language speed, determines long-term market dominance.

## Decision
We chose TypeScript with oclif as the CLI framework. oclif provides npm-based lazy-loading plugins, hooks, and is battle-tested by Salesforce CLI, Heroku, and Twilio. The 85ms startup penalty over Go/Rust is acceptable for a developer tool invoked dozens (not thousands) of times daily -- kubectl at 100-200ms is considered fast. The plugin system is the competitive moat that justifies this tradeoff.

## Consequences
**Positive:**
- Direct ecosystem alignment with 71% of target EVM developers
- Production-proven plugin system enables community extensibility without forking
- Enterprise precedent (Salesforce, Heroku, Twilio) validates the approach at scale

**Negative:**
- 85ms startup is perceptibly slower than Go/Rust alternatives (<5ms)
- Node.js runtime dependency required on developer machines
- Performance-critical paths may eventually need native subprocesses or addons

## References
- [ADR index](README.md) — canonical replacement for the retired monolithic design-decisions document
- Truffle (no plugin flex) lost to Hardhat (excellent plugins); Foundry (no plugins) cannot match Hardhat ecosystem breadth
