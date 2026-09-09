/**
 * Plainly public API (v0.2).
 *
 * Pipeline: source → tokenize → parse → (analyze) → interpret.
 */

import { tokenize, PlainError } from "./lexer.js"
import { parse } from "./parser.js"
import { Interpreter } from "./interpreter.js"
import { analyze } from "./analyzer.js"
import type { Diagnostic } from "./errors.js"
import type { Program } from "./ast.js"

/** Turn a static diagnostic into a real throwable PlainError. */
function diagnosticToError(d: Diagnostic): PlainError {
  return new PlainError(d.message, d.pos.line, d.pos.column, {
    code: d.code,
    hint: d.hint,
    length: d.length,
  })
}

export { tokenize, PlainError } from "./lexer.js"
export { parse } from "./parser.js"
export { Interpreter, ReturnSignal, Environment, describeType } from "./interpreter.js"
export { formatValue } from "./format.js"
export { analyze } from "./analyzer.js"
export type { AnalysisResult } from "./analyzer.js"
export { ERROR_CODES, suggestName, editDistance } from "./errors.js"
export type {
  Position,
  Severity,
} from "./errors.js"
export { STDLIB_DOCS, getStdlibDoc } from "./stdlib.js"
export { KEYWORDS, BUILTIN_NAMES, RESERVED_NAMES } from "./words.js"

// ----- Phase 3: PIR pipeline (source → AST → PIR → validate → optimize) -----
export {
  compileToPir,
  validateSource,
  optimizeSource,
  runSourceThroughPir,
  runPir,
  astToPir,
  validateModule,
  runPasses,
  constantFolding,
  constantPropagation,
  deadCodeElimination,
  DEFAULT_PASSES,
  printModule,
  moduleToJSON,
  moduleToStableJSON,
} from "./pir/index.js"
export type { IRModule, IRFunction, IRBlock, IROperation, IREntity } from "./pir/index.js"
export type { PirType, PirValue } from "./pir/index.js"
export type { PirValidationResult, PirDiagnostic } from "./pir/index.js"
export type { PassResult } from "./pir/index.js"
export {
  explainProgram,
  explainSteps,
} from "./explain.js"
// ----- Phase 4: code generators (PIR → SQL / Node / React / full project) -----
export { buildProject } from "./codegen/project.js"
export type { BuildResult } from "./codegen/project.js"
export { generateSqlSchema, toSnakeCase, sqlTypeFor } from "./codegen/sql.js"
export { generateBackend } from "./codegen/node.js"
export { generateFrontend } from "./codegen/react.js"
export type * from "./ast.js"
export type {
  PlainValue,
  PlainList,
  KamalFunction,
  PlainNativeFunction,
} from "./interpreter-types.js"

export interface RunResult {
  output: string[]
}

export interface CheckResult {
  ok: boolean
  diagnostics: Diagnostic[]
  ast: Program
}

/** Parse source into an AST without running it. Throws PlainError on syntax errors. */
export function compileToAst(source: string): Program {
  const tokens = tokenize(source)
  return parse(tokens)
}

/** Parse + semantic analysis. Returns all diagnostics found statically. */
export function checkSource(source: string): CheckResult {
  const ast = compileToAst(source)
  const { diagnostics } = analyze(ast)
  return { ok: diagnostics.every((d) => d.severity !== "error"), diagnostics, ast }
}

/**
 * Run a program, collecting printed output.
 * Runs semantic analysis first and refuses to run when there are errors
 * (warnings don't block execution — they're printed to `warnings`).
 * Throws PlainError on runtime errors.
 */
export function runSource(
  source: string,
  print: (s: string) => void,
  options?: { skipAnalysis?: boolean },
): RunResult & { warnings: Diagnostic[] } {
  if (!options?.skipAnalysis) {
    const check = checkSource(source)
    const errors = check.diagnostics.filter((d) => d.severity === "error")
    const warnings = check.diagnostics.filter((d) => d.severity === "warning")
    if (errors.length > 0) {
      throw diagnosticToError(errors[0])
    }
    const program = check.ast
    const output: string[] = []
    const interpreter = new Interpreter((s) => {
      output.push(s)
      print(s)
    })
    interpreter.run(program)
    return { output, warnings }
  }
  const program = compileToAst(source)
  const output: string[] = []
  const interpreter = new Interpreter((s) => {
    output.push(s)
    print(s)
  })
  interpreter.run(program)
  return { output, warnings: [] }
}

/** Format a PlainError into a beginner-friendly multi-line message. */
export function formatError(err: PlainError, source?: string): string {
  const lines: string[] = []
  const where = `line ${err.line}, column ${err.column}`
  lines.push(`${err.code} at ${where}: ${err.message}`)
  if (source) {
    const srcLines = source.split(/\r?\n/)
    const lineText = srcLines[err.line - 1]
    if (lineText !== undefined) {
      lines.push("")
      lines.push(`    ${lineText}`)
      const width = Math.max(1, err.length)
      lines.push(`    ${" ".repeat(Math.max(0, err.column - 1))}${"^".repeat(width)}`)
    }
  }
  if (err.hint) {
    lines.push(`Hint: ${err.hint}`)
  }
  return lines.join("\n")
}
