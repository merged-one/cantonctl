import type {Hook} from '@oclif/core'

const hook: Hook<'prerun'> = async function (_options) {
  // Pre-run hook — executes before each command
  // Future: telemetry, config validation, plugin hooks
}

export default hook
