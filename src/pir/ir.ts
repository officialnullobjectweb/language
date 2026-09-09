/**
 * PIR data model (v0.3).
 *
 *   IRModule
 *   └── IRFunction[]          (main is always function 0)
 *        └── IRBlock[]        (basic blocks for structured control flow)
 *             └── IROperation[]
 *
 * Operations produce SSA-like temporary values (%0, %1, …) that make data
 * flow explicit — ready for analysis, optimization and target generation.
 *
 * Control flow in v0.3 uses structured blocks: lowering emits `block` /
 * `endblock` markers inside a single instruction list. This keeps the IR
 * simple for humans while remaining mechanically traversable.
 */

import type { PirType, PirValue, AppFieldType } from "./types.js"
import type { PirOp } from "./operations.js"

/** A PIR value reference: a temporary (%n), a named variable, or inline data. */
export interface PirValueRef {
  kind: "temp" | "var" | "const"
  /** temp: the SSA number. var: the variable name. const: not used (data inline). */
  name?: string
  /** const refs carry their payload inline. */
  value?: PirValue
  type: PirType
}

export interface IROperation {
  op: PirOp
  /** Operand value refs, or inline constants ({"kind":"const","value":…}). */
  operands: PirValueRef[]
  /** Result temp name, when the operation produces a value. */
  result?: string
  /** Operation attributes (labels, names, types, field specs, inline body blocks…). */
  attrs?: Record<string, string | number | boolean | null | string[] | IROperation[]>
  /** Source position carried from the AST node that produced this op. */
  pos?: { line: number; column: number }
}

/** A structured control-flow region inside a function body. */
export interface IRBlock {
  /** Label used by jump targets ("if.then", "loop.body", "fn.entry"…). */
  label: string
  ops: IROperation[]
}

export interface IRFunction {
  name: string
  parameters: string[]
  /** Every function has at least one block ("entry"). */
  blocks: IRBlock[]
}

export interface IREntityField {
  name: string
  type: AppFieldType
  pirType: PirType
}

export interface IREntity {
  name: string
  fields: IREntityField[]
}

export interface IRModule {
  kind: "IRModule"
  /** PIR format version. */
  version: string
  /** Module name: "main" for plain programs, app name for app programs. */
  name: string
  /** Application title when the program declares one. */
  app?: { name: string }
  /** Entities declared by database statements. */
  entities: IREntity[]
  /** function 0 is always `main`. */
  functions: IRFunction[]
}

export function makeValueRefTemp(name: string, type: PirType = "unknown"): PirValueRef {
  return { kind: "temp", name, type }
}

export function makeValueRefVar(name: string, type: PirType = "unknown"): PirValueRef {
  return { kind: "var", name, type }
}

export function makeValueRefConst(value: PirValue): PirValueRef {
  return { kind: "const", value, type: typeof value === "number" ? "number" : typeof value === "string" ? "string" : typeof value === "boolean" ? "boolean" : Array.isArray(value) ? "list" : value === null ? "null" : "unknown" }
}

export function makeEntity(name: string, fields: { name: string; type: AppFieldType }[]): IREntity {
  return {
    name,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      pirType: f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string",
    })),
  }
}
