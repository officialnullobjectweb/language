/**
 * PIR Validator (v0.3).
 *
 * Static checks over a module before it is interpreted or handed to a
 * backend. Produces PIR-coded diagnostics (PIR-001…009):
 *
 *   PIR001 operand type mismatch
 *   PIR002 unknown operation
 *   PIR003 wrong number of arguments (builtin)
 *   PIR004 call to unknown function/builtin
 *   PIR005 function never returns
 *   PIR006 unbalanced block structure (reserved)
 *   PIR007 undefined variable reference
 *   PIR008 entity reference error
 *   PIR009 reference to undefined value (temp used before definition)
 */

import type { IRModule, IRFunction, IROperation } from "./ir.js"
import { OP_SIGNATURES, binaryOpToOpcode } from "./operations.js"
import type { PirType } from "./types.js"
import { pirTypeOf } from "./types.js"

export interface PirDiagnostic {
  code: string
  message: string
  hint?: string
  function?: string
  op?: string
}

export interface PirValidationResult {
  ok: boolean
  diagnostics: PirDiagnostic[]
}

export function validateModule(module: IRModule): PirValidationResult {
  const diagnostics: PirDiagnostic[] = []
  const diag = (d: PirDiagnostic) => diagnostics.push(d)

  // ----- module-level: entities -----
  const entityNames = new Set<string>()
  for (const entity of module.entities) {
    if (entityNames.has(entity.name)) {
      diag({
        code: "PIR008",
        message: `Duplicate entity '${entity.name}'.`,
        hint: "Entity names must be unique within a module.",
      })
    }
    entityNames.add(entity.name)
  }

  const userFnNames = new Set(module.functions.map((f) => f.name))

  for (const fn of module.functions) {
    validateFunction(fn, userFnNames, entityNames, diag)
  }

  return { ok: diagnostics.length === 0, diagnostics }
}

function validateFunction(
  fn: IRFunction,
  userFnNames: Set<string>,
  entityNames: Set<string>,
  diag: (d: PirDiagnostic) => void,
): void {
  /** Values defined before use: params, stores, op results (in order). */
  const defined = new Set(fn.parameters)
  const stored = new Set<string>()
  let sawReturn = false

  const definedResult = (op: IROperation): void => {
    if (op.result) defined.add(op.result)
  }

  const refType = (op: IROperation, i: number): PirType => {
    const ref = op.operands[i]
    if (!ref) return "unknown"
    if (ref.kind === "const") return pirTypeOf(ref.value ?? null)
    return ref.type
  }

  const checkOp = (op: IROperation): void => {
    // Validate inline body blocks first (guards/loops/event handlers) so a
    // guard's own operands (defined earlier) are already in `defined`.
    const body = op.attrs?.__body as IROperation[] | undefined
    if (body) {
      for (const inner of body) checkOp(inner)
    }

    // PIR-009: every temp reference must be defined before use.
    for (const ref of op.operands) {
      if (ref.kind === "temp" && ref.name && !defined.has(ref.name)) {
        diag({
          code: "PIR009",
          message: `Reference to undefined value '${ref.name}'.`,
          hint: "Values must be computed before the operation that uses them.",
          function: fn.name,
          op: op.op,
        })
      }
    }

    const sig = OP_SIGNATURES[op.op]
    if (!sig) {
      diag({
        code: "PIR002",
        message: `Unknown operation '${op.op}'.`,
        function: fn.name,
      })
      return
    }

    // load/store variable names become defined on store, required on load
    if (op.op === "load") {
      const name = op.operands[0]?.name
      if (name && !defined.has(name) && !stored.has(name)) {
        diag({
          code: "PIR007",
          message: `Load of undefined variable '${name}'.`,
          hint: "Store the variable before loading it.",
          function: fn.name,
          op: op.op,
        })
      }
      definedResult(op)
      return
    }
    if (op.op === "store") {
      const name = op.operands[0]?.name
      if (name) stored.add(name)
      return
    }

    // Calls
    if (op.op === "call" || op.op === "call_user") {
      const callee = String(op.attrs?.callee ?? "")
      if (op.op === "call_user" && !userFnNames.has(callee)) {
        diag({
          code: "PIR004",
          message: `Call to unknown function '${callee}'.`,
          function: fn.name,
          op: "call_user",
        })
      }
      if (op.op === "call") {
        const impl = BUILTIN_IMPLS[callee]
        if (impl === undefined) {
          diag({
            code: "PIR004",
            message: `Call to unknown builtin '${callee}'.`,
            function: fn.name,
            op: "call",
          })
        } else if (impl !== null && impl !== op.operands.length) {
          diag({
            code: "PIR003",
            message: `Builtin '${callee}' expects ${impl} argument(s), got ${op.operands.length}.`,
            function: fn.name,
            op: "call",
          })
        }
      }
      definedResult(op)
      return
    }

    // App ops: validate entity references
    if (op.op === "db.create" || op.op === "ui.show" || op.op === "db.query") {
      const entity = String(op.attrs?.entity ?? op.operands[0]?.value ?? "")
      if (entity && !entityNames.has(entity)) {
        diag({
          code: "PIR008",
          message: `Reference to unknown entity '${entity}'.`,
          function: fn.name,
          op: op.op,
        })
      }
      return
    }

    // Typed operands where the signature demands concrete types
    if (sig.operands !== "any") {
      for (let i = 0; i < sig.operands.length; i++) {
        const actual = refType(op, i)
        const expected = sig.operands[i]
        if (actual !== "unknown" && actual !== expected) {
          diag({
            code: "PIR001",
            message: `Invalid ${op.op} operation: expected ${expected}, received ${actual} (operand ${i + 1}).`,
            hint: "Check the value's type before this operation.",
            function: fn.name,
            op: op.op,
          })
        }
      }
    }

    definedResult(op)
    if (op.op === "return") sawReturn = true
  }

  for (const block of fn.blocks) {
    for (const op of block.ops) checkOp(op)
  }

  // main always "returns" implicitly; user functions must have a return op
  if (fn.name !== "main" && !sawReturn && fn.blocks.some((b) => b.ops.length > 0)) {
    diag({
      code: "PIR005",
      message: `Function '${fn.name}' never returns.`,
      hint: "Add a return statement at the end of the function.",
      function: fn.name,
    })
  }
}

/**
 * Builtin arity table for validation: number of expected args, or null
 * for variadic. Kept in sync with src/stdlib.ts.
 */
export const BUILTIN_IMPLS: Record<string, number | null> = {
  uppercase: 1, lowercase: 1, trim: 1, split: 2, join: 2, contains: 2, replace: 3,
  abs: 1, round: 1, floor: 1, ceil: 1, min: 2, max: 2,
  number: 1, text: 1, push: 2, list: null, length: 1,
}

// keep the import used for potential future type checks
void binaryOpToOpcode
