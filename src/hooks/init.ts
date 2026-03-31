import type {Hook} from '@oclif/core'

const hook: Hook<'init'> = async function (_options) {
  // Plugin initialization hook
  // This runs before any command executes
  // Future: load plugins, check for updates, validate environment
}

export default hook
