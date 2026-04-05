# Non-Goals

`cantonctl` is not:

- a DPM replacement
- a Daml Studio replacement
- a Quickstart replacement
- the primary wallet-provider or exchange toolkit
- the default UX for unstable internal APIs

These boundaries are deliberate.

- DPM remains the canonical build, test, codegen, sandbox, and Studio launcher.
- Daml Studio remains the canonical IDE.
- Quickstart remains the official reference app and LocalNet launchpad.
- Wallet and dApp integration flows remain owned by the official SDK and gateway stack.
- Operator-only and internal surfaces are outside the product scope rather than part of the default story.
