import {spawn} from 'node:child_process'

import {Command, Flags} from '@oclif/core'

import {CantonctlError} from '../lib/errors.js'
import {createUiController, type UiController} from '../lib/ui/controller.js'
import {createUiServer, resolveUiAssetsDir, type UiServer} from '../lib/ui/server.js'

export default class Ui extends Command {
  static override description = 'Start the local control-center UI for profile-centric Canton workflows'

  static override examples = [
    '<%= config.bin %> ui',
    '<%= config.bin %> ui --profile splice-devnet',
    '<%= config.bin %> ui --port 4780 --no-open',
  ]

  static override flags = {
    open: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Open the UI in your default browser',
    }),
    port: Flags.integer({
      default: 4680,
      description: 'Localhost port for the UI server',
    }),
    profile: Flags.string({
      description: 'Initial profile name passed to the UI session',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Ui)

    try {
      const server = this.createUiServer(flags.profile)
      const started = await server.start({port: flags.port})
      const url = flags.profile
        ? `${started.url}/?profile=${encodeURIComponent(flags.profile)}`
        : started.url

      this.log(`Project: ${process.cwd()}`)
      this.log(`Control center: ${url}`)
      this.log('Press Ctrl+C to stop the local UI server.')

      if (flags.open) {
        await this.openBrowser(url)
      }

      await this.waitForShutdown(server)
    } catch (error) {
      if (error instanceof CantonctlError) {
        this.error(error.format(), {exit: 1})
      }

      throw error
    }
  }

  protected createUiController(): UiController {
    return createUiController()
  }

  protected createUiServer(requestedProfile?: string): UiServer {
    return createUiServer({
      assetsDir: resolveUiAssetsDir(),
      controller: this.createUiControllerWithProfile(requestedProfile),
    })
  }

  protected createUiControllerWithProfile(requestedProfile?: string): UiController {
    const controller = this.createUiController()
    if (!requestedProfile) return controller

    return {
      ...controller,
      getSession: (options) => controller.getSession({requestedProfile: options?.requestedProfile ?? requestedProfile}),
    }
  }

  protected async openBrowser(url: string): Promise<void> {
    const command = process.platform === 'darwin'
      ? {args: [url], command: 'open'}
      : process.platform === 'win32'
        ? {args: ['/c', 'start', '', url], command: 'cmd'}
        : {args: [url], command: 'xdg-open'}

    await new Promise<void>((resolve) => {
      const child = spawn(command.command, command.args, {
        detached: true,
        stdio: 'ignore',
      })
      child.on('error', () => resolve())
      child.unref()
      resolve()
    })
  }

  protected async waitForShutdown(server: UiServer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const shutdown = () => {
        void server.stop()
          .then(resolve)
          .catch(reject)
      }

      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
  }
}
