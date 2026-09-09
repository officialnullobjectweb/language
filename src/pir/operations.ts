/**
 * PIR operations (v0.3).
 *
 * Every PIR operation is strongly typed: it declares which operand types
 * it accepts and which type it produces. The validator consults
 * OP_SIGNATURES; the optimizer consults FOLDABLE to constant-fold; the
 * printer derives mnemonic names from the op codes.
 *
 * Naming follows the plan: core ops today, app ops (db.*, ui.*, api.*)
 * defined alongside so lowering can emit them in Phase 3B programs.
 */

import type { PirType } from "./types.js"

/** Core operation opcodes. */
export type CoreOp =
  | "const"
  | "load"
  | "store"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "neg"
  | "not"
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "ge"
  | "le"
  | "and"
  | "or"
  | "call"
  | "call_user"
  | "return"
  | "print"
  | "make_list"
  | "index"
  | "length"
  | "join_text"
  | "jump"
  | "jump_if_false"
  | "jump_if_true"

/** Application-model opcodes (Phase 3B surface, defined now for lowering). */
export type AppOp =
  | "app.create"
  | "db.entity"
  | "db.field"
  | "db.create"
  | "db.query"
  | "ui.page"
  | "ui.title"
  | "ui.button"
  | "ui.show"
  | "ui.text"
  | "state.create"
  | "state.get"
  | "state.set"
  | "event.click"
  | "api.route"
  | "auth.require"
  | "form.create"
  | "form.field"
  | "form.submit"

export type PirOp = CoreOp | AppOp

/** Operand type signature: accepted types per operand, produced type. */
export interface OpSignature {
  /** Human-readable name, used by printer/explain. */
  name: string
  /** Accepted types per operand (in order). Empty = no operands. */
  operands: PirType[] | "any"
  /** Type the operation produces, or null if it produces no value. */
  produces: PirType | null
  /** Whether this operation can be constant-folded when all operands are const. */
  foldable: boolean
  /** Which dialect the op belongs to. */
  dialect: "core" | "ui" | "data" | "api" | "auth"
}

const NUM: PirType = "number"
const STR: PirType = "string"
const BOOL: PirType = "boolean"

