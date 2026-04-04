import {Flags} from '@oclif/core'

import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class ScanAcs extends StableSurfaceCommand {
  static override description = 'Read a stable public Scan ACS snapshot'

  static override examples = [
    '<%= config.bin %> scan acs --profile splice-devnet --migration-id 7',
    '<%= config.bin %> scan acs --scan-url https://scan.example.com --migration-id 7 --record-time 2026-04-02T20:10:00Z --json',
  ]

  static override flags = {
    after: Flags.integer({
      description: 'Pagination token from a prior ACS response',
    }),
    before: Flags.string({
      description: 'Resolve the latest snapshot at or before this ISO timestamp when --record-time is omitted',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'migration-id': Flags.integer({
      description: 'Migration id to read the ACS from',
      required: true,
    }),
    'page-size': Flags.integer({
      default: 25,
      description: 'Maximum number of contracts to return',
    }),
    'party-id': Flags.string({
      description: 'Restrict the ACS to stakeholder party ids',
      multiple: true,
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes scan',
    }),
    'record-time': Flags.string({
      description: 'Exact or at-or-before ISO timestamp of the ACS snapshot',
    }),
    'record-time-match': Flags.string({
      default: 'exact',
      description: 'How to match the record time',
      options: ['at_or_before', 'exact'],
    }),
    'scan-url': Flags.string({
      description: 'Explicit scan base URL override',
    }),
    template: Flags.string({
      description: 'Restrict the ACS to package-name qualified template ids',
      multiple: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ScanAcs)
    const out = this.outputFor(flags.json)

    try {
      if (flags['record-time-match'] !== 'exact' && flags['record-time-match'] !== 'at_or_before') {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Use --record-time-match exact or --record-time-match at_or_before.',
        })
      }

      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['scan-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().getScanAcs({
        after: flags.after,
        before: flags.before,
        migrationId: flags['migration-id'],
        pageSize: flags['page-size'],
        partyIds: flags['party-id'],
        profile,
        recordTime: flags['record-time'],
        recordTimeMatch: flags['record-time-match'],
        scanBaseUrl: flags['scan-url'],
        templates: flags.template,
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Snapshot: migration ${result.snapshot.migrationId ?? '-'} @ ${result.snapshot.recordTime ?? '-'}`)
      out.table(
        ['Contract', 'Template', 'Created At'],
        result.createdEvents.map(event => [
          String(event.contractId ?? '-'),
          String(event.templateId ?? '-'),
          String(event.createdAt ?? '-'),
        ]),
      )
      if (result.nextPageToken !== undefined) {
        out.info(`Next page token: ${result.nextPageToken}`)
      }
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
