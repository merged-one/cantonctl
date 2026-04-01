import type {Hook} from '@oclif/core'

const hook: Hook<'init'> = async function (_options) {
  // Plugin initialization hook
  // Banner display is handled by individual commands (doctor)
}

export default hook
