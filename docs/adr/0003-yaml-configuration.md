# ADR-0003: YAML Configuration with Zod Validation

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
cantonctl needs a configuration format that fits naturally into the Canton ecosystem, where YAML is ubiquitous (canton config, daml.yaml, Docker Compose, Kubernetes). Code-as-config (like Hardhat's TypeScript config) is powerful but introduces security risks for a tool managing critical infrastructure. Configuration errors need to be caught early with actionable messages.

## Decision
We chose YAML with Zod schema validation and hierarchical resolution: `cantonctl.yaml` (project) > `~/.config/cantonctl/config.yaml` (user) > `CANTONCTL_*` env vars > CLI flags. YAML is declarative and auditable -- it cannot execute arbitrary code at load time. Zod validates config at load time and produces developer-friendly error messages. For dynamic needs, plugins provide the escape hatch.

## Consequences
**Positive:**
- Consistent with the entire Canton/Daml/Kubernetes ecosystem developers already use
- Declarative config is auditable and safe -- no arbitrary code execution at load time
- Zod validation catches errors early with clear, actionable messages

**Negative:**
- YAML is less strictly typed than TOML, allowing subtle formatting errors
- No programmatic config (computed values, conditional logic) without plugin workarounds
- Hierarchical resolution adds complexity to debugging which value wins

## References
- [YAML configuration design](../DESIGN_DECISIONS.md#decision-3-yaml-configuration-with-json-schema-validation)
- YAML matches Canton ecosystem: canton config, daml.yaml, Docker Compose
