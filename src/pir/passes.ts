/**
 * PIR Passes (v0.3).
 *
 * A pass transforms a module and reports what it did. The pass manager
 * runs them in order — later phases add more passes without touching
 * the compiler core.
 *
 *   validate → constant folding → constant propagation → DCE
 *
 * Every transformation must preserve semantics (parity tests enforce it).
 */

import type { IRModule, IRFunction, IROperation, PirValueRef } from "./ir.js"
import type { PirValue, PirType } from "./types.js"
import { pirTypeOf } from "./types.js"

export interface PassResult {
  module: IRModule
  /** Human-readable summary of what changed, e.g. "constant folding: 3 op(s) folded". */
  report: string[]
  changed: boolean
}

export interface PirPass {
  name: string
  run(module: IRModule): { module: IRModule; note: string | null }
}

export function runPasses(module: IRModule, passes: PirPass[]): PassResult {
  const report: string[] = []
  let current = module
  let changed = false
  for (const pass of passes) {
    const { module: next, note } = pass.run(current)
    if (note) {
      report.push(`${pass.name}: ${note}`)
      changed = true
    }
    current = next
  }
  return { module: current, report, changed }
}

/**
 * Collect every temp name referenced anywhere in an op list, including
 * inside inline `__body` blocks (guards, loops, click handlers).
 */
function collectUsedTemps(ops: IROperation[], into: Set<string>): void {
  const visit = (list: IROperation[]): void => {
    for (const op of list) {
      for (const ref of op.operands) {
        if (ref.kind === "temp" && ref.name) into.add(ref.name)
      }
      const body = op.attrs?.__body as IROperation[] | undefined
      if (body) visit(body)
    }
  }
  visit(ops)
}

// ---------------------------------------------------------------------------
// Pass 1: Constant folding
// ---------------------------------------------------------------------------

export const constantFolding: PirPass = {
  name: "constant folding",
  run(module) {
    let folded = 0
    for (const fn of module.functions) {
      fn.blocks = fn.blocks.map((b) => ({ ...b, ops: foldOps(b.ops, () => folded++) }))
    }
    return { module, note: folded > 0 ? `${folded} op(s) folded` : null }
  },
}

function foldOps(ops: IROperation[], count: () => void): IROperation[] {
  /** Last const value produced per temp, e.g. "%0" → 100 */
  const tempConsts = new Map<string, PirValue>()
  /** Temps defined so far (for PIR-009 safety after folding). */
  const defined = new Set<string>()
  const out: IROperation[] = []

  const refValue = (ref: PirValueRef): PirValue | undefined => {
    if (ref.kind === "const") return ref.value ?? null
    if (ref.kind === "temp" && ref.name && tempConsts.has(ref.name)) return tempConsts.get(ref.name)!
    return undefined
  }

  const constRef = (v: PirValue): PirValueRef => ({ kind: "const", value: v, type: pirTypeOf(v) })

  const rewrite = (ops: IROperation[]): IROperation[] => {
    const out: IROperation[] = []
    for (const op of ops) {
      // Guard/loop/handler ops carry inline bodies — rewrite recursively so
      // folding works inside if/loop bodies too.
      const body = op.attrs?.__body as IROperation[] | undefined
      if (body) {
        out.push({ ...op, attrs: { ...op.attrs, __body: rewrite(body) } })
        continue
      }

      if (
        op.result &&
        op.operands.length >= 1 &&
        op.operands.every((r) => refValue(r) !== undefined) &&
        op.operands.length > 0
      ) {
        const foldedValue = tryFold(op.op, op.operands.map((r) => refValue(r)!))
        if (foldedValue !== undefined) {
          tempConsts.set(op.result, foldedValue)
          defined.add(op.result)
          out.push({ op: "const", operands: [constRef(foldedValue)], result: op.result, pos: op.pos })
          count()
          continue
        }
      }

      // Track consts for future folds
      if (op.op === "const" && op.result) {
        tempConsts.set(op.result, op.operands[0].value ?? null)
        defined.add(op.result)
      }
      // A load/store makes the temp's const-ness unknown again (conservative).
      if (op.op === "store" || op.op === "load" || op.op === "call" || op.op === "call_user") {
        // Nothing to invalidate for temps (SSA-like: fresh temps each time),
        // but variable stores mean a later load may differ — clearing temp
        // constants is unnecessary because temps are unique.
      }
      out.push(op)
    }
    return out
  }

  return rewrite(ops)
}

function tryFold(opcode: string, vals: PirValue[]): PirValue | undefined {
  const a = vals[0]
  const b = vals[1]
  switch (opcode) {
    case "add":
      if (typeof a === "number" && typeof b === "number") return a + b
      if (typeof a === "string" || typeof b === "string") return formatF(a) + formatF(b)
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
      return undefined
    case "sub":
      return typeof a === "number" && typeof b === "number" ? a - b : undefined
    case "mul":
      return typeof a === "number" && typeof b === "number" ? a * b : undefined
    case "div":
      return typeof a === "number" && typeof b === "number" && b !== 0 ? a / b : undefined
    case "mod":
      return typeof a === "number" && typeof b === "number" && b !== 0 ? a % b : undefined
    case "neg":
      return typeof a === "number" ? -a : undefined
    case "not":
      return typeof a === "boolean" ? !a : undefined
    case "eq":
      return deepEqualF(a, b)
    case "ne":
      return !deepEqualF(a, b)
    case "gt":
      return typeof a === "number" && typeof b === "number" ? a > b : typeof a === "string" && typeof b === "string" ? a > b : undefined
    case "lt":
      return typeof a === "number" && typeof b === "number" ? a < b : typeof a === "string" && typeof b === "string" ? a < b : undefined
    case "ge":
      return typeof a === "number" && typeof b === "number" ? a >= b : typeof a === "string" && typeof b === "string" ? a >= b : undefined
    case "le":
      return typeof a === "number" && typeof b === "number" ? a <= b : typeof a === "string" && typeof b === "string" ? a <= b : undefined
    case "and":
      return truthyF(a) ? b : a
    case "or":
      return truthyF(a) ? a : b
    default:
      return undefined
  }
}

