#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

const summaryPath = path.resolve(process.cwd(), 'coverage/coverage-summary.json')
const topCount = 20

if (!fs.existsSync(summaryPath)) {
  console.error(`Coverage summary not found at ${summaryPath}`)
  console.error('Run `npm run test:coverage` first.')
  process.exit(1)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))

function aggregate(entries) {
  const totals = {
    branches: {covered: 0, total: 0},
    functions: {covered: 0, total: 0},
    lines: {covered: 0, total: 0},
    statements: {covered: 0, total: 0},
  }

  for (const metrics of entries) {
    for (const key of Object.keys(totals)) {
      totals[key].covered += metrics[key].covered
      totals[key].total += metrics[key].total
    }
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [
      key,
      value.total === 0 ? 100 : Number(((value.covered / value.total) * 100).toFixed(2)),
    ]),
  )
}

function groupFor(filePath) {
  if (filePath.startsWith('src/commands/')) return 'commands'
  if (filePath.startsWith('src/lib/')) return 'lib'
  if (filePath.startsWith('src/hooks/')) return 'hooks'
  return 'other'
}

const fileRows = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, metrics]) => ({
    file: file.replace(`${process.cwd()}/`, ''),
    metrics,
  }))
  .filter((row) => row.file.startsWith('src/'))
  .map((row) => ({
    ...row,
    gapScore:
      (100 - row.metrics.statements.pct) +
      (100 - row.metrics.branches.pct) +
      (100 - row.metrics.functions.pct) +
      (100 - row.metrics.lines.pct),
  }))
  .sort((left, right) => right.gapScore - left.gapScore)

const groupedRows = new Map()
for (const row of fileRows) {
  const group = groupFor(row.file)
  if (!groupedRows.has(group)) {
    groupedRows.set(group, [])
  }

  groupedRows.get(group).push(row.metrics)
}

console.log('\nStrict coverage backlog')
console.log(`Baseline total: statements ${summary.total.statements.pct}% | branches ${summary.total.branches.pct}% | functions ${summary.total.functions.pct}% | lines ${summary.total.lines.pct}%`)

for (const group of ['commands', 'lib', 'hooks']) {
  const rows = groupedRows.get(group) ?? []
  const metrics = aggregate(rows)
  console.log(`${group}: statements ${metrics.statements}% | branches ${metrics.branches}% | functions ${metrics.functions}% | lines ${metrics.lines}%`)
}

console.log(`\nTop ${Math.min(topCount, fileRows.length)} files to raise first:`)
for (const row of fileRows.slice(0, topCount)) {
  const metrics = row.metrics
  console.log(
    `- ${row.file}: statements ${metrics.statements.pct}% | branches ${metrics.branches.pct}% | functions ${metrics.functions.pct}% | lines ${metrics.lines.pct}%`,
  )
}
