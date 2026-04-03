#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {COVERAGE_POLICY} from './manifest.js'

const COVERAGE_SUMMARY_PATH = path.resolve(process.cwd(), 'coverage/coverage-summary.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listSourceFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  /** @type {string[]} */
  const files = []
  for (const entry of fs.readdirSync(rootDir, {withFileTypes: true})) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath))
      continue
    }

    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) {
      continue
    }

    files.push(path.relative(process.cwd(), fullPath))
  }

  return files
}

function normalizeSummary(summary) {
  /** @type {Record<string, any>} */
  const normalized = {}
  for (const [filePath, metrics] of Object.entries(summary)) {
    if (filePath === 'total') {
      continue
    }

    const relativePath = path.relative(process.cwd(), filePath)
    normalized[relativePath] = metrics
  }

  return normalized
}

function emptyMetrics() {
  return {
    branches: {covered: 0, pct: 0, skipped: 0, total: 0},
    functions: {covered: 0, pct: 0, skipped: 0, total: 0},
    lines: {covered: 0, pct: 0, skipped: 0, total: 0},
    statements: {covered: 0, pct: 0, skipped: 0, total: 0},
  }
}

function aggregateMetrics(metricsList) {
  const totals = emptyMetrics()
  for (const metrics of metricsList) {
    for (const key of ['branches', 'functions', 'lines', 'statements']) {
      totals[key].covered += metrics[key].covered
      totals[key].skipped += metrics[key].skipped
      totals[key].total += metrics[key].total
    }
  }

  for (const key of ['branches', 'functions', 'lines', 'statements']) {
    totals[key].pct = totals[key].total === 0
      ? 100
      : Number(((totals[key].covered / totals[key].total) * 100).toFixed(2))
  }

  return totals
}

function metricFailures(label, metrics, thresholds) {
  /** @type {string[]} */
  const failures = []
  for (const key of ['statements', 'lines', 'functions', 'branches']) {
    if (metrics[key].pct < thresholds[key]) {
      failures.push(
        `${label}: ${key} ${metrics[key].pct}% < required ${thresholds[key]}%`,
      )
    }
  }

  return failures
}

if (!fs.existsSync(COVERAGE_SUMMARY_PATH)) {
  console.error(`Coverage summary not found at ${COVERAGE_SUMMARY_PATH}`)
  process.exit(1)
}

const summary = normalizeSummary(readJson(COVERAGE_SUMMARY_PATH))
const trackedFiles = [
  ...listSourceFiles(path.resolve(process.cwd(), 'src/lib')),
  ...listSourceFiles(path.resolve(process.cwd(), 'src/commands')),
  ...listSourceFiles(path.resolve(process.cwd(), 'src/hooks')),
]
  .filter((filePath) => !filePath.startsWith('src/generated/'))
  .sort()

/** @type {string[]} */
const failures = []

for (const [groupName, groupPolicy] of Object.entries(COVERAGE_POLICY.groups)) {
  const files = trackedFiles.filter((filePath) =>
    groupPolicy.prefixes.some((prefix) => filePath.startsWith(prefix)),
  )
  const metrics = aggregateMetrics(files.map((filePath) => summary[filePath] ?? emptyMetrics()))
  failures.push(...metricFailures(`Coverage group "${groupName}"`, metrics, groupPolicy.thresholds))
}

for (const [filePath, thresholds] of Object.entries(COVERAGE_POLICY.criticalFiles)) {
  const metrics = summary[filePath] ?? emptyMetrics()
  failures.push(...metricFailures(`Critical file "${filePath}"`, metrics, thresholds))
}

if (failures.length > 0) {
  console.error('\nCoverage verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('\nCoverage verification passed.')
