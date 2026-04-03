import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

const rootDir = process.cwd()
const tempBase = mkdtempSync(join(tmpdir(), 'cantonctl-coverage-compare-'))
const providers = ['v8', 'istanbul']

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: {...process.env, ...env},
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

function readSummary(dir) {
  return JSON.parse(readFileSync(join(dir, 'coverage-summary.json'), 'utf8'))
}

function metricDelta(a, b, key) {
  return Number((b[key].pct - a[key].pct).toFixed(2))
}

try {
  run('node', ['scripts/verify-coverage-exclusions.mjs'], {})

  const summaries = new Map()

  for (const provider of providers) {
    const reportsDirectory = join(tempBase, provider)
    run('npx', [
      'vitest',
      'run',
      '--project',
      'unit',
      '--coverage',
      '--coverage.provider=' + provider,
      '--coverage.reportsDirectory=' + reportsDirectory,
    ], {})
    summaries.set(provider, readSummary(reportsDirectory))
  }

  const v8Summary = summaries.get('v8')
  const istanbulSummary = summaries.get('istanbul')
  const files = Object.keys(istanbulSummary)
    .filter(file => file !== 'total' && v8Summary[file])

  const deltas = files
    .map((file) => {
      const v8Metrics = v8Summary[file]
      const istanbulMetrics = istanbulSummary[file]
      return {
        branchesDelta: metricDelta(v8Metrics, istanbulMetrics, 'branches'),
        functionsDelta: metricDelta(v8Metrics, istanbulMetrics, 'functions'),
        linesDelta: metricDelta(v8Metrics, istanbulMetrics, 'lines'),
        maxAbsDelta: Math.max(
          Math.abs(metricDelta(v8Metrics, istanbulMetrics, 'branches')),
          Math.abs(metricDelta(v8Metrics, istanbulMetrics, 'functions')),
          Math.abs(metricDelta(v8Metrics, istanbulMetrics, 'lines')),
          Math.abs(metricDelta(v8Metrics, istanbulMetrics, 'statements')),
        ),
        statementsDelta: metricDelta(v8Metrics, istanbulMetrics, 'statements'),
        file,
        istanbul: istanbulMetrics,
        v8: v8Metrics,
      }
    })
    .filter(entry => entry.maxAbsDelta >= 1)
    .sort((a, b) => b.maxAbsDelta - a.maxAbsDelta || a.file.localeCompare(b.file))

  console.log('\nCoverage provider comparison (istanbul - v8):')
  for (const entry of deltas) {
    console.log(
      `${entry.file}\n` +
      `  statements ${entry.v8.statements.pct}% -> ${entry.istanbul.statements.pct}% (${entry.statementsDelta >= 0 ? '+' : ''}${entry.statementsDelta})\n` +
      `  branches   ${entry.v8.branches.pct}% -> ${entry.istanbul.branches.pct}% (${entry.branchesDelta >= 0 ? '+' : ''}${entry.branchesDelta})\n` +
      `  functions  ${entry.v8.functions.pct}% -> ${entry.istanbul.functions.pct}% (${entry.functionsDelta >= 0 ? '+' : ''}${entry.functionsDelta})\n` +
      `  lines      ${entry.v8.lines.pct}% -> ${entry.istanbul.lines.pct}% (${entry.linesDelta >= 0 ? '+' : ''}${entry.linesDelta})`,
    )
  }

  if (deltas.length === 0) {
    console.log('\nNo per-file delta >= 1 point between providers.')
  }
} finally {
  rmSync(tempBase, {force: true, recursive: true})
}
