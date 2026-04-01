/**
 * Daml language definition for Monaco editor.
 * Provides syntax highlighting using the Monarch tokenizer.
 */

import type {languages} from 'monaco-editor'

export const DAML_LANGUAGE_ID = 'daml'

export const damlLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '--',
    blockComment: ['{-', '-}'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    {open: '{', close: '}'},
    {open: '[', close: ']'},
    {open: '(', close: ')'},
    {open: '"', close: '"'},
  ],
  surroundingPairs: [
    {open: '{', close: '}'},
    {open: '[', close: ']'},
    {open: '(', close: ')'},
    {open: '"', close: '"'},
  ],
}

export const damlTokensProvider: languages.IMonarchLanguage = {
  keywords: [
    'module', 'where', 'import', 'template', 'with', 'do', 'let', 'in',
    'if', 'then', 'else', 'case', 'of', 'type', 'data', 'class', 'instance',
    'deriving', 'forall', 'choice', 'controller', 'signatory', 'observer',
    'ensure', 'key', 'maintainer', 'authority', 'assert', 'return',
    'create', 'exercise', 'exerciseByKey', 'fetch', 'fetchByKey',
    'archive', 'abort', 'submit', 'submitMustFail', 'allocateParty',
    'scenario', 'script', 'interface', 'viewtype', 'requires',
    'nonconsuming', 'preconsuming', 'postconsuming',
  ],

  typeKeywords: [
    'Party', 'Text', 'Int', 'Decimal', 'Bool', 'Date', 'Time',
    'ContractId', 'Optional', 'List', 'Map', 'Either',
    'Update', 'Script', 'Scenario',
    'True', 'False', 'Some', 'None',
  ],

  operators: [
    '=', '<-', '->', '=>', '::', '|', '\\\\', '.', '..', ':', '+', '-',
    '*', '/', '==', '/=', '<', '>', '<=', '>=', '&&', '||', '++', '$',
  ],

  tokenizer: {
    root: [
      // Comments
      [/--.*$/, 'comment'],
      [/\{-/, 'comment', '@comment'],

      // Strings
      [/"/, 'string', '@string'],

      // Numbers
      [/\d+\.\d+/, 'number.float'],
      [/\d+/, 'number'],

      // Type identifiers (start with uppercase)
      [/[A-Z][\w']*/, {
        cases: {
          '@typeKeywords': 'type',
          '@default': 'type.identifier',
        },
      }],

      // Identifiers and keywords
      [/[a-z_][\w']*/, {
        cases: {
          '@keywords': 'keyword',
          '@default': 'identifier',
        },
      }],

      // Operators
      [/[=<>!&|+\-*/\\.:$]+/, 'operator'],

      // Brackets
      [/[{}()[\]]/, '@brackets'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    comment: [
      [/[^{}-]+/, 'comment'],
      [/-\}/, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
  },
}
