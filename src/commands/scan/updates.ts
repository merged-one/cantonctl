import {Flags} from '@oclif/core'

import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class ScanUpdates extends StableSurfaceCommand {
  static override description = 'List stable public Scan update history'

  static override examples = [
    '<%= config.bin %> scan updates --profile splice-devnet',
    '<%= config.bin %> scan updates --scan-url https://scan.example.com --page-size 10 --json',
  ]

  static override flags = {
    'after-migration-id': Flags.integer({
      description: 'Start after the given migration id (must be paired with --after-record-time)',
    }),
    'after-record-time': Flags.string({
      description: 'Start after the given record time (must be paired with --after-migration-id)',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'page-size': Flags.integer({
      default: 20,
      description: 'Maximum number of updates to return',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes scan',
    }),
    'scan-url': Flags.string({
      description: 'Explicit scan base URL override',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ScanUpdates)
    const out = this.outputFor(flags.json)

    try {
      if ((flags['after-migration-id'] === undefined) !== (flags['after-record-time'] === undefined)) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Pass both --after-migration-id and --after-record-time together.',
        })
      }

      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['scan-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().listScanUpdates({
        after: flags['after-migration-id'] !== undefined && flags['after-record-time']
          ? {migrationId: flags['after-migration-id'], recordTime: flags['after-record-time']}
          : undefined,
        pageSize: flags['page-size'],
        profile,
        scanBaseUrl: flags['scan-url'],
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.table(
        ['Update', 'Kind', 'Migration', 'Record Time', 'Events'],
        result.updates.map(update => [
          String(update.updateId ?? '-'),
          String(update.kind ?? 'unknown'),
          String(update.migrationId ?? '-'),
          String(update.recordTime ?? '-'),
          String(update.eventCount ?? update.rootEventCount ?? '-'),
        ]),
      )
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