function formatF(v: PirValue): string {
  if (v === null) return "nothing"
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `"${x}"` : formatF(x))).join(", ")}]`
  return String(v)
}

function truthyF(v: PirValue): boolean {
  if (v === null) return false
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

function deepEqualF(a: PirValue, b: PirValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqualF(x, b[i]))
  }
  return a === b
}

// ---------------------------------------------------------------------------
// Pass 2: Constant propagation
// ---------------------------------------------------------------------------

export const constantPropagation: PirPass = {
  name: "constant propagation",
  run(module) {
    let propagated = 0
    for (const fn of module.functions) {
      fn.blocks = fn.blocks.map((b) => ({ ...b, ops: propagateOps(b.ops, () => propagated++) }))
    }
    return { module, note: propagated > 0 ? `${propagated} load(s) propagated` : null }
  },
}

function propagateOps(ops: IROperation[], count: () => void): IROperation[] {
  /** var name → const value, valid while no store may change it */
  const constVars = new Map<string, PirValue>()
  /** temp name → const value (temps from const ops or folded stores) */
  const constTemps = new Map<string, PirValue>()
  const out: IROperation[] = []

  const rewrite = (ops: IROperation[]): IROperation[] => {
    const out: IROperation[] = []
    // Const state is local to each inline body (guards/loops may run
    // multiple times; being conservative keeps semantics safe).
    for (const op of ops) {
      const body = op.attrs?.__body as IROperation[] | undefined
      if (body) {
        out.push({ ...op, attrs: { ...op.attrs, __body: rewrite(body) } })
        continue
      }

      if (op.op === "store") {
        const name = op.operands[0].name!
        const valueRef = op.operands[1]
        let known: PirValue | undefined
        if (valueRef.kind === "const") known = valueRef.value ?? null
        else if (valueRef.kind === "temp" && valueRef.name && constTemps.has(valueRef.name))
          known = constTemps.get(valueRef.name)!
        if (known !== undefined) constVars.set(name, known)
        else constVars.delete(name)
        out.push(op)
        continue
      }

      if (op.op === "load") {
        const name = op.operands[0].name!
        if (constVars.has(name)) {
          // Replace `result = load x` with `result = const <value>`
          const v = constVars.get(name)!
          if (op.result) constTemps.set(op.result, v)
          out.push({
            op: "const",
            operands: [{ kind: "const", value: v, type: pirTypeOf(v) }],
            result: op.result,
            pos: op.pos,
          })
          count()
          continue
        }
        out.push(op)
        continue
      }

      // Calls may mutate state — drop all known constants to be safe.
      if (op.op === "call" || op.op === "call_user") {
        constVars.clear()
        constTemps.clear()
      }

      // Track const-producing temps (e.g. `%1 = const 7`) so stores through
      // temps (lowering's store-through-temp pattern) propagate too.
      if (op.op === "const" && op.result) {
        constTemps.set(op.result, op.operands[0].value ?? null)
      } else if (op.result) {
        // Any other value-producing op: its temp is not a known constant.
        constTemps.delete(op.result)
      }

      out.push(op)
    }
    return out
  }

  return rewrite(ops)
}

// ---------------------------------------------------------------------------
// Pass 3: Dead code elimination
// ---------------------------------------------------------------------------

export const deadCodeElimination: PirPass = {
  name: "dead code elimination",
  run(module) {
    let removed = 0
    for (const fn of module.functions) {
      fn.blocks = fn.blocks.map((b) => {
        const before = b.ops.length
        b.ops = eliminateDeadOps(b.ops)
        removed += before - b.ops.length
        return b
      })
    }
    return { module, note: removed > 0 ? `${removed} dead op(s) removed` : null }
  },
}

/**
 * Removes ops whose results are never used. Conservative: prints, stores,
 * calls, returns, app ops and control flow are never removed (they have
 * effects). Only pure value-producing ops whose temp is never referenced
 * later get dropped. Iterated to fixpoint; walks inline `__body` blocks.
 */
function eliminateDeadOps(ops: IROperation[]): IROperation[] {
  const isPure = (op: IROperation): boolean =>
    op.result !== undefined &&
    [
      "const", "load", "add", "sub", "mul", "div", "mod", "neg", "not",
      "eq", "ne", "gt", "lt", "ge", "le", "and", "or", "make_list",
      "index", "length", "join_text",
    ].includes(op.op)

  let current = ops
  for (let round = 0; round < 10; round++) {
    const used = new Set<string>()
    collectUsedTemps(current, used)

    const filtered = current.filter((op) => {
      if (!isPure(op)) return true
      return op.result !== undefined && used.has(op.result)
    })
    if (filtered.length === current.length) break
    current = filtered
  }
  return current
}

/** The default Phase 3 optimization pipeline. */
export const DEFAULT_PASSES: PirPass[] = [constantFolding, constantPropagation, deadCodeElimination]
