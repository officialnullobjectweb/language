/**
 * PIR Builder (v0.3).
 *
 * The lowering pass uses this to construct IR without hand-assembling
 * node objects:
 *
 *   const b = new PIRBuilder("main")
 *   const t1 = b.const(100)
 *   const t2 = b.const(5)
 *   const t3 = b.binary("mul", t1, t2)
 *   b.store("total", t3)
 *   b.print(b.load("total"))
 *
 * Temporaries are allocated %0, %1, … per function. Control flow uses
 * block scopes: beginBlock()/endBlock() nest; the printer renders them
 * with indentation, the validator walks them, and the interpreter
 * executes them.
 */

import type {
  IROperation, IRBlock, IRFunction, IRModule, PirValueRef, IREntity,
} from "./ir.js"
import { makeValueRefTemp, makeValueRefVar, makeValueRefConst } from "./ir.js"
import type { PirType, PirValue, AppFieldType } from "./types.js"
import { pirTypeOf } from "./types.js"
import type { PirOp } from "./operations.js"

interface BlockScope {
  block: IRBlock
  ended: boolean
}

export class PIRBuilder {
  private tempCounter = 0
  /** Every temp value that was allocated but not yet attached to an op. */
  private danglingTemps = new Set<string>()
  private scopes: BlockScope[] = []
  readonly entry: IRBlock

  constructor(
    readonly moduleName: string,
    private functionName: string = "main",
    private parameters: string[] = [],
  ) {
    this.entry = { label: "entry", ops: [] }
    this.scopes.push({ block: this.entry, ended: false })
  }

  /** Temp numbering, shared between a builder and its detached children. */
  getTempCount(): number {
    return this.tempCounter
  }

  setTempCount(n: number): void {
    this.tempCounter = n
  }

  // ----- structure -----

  get currentBlock(): IRBlock {
    return this.scopes[this.scopes.length - 1].block
  }

  get currentOps(): IROperation[] {
    return this.currentBlock.ops
  }

  beginBlock(label: string): void {
    this.scopes.push({ block: { label, ops: [] }, ended: false })
  }

  endBlock(): IRBlock {
    const scope = this.scopes.pop()
    if (!scope) throw new Error("PIRBuilder: endBlock() with no open block")
    scope.ended = true
    // Append finished blocks to the parent's op list as a nested marker op.
    const parent = this.scopes[this.scopes.length - 1]
    if (parent) {
      parent.block.ops.push({
        op: "jump", // structural marker; printer renders this as a block
        operands: [],
        attrs: { __block: true, label: scope.block.label },
        // nested ops are carried via a side table on the function
      })
      this.nestedBlocks.push(scope.block)
    }
    return scope.block
  }

  /** Nested blocks accumulated during building, attached to the function. */
  private nestedBlocks: IRBlock[] = []

  // ----- temporaries -----

  /** Allocate a fresh temp. Call attachTemp() when its op is emitted. */
  newTemp(): string {
    const name = `%${this.tempCounter++}`
    this.danglingTemps.add(name)
    return name
  }

  /** Mark a temp as produced by its defining op (cleared from dangling). */
  attachTemp(name: string): void {
    this.danglingTemps.delete(name)
  }

  peekTemp(): string {
    return `%${this.tempCounter}`
  }

  // ----- core ops -----