export const OP_SIGNATURES: Record<PirOp, OpSignature> = {
  // ----- core: values -----
  const: { name: "constant", operands: "any", produces: null, foldable: false, dialect: "core" },
  load: { name: "load variable", operands: "any", produces: "unknown", foldable: false, dialect: "core" },
  store: { name: "store variable", operands: "any", produces: null, foldable: false, dialect: "core" },
  // ----- core: arithmetic -----
  add: { name: "add", operands: [NUM, NUM], produces: NUM, foldable: true, dialect: "core" },
  sub: { name: "subtract", operands: [NUM, NUM], produces: NUM, foldable: true, dialect: "core" },
  mul: { name: "multiply", operands: [NUM, NUM], produces: NUM, foldable: true, dialect: "core" },
  div: { name: "divide", operands: [NUM, NUM], produces: NUM, foldable: true, dialect: "core" },
  mod: { name: "remainder", operands: [NUM, NUM], produces: NUM, foldable: true, dialect: "core" },
  neg: { name: "negate", operands: [NUM], produces: NUM, foldable: true, dialect: "core" },
  // ----- core: logic -----
  not: { name: "not", operands: [BOOL], produces: BOOL, foldable: true, dialect: "core" },
  eq: { name: "equal", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  ne: { name: "not equal", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  gt: { name: "greater than", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  lt: { name: "less than", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  ge: { name: "greater or equal", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  le: { name: "less or equal", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  and: { name: "logical and", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  or: { name: "logical or", operands: "any", produces: BOOL, foldable: true, dialect: "core" },
  // ----- core: calls & control -----
  call: { name: "call builtin", operands: "any", produces: "unknown", foldable: false, dialect: "core" },
  call_user: { name: "call function", operands: "any", produces: "unknown", foldable: false, dialect: "core" },
  return: { name: "return", operands: "any", produces: null, foldable: false, dialect: "core" },
  print: { name: "print", operands: "any", produces: null, foldable: false, dialect: "core" },
  make_list: { name: "make list", operands: "any", produces: "list", foldable: false, dialect: "core" },
  index: { name: "index into", operands: "any", produces: "unknown", foldable: false, dialect: "core" },
  length: { name: "length of", operands: "any", produces: NUM, foldable: false, dialect: "core" },
  join_text: { name: "join text", operands: "any", produces: STR, foldable: true, dialect: "core" },
  // ----- core: structured control flow (validator-level, emitted for loops) -----
  jump: { name: "jump", operands: "any", produces: null, foldable: false, dialect: "core" },
  jump_if_false: { name: "jump if false", operands: [BOOL], produces: null, foldable: false, dialect: "core" },
  jump_if_true: { name: "jump if true", operands: [BOOL], produces: null, foldable: false, dialect: "core" },

  // ----- app model -----
  "app.create": { name: "declare app", operands: "any", produces: null, foldable: false, dialect: "core" },
  "db.entity": { name: "declare entity", operands: "any", produces: null, foldable: false, dialect: "data" },
  "db.field": { name: "entity field", operands: "any", produces: null, foldable: false, dialect: "data" },
  "db.create": { name: "create record", operands: "any", produces: null, foldable: false, dialect: "data" },
  "db.query": { name: "query records", operands: "any", produces: "list", foldable: false, dialect: "data" },
  "ui.page": { name: "declare page", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "ui.title": { name: "set page title", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "ui.button": { name: "declare button", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "ui.show": { name: "show entity", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "ui.text": { name: "static text", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "state.create": { name: "create state", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "state.get": { name: "read state", operands: "any", produces: "unknown", foldable: false, dialect: "ui" },
  "state.set": { name: "write state", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "event.click": { name: "click event", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "api.route": { name: "api route", operands: "any", produces: null, foldable: false, dialect: "api" },
  "auth.require": { name: "require session", operands: "any", produces: null, foldable: false, dialect: "auth" },
  // ----- forms (v0.4) -----
  "form.create": { name: "declare form", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "form.field": { name: "form field", operands: "any", produces: null, foldable: false, dialect: "ui" },
  "form.submit": { name: "form submit action", operands: "any", produces: null, foldable: false, dialect: "ui" },
}

/** Mnemonic per opcode for the human-readable printer. */
export const OP_MNEMONIC: Record<PirOp, string> = {
  const: "const",
  load: "load",
  store: "store",
  add: "add",
  sub: "sub",
  mul: "mul",
  div: "div",
  mod: "mod",
  neg: "neg",
  not: "not",
  eq: "eq",
  ne: "ne",
  gt: "gt",
  lt: "lt",
  ge: "ge",
  le: "le",
  and: "and",
  or: "or",
  call: "call",
  call_user: "call",
  return: "return",
  print: "print",
  make_list: "list",
  index: "index",
  length: "length",
  join_text: "concat",
  jump: "jump",
  jump_if_false: "jump_if_false",
  jump_if_true: "jump_if_true",
  "app.create": "app.create",
  "db.entity": "db.entity",
  "db.field": "db.field",
  "db.create": "db.create",
  "db.query": "db.query",
  "ui.page": "ui.page",
  "ui.title": "ui.title",
  "ui.button": "ui.button",
  "ui.show": "ui.show",
  "ui.text": "ui.text",
  "state.create": "state.create",
  "state.get": "state.get",
  "state.set": "state.set",
  "event.click": "event.click",
  "api.route": "api.route",
  "auth.require": "auth.require",
  "form.create": "form.create",
  "form.field": "form.field",
  "form.submit": "form.submit",
}

/** Map a source BinaryOperator to its PIR opcode. */
export function binaryOpToOpcode(op: string): PirOp | null {
  switch (op) {
    case "+": return "add"
    case "-": return "sub"
    case "*": return "mul"
    case "/": return "div"
    case "%": return "mod"
    case "==": return "eq"
    case "!=": return "ne"
    case ">": return "gt"
    case "<": return "lt"
    case ">=": return "ge"
    case "<=": return "le"
    case "and": return "and"
    case "or": return "or"
    default: return null
  }
}
