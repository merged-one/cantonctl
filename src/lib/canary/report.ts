import type {OutputWriter} from '../output.js'
import type {CanaryReport} from './run.js'

export function renderCanaryReport(out: OutputWriter, report: CanaryReport): void {
  out.log(`Profile: ${report.profile.name}`)
  out.log(`Kind: ${report.profile.kind}`)
  out.log('')
  out.table(
    ['Suite', 'Status', 'Endpoint', 'Detail'],
    report.checks.map(check => [
      check.suite,
      check.status,
      check.endpoint ?? '-',
      check.detail,
    ]),
  )
}