  /** Emit a constant; returns its ref. Constants get a result temp so the
   *  interpreter tracks them like every other value-producing op. */
  const(value: PirValue, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "const", operands: [makeValueRefConst(value)], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, typeOfConst(value))
  }

  load(name: string, pos?: { line: number; column: number }, type: PirType = "unknown"): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "load", operands: [makeValueRefVar(name, type)], result, pos })
    return makeValueRefTemp(result, type)
  }

  store(name: string, value: PirValueRef, pos?: { line: number; column: number }): void {
    this.emit({ op: "store", operands: [makeValueRefVar(name), value], pos })
  }

  binary(op: PirOp, left: PirValueRef, right: PirValueRef, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op, operands: [left, right], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, OP_PRODUCES[op] ?? "unknown")
  }

  unary(op: PirOp, operand: PirValueRef, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op, operands: [operand], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, OP_PRODUCES[op] ?? "unknown")
  }

  callBuiltin(name: string, args: PirValueRef[], pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "call", operands: args, result, attrs: { callee: name }, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "unknown")
  }

  callUser(name: string, args: PirValueRef[], pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "call_user", operands: args, result, attrs: { callee: name }, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "unknown")
  }

  return(value: PirValueRef | null, pos?: { line: number; column: number }): void {
    this.emit({ op: "return", operands: value ? [value] : [], pos })
  }

  print(value: PirValueRef, pos?: { line: number; column: number }): void {
    this.emit({ op: "print", operands: [value], pos })
  }

  makeList(items: PirValueRef[], pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "make_list", operands: items, result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "list")
  }

  index(object: PirValueRef, i: PirValueRef, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "index", operands: [object, i], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "unknown")
  }

  lengthOf(value: PirValueRef, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "length", operands: [value], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "number")
  }

  // ----- app model ops -----

  appCreate(name: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "app.create", operands: [makeValueRefConst(name)], pos })
  }

  dbEntity(name: string, fields: { name: string; type: AppFieldType }[], pos?: { line: number; column: number }): void {
    this.emit({
      op: "db.entity",
      operands: [makeValueRefConst(name)],
      attrs: {
        entity: name,
        fields: fields.map((f) => `${f.name}:${f.type}`),
      },
      pos,
    })
  }

  uiPage(name: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "ui.page", operands: [makeValueRefConst(name)], attrs: { page: name }, pos })
  }

  uiTitle(text: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "ui.title", operands: [makeValueRefConst(text)], pos })
  }

  uiButton(label: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "ui.button", operands: [makeValueRefConst(label)], attrs: { label }, pos })
  }

  uiShow(entity: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "ui.show", operands: [makeValueRefConst(entity)], pos })
  }

  uiText(text: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "ui.text", operands: [makeValueRefConst(text)], pos })
  }

  stateCreate(name: string, value: PirValueRef, pos?: { line: number; column: number }): void {
    this.emit({ op: "state.create", operands: [makeValueRefConst(name), value], pos })
  }

  stateGet(name: string, pos?: { line: number; column: number }): PirValueRef {
    const result = this.newTemp()
    this.emit({ op: "state.get", operands: [makeValueRefConst(name)], result, pos })
    this.attachTemp(result)
    return makeValueRefTemp(result, "unknown")
  }

  stateSet(name: string, value: PirValueRef, pos?: { line: number; column: number }): void {
    this.emit({ op: "state.set", operands: [makeValueRefConst(name), value], pos })
  }

  eventClick(pos?: { line: number; column: number }): void {
    this.emit({ op: "event.click", operands: [], pos })
  }

  dbCreate(entity: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "db.create", operands: [makeValueRefConst(entity)], pos })
  }

  // ----- form ops (v0.4) -----

  formCreate(label: string, entity: string, pos?: { line: number; column: number }): void {
    this.emit({
      op: "form.create",
      operands: [makeValueRefConst(label)],
      attrs: { label, entity },
      pos,
    })
  }

  formField(name: string, type: string, pos?: { line: number; column: number }): void {
    this.emit({ op: "form.field", operands: [makeValueRefConst(name)], attrs: { name, type }, pos })
  }

  formSubmit(entity: string, fields: string[], pos?: { line: number; column: number }): void {
    this.emit({ op: "form.submit", operands: [makeValueRefConst(entity)], attrs: { entity, fields }, pos })
  }

  // ----- internals -----

  private emit(op: IROperation): void {
    this.currentOps.push(op)
  }
}

function typeOfConst(v: PirValue): PirType {
  if (v === null) return "null"
  if (typeof v === "number") return "number"
  if (typeof v === "string") return "string"
  if (typeof v === "boolean") return "boolean"
  if (Array.isArray(v)) return "list"
  return "unknown"
}

/** Produces-type lookup used by the builder to type temp values. */
export const OP_PRODUCES: Partial<Record<PirOp, PirType>> = {
  add: "number", sub: "number", mul: "number", div: "number", mod: "number", neg: "number",
  not: "boolean", eq: "boolean", ne: "boolean", gt: "boolean", lt: "boolean", ge: "boolean", le: "boolean",
  and: "boolean", or: "boolean", length: "number", join_text: "string", make_list: "list",
}
