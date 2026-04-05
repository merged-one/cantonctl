/**
 * @module daml-parser
 *
 * Regex-based parser for Daml source files. Extracts template definitions,
 * fields, choices, signatories, and controllers from .daml source code.
 *
 * This is a pragmatic "good enough" parser for scaffold inspection and
 * generated companion assets. It handles all cantonctl scaffold templates
 * and typical Daml patterns. It does NOT handle:
 * - Multi-line signatory expressions (e.g., signatory [p1, p2])
 * - Key/maintainer declarations
 * - Interface implementations
 * - Nested modules
 * - Comments that look like declarations
 *
 * @example
 * ```ts
 * const result = parseDamlSource(damlCode)
 * // result.templates[0].name === 'Token'
 * // result.templates[0].fields === [{name: 'owner', type: 'Party'}, ...]
 * // result.templates[0].choices[0].name === 'Transfer'
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DamlField {
  /** Field or argument name. */
  name: string
  /** Daml type (Party, Text, Decimal, ContractId X, Optional X, etc.). */
  type: string
}

export interface DamlChoice {
  /** Choice name (e.g., Transfer, Mint, Burn). */
  name: string
  /** Return type (e.g., ContractId Token, (), (ContractId Token, ContractId Token)). */
  returnType: string
  /** Choice arguments. Empty array for no-arg choices (e.g., Burn). */
  args: DamlField[]
  /** Controller expression (e.g., owner, operator). */
  controller: string
  /** True if the choice archives the contract (default). False if nonconsuming. */
  consuming: boolean
}

export interface DamlTemplate {
  /** Template name (e.g., Token, LiquidityPool). */
  name: string
  /** Module name (e.g., Main). */
  module: string
  /** Template fields with types. */
  fields: DamlField[]
  /** Available choices. */
  choices: DamlChoice[]
  /** Signatory expression (e.g., owner). */
  signatory: string
}

export interface DamlParseResult {
  /** Module name (e.g., Main). */
  module: string
  /** All templates found in the source. */
  templates: DamlTemplate[]
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a .daml source file and extract template definitions.
 */
export function parseDamlSource(source: string): DamlParseResult {
  // Extract module name
  const moduleMatch = source.match(/^module\s+(\S+)\s+where/m)
  const moduleName = moduleMatch?.[1] ?? 'Unknown'

  // Split source into template blocks
  const templates = parseTemplates(source, moduleName)

  return {module: moduleName, templates}
}

function parseTemplates(source: string, moduleName: string): DamlTemplate[] {
  const templates: DamlTemplate[] = []

  // Find all template declarations and their positions
  const templateRegex = /^template\s+(\w+)\s*$/gm
  const matches: Array<{name: string; startIndex: number}> = []

  let match
  while ((match = templateRegex.exec(source)) !== null) {
    matches.push({name: match[1], startIndex: match.index})
  }

  // Extract each template's body (from its start to the next template or EOF)
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].startIndex
    const end = i + 1 < matches.length ? matches[i + 1].startIndex : source.length
    const body = source.slice(start, end)

    const template = parseTemplateBody(matches[i].name, moduleName, body)
    templates.push(template)
  }

  return templates
}

function parseTemplateBody(name: string, moduleName: string, body: string): DamlTemplate {
  // Extract fields: between first "with" and "where"
  const fields = parseFields(body)

  // Extract signatory
  const sigMatch = body.match(/^\s+signatory\s+(.+)$/m)
  const signatory = sigMatch?.[1]?.trim() ?? ''

  // Extract choices
  const choices = parseChoices(body)

  return {choices, fields, module: moduleName, name, signatory}
}

function parseFields(body: string): DamlField[] {
  // Match the fields block: between the first "with" line and "where" line
  const fieldsMatch = body.match(/^\s+with\n([\s\S]*?)^\s+where/m)
  if (!fieldsMatch) return []

  return parseFieldLines(fieldsMatch[1])
}

function parseFieldLines(block: string): DamlField[] {
  const fields: DamlField[] = []
  const fieldRegex = /^\s+(\w+)\s*:\s*(.+)$/gm

  let match
  while ((match = fieldRegex.exec(block)) !== null) {
    fields.push({name: match[1], type: match[2].trim()})
  }

  return fields
}

function parseChoices(body: string): DamlChoice[] {
  const choices: DamlChoice[] = []

  // Find all choice declarations
  const choiceRegex = /^\s+(nonconsuming\s+)?choice\s+(\w+)\s*:\s*(.+)$/gm
  const choiceMatches: Array<{
    consuming: boolean
    fullMatch: string
    index: number
    name: string
    returnType: string
  }> = []

  let match
  while ((match = choiceRegex.exec(body)) !== null) {
    choiceMatches.push({
      consuming: !match[1],
      fullMatch: match[0],
      index: match.index,
      name: match[2],
      returnType: match[3].trim(),
    })
  }

  // Extract each choice's body
  for (let i = 0; i < choiceMatches.length; i++) {
    const start = choiceMatches[i].index + choiceMatches[i].fullMatch.length
    const end = i + 1 < choiceMatches.length ? choiceMatches[i + 1].index : body.length
    const choiceBody = body.slice(start, end)

    const choice = parseChoiceBody(choiceMatches[i], choiceBody)
    choices.push(choice)
  }

  return choices
}

function parseChoiceBody(
  info: {consuming: boolean; name: string; returnType: string},
  choiceBody: string,
): DamlChoice {
  // Extract args: between "with" and "controller" in the choice body
  let args: DamlField[] = []
  const argsMatch = choiceBody.match(/^\s+with\n([\s\S]*?)(?=^\s+controller)/m)
  if (argsMatch) {
    args = parseFieldLines(argsMatch[1])
  }

  // Extract controller
  const controllerMatch = choiceBody.match(/^\s+controller\s+(.+)$/m)
  const controller = controllerMatch?.[1]?.trim() ?? ''

  return {
    args,
    consuming: info.consuming,
    controller,
    name: info.name,
    returnType: info.returnType,
  }
}
