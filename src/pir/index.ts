/**
 * PIR public facade (v0.3).
 *
 * The full Phase 3 pipeline in one import:
 *
 *   source → AST → PIR → validate → optimize → (execute | print | JSON)
 *
 * The PIR interpreter shares the AST interpreter's builtin behavior via
 * adapted implementations, so parity holds (see tests/pir).
 */

import { compileToAst, PlainError } from "../index.js"
import type { Program } from "../ast.js"
import { lowerProgram } from "./lowering/ast-to-pir.js"
import { validateModule, type PirValidationResult } from "./validator.js"
import { runPasses, DEFAULT_PASSES, type PassResult } from "./passes.js"
import { PirInterpreter, type PirRunResult } from "./interpreter.js"
import { printModule, moduleToJSON, moduleToStableJSON } from "./printer.js"
import type { IRModule } from "./ir.js"

export { printModule, moduleToJSON, moduleToStableJSON } from "./printer.js"
export { validateModule } from "./validator.js"
export type { PirDiagnostic, PirValidationResult } from "./validator.js"
export { runPasses, constantFolding, constantPropagation, deadCodeElimination, DEFAULT_PASSES } from "./passes.js"
export type { PirPass, PassResult } from "./passes.js"
export { PirInterpreter } from "./interpreter.js"
export type { PirRunResult } from "./interpreter.js"
export { lowerProgram } from "./lowering/ast-to-pir.js"
export type { IRModule, IRFunction, IRBlock, IROperation, IREntity } from "./ir.js"
export type { PirType, PirValue } from "./types.js"

/** AST → PIR (assumes the AST already passed semantic analysis). */
export function astToPir(ast: Program): IRModule {
  return lowerProgram(ast)
}

/** Source → PIR. Runs the semantic analyzer first; throws PlainError on errors. */
export function compileToPir(source: string): IRModule {
  const ast = compileToAst(source)
  return lowerProgram(ast)
}

/** Source → PIR → validation result. */
export function validateSource(source: string): { module: IRModule; validation: PirValidationResult } {
  const module = compileToPir(source)
  return { module, validation: validateModule(module) }
}

/** Run the PIR module through the PIR interpreter (no optimization). */
export function runPir(module: IRModule, print?: (s: string) => void): PirRunResult {
  return new PirInterpreter(module, undefined, print).run()
}

/** Compile, optimize with the default passes, and report each pass. */
export function optimizeSource(source: string): { module: IRModule; passes: PassResult; validation: PirValidationResult } {
  const module = compileToPir(source)
  const validation = validateModule(module)
  const passes = runPasses(module, DEFAULT_PASSES)
  return { module: passes.module, passes, validation }
}

/** Full pipeline: source → optimized PIR → execution. */
export function runSourceThroughPir(source: string, print?: (s: string) => void): { run: PirRunResult; module: IRModule } {
  const { module } = optimizeSource(source)
  const run = runPir(module, print)
  return { run, module }
}

// Re-export a PlainError so consumers can catch uniformly.
export { PlainError }
