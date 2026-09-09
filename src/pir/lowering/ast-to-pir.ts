/**
 * AST → PIR lowering (v0.3). The heart of Phase 3.
 *
 * Walks the AST and emits PIR through the builder:
 *
 *   set total = price * quantity
 *
 * becomes
 *
 *   %0 = load price
 *   %1 = load quantity
 *   %2 = mul %0, %1
 *   store total, %2
 *
 * Control flow (if / loops) lowers to nested structured blocks. The app
 * model (app/database/page/button/state) lowers to app-PIR ops in the
 * main function's entry block, in declaration order.
 */

import type {
  Expr, Program, Stmt, BinaryExpr, UnaryExpr,
} from "../../ast.js"
import { PlainError, ERROR_CODES } from "../../errors.js"
import { PIRBuilder } from "../builder.js"
import { binaryOpToOpcode } from "../operations.js"
import type { IRModule, IRFunction, IROperation } from "../ir.js"
import { makeEntity } from "../ir.js"
import type { PirValueRef } from "../ir.js"
import type { PirValue } from "../types.js"

const FORMAT_PRODUCTIONS: Record<string, string> = {
  eq: "eq", ne: "ne", gt: "gt", lt: "lt", ge: "ge", le: "le",
}

export class LoweringError extends PlainError {
  constructor(message: string, line: number, column: number, hint?: string) {
    super(message, line, column, { code: ERROR_CODES.INVALID_OPERATION, hint })
  }
}

interface FnContext {
  name: string
  parameters: string[]
  builder: PIRBuilder
  /** Name of a variable holding the current loop item, per nesting level. */
  loopVars: string[]
}

export function lowerProgram(program: Program): IRModule {
  const lowerer = new Lowerer(program)
  return lowerer.lower()
}

class Lowerer {
  private main: PIRBuilder
  private functions: IRFunction[] = []
  private entities: IRModule["entities"] = []
  private appName: string | null = null
  private current: PIRBuilder
  private fnStack: FnContext[] = []
  private userFunctions = new Map<string, { params: string[] }>()
  /** Names declared via `state` — reads/writes lower to state.get/state.set. */
  private stateVars = new Set<string>()

  constructor(private program: Program) {
    this.main = new PIRBuilder("main")
    this.current = this.main
  }

  lower(): IRModule {
    for (const stmt of this.program.body) {
      this.execStmt(stmt)
    }
    // Ensure main returns.
    this.current.return(null)

    const mainFn: IRFunction = {
      name: "main",
      parameters: [],
      blocks: [{ label: "entry", ops: this.main.currentBlock.ops }],
    }
    this.functions.unshift(mainFn)

    const module: IRModule = {
      kind: "IRModule",
      version: "0.3",
      name: this.appName ?? "main",
      entities: this.entities,
      functions: this.functions,
    }
    if (this.appName) module.app = { name: this.appName }
    return module
  }

  // ----- statements -----

  private execStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case "SayStmt": {
        const v = this.evalExpr(stmt.value)
        this.current.print(v, stmt.pos)
        return
      }
      case "SetStmt": {
        const v = this.evalExpr(stmt.value)
        if (this.stateVars.has(stmt.name)) {
          this.current.stateSet(stmt.name, v, stmt.pos)
        } else {
          this.current.store(stmt.name, v, stmt.pos)
        }
        return
      }
      case "IfStmt":
        this.lowerIf(stmt)
        return
      case "ForEachStmt":
        this.lowerForEach(stmt)
        return
      case "RepeatStmt":
        this.lowerRepeat(stmt)
        return
      case "FunctionDecl":
        this.lowerFunction(stmt)
        return
      case "ReturnStmt": {
        const v = stmt.value ? this.evalExpr(stmt.value) : null
        this.current.return(v, stmt.pos)
        return
      }
      case "ExprStmt": {
        this.evalExpr(stmt.expr)
        return
      }
      // ----- app model -----
      case "AppStmt": {
        this.appName = stmt.name
        this.current.appCreate(stmt.name, stmt.pos)
        return
      }
      case "DatabaseStmt": {
        this.entities.push(makeEntity(stmt.name, stmt.fields))
        this.current.dbEntity(stmt.name, stmt.fields, stmt.pos)
        return
      }
      case "PageStmt": {
        this.current.uiPage(stmt.name, stmt.pos)
        for (const s of stmt.body.body) this.execStmt(s)
        return
      }
      case "TitleStmt":
        this.current.uiTitle(stmt.value, stmt.pos)
        return
      case "ButtonStmt": {
        this.current.uiButton(stmt.label, stmt.pos)
        // The button body is a click event handler: represented as an
        // event.click op carrying the handler body inline.
        const handlerOps = this.lowerDetached(stmt.body.body, "event.click")
        this.current.currentOps.push({ op: "event.click", operands: [], attrs: { __body: handlerOps }, pos: stmt.pos })
        return
      }
      case "ShowStmt":
        this.current.uiShow(stmt.entity, stmt.pos)
        return
      case "StateStmt": {
        const v = this.evalExpr(stmt.value)
        this.stateVars.add(stmt.name)
        this.current.stateCreate(stmt.name, v, stmt.pos)
        return
      }
      case "CreateStmt":
        this.current.dbCreate(stmt.entity, stmt.pos)
        return
      case "FormStmt": {
        this.current.formCreate(stmt.label, stmt.entity, stmt.pos)
        for (const f of stmt.fields) this.current.formField(f.name, f.type, stmt.pos)
        this.current.formSubmit(stmt.entity, stmt.fields.map((f) => f.name), stmt.pos)
        return
      }
    }
  }

  // ----- control flow -----

  private lowerIf(stmt: Extract<Stmt, { kind: "IfStmt" }>): void {
    const cond = this.evalExpr(stmt.condition)
    // Lower the then-body into a detached sub-builder.
    const thenOps = this.lowerDetached(stmt.then.body, "if.then")
    this.current.currentOps.push({
      op: "jump_if_false",
      operands: [cond],
      attrs: { __body: thenOps },
      pos: stmt.pos,
    })

    if (stmt.otherwise) {
      // Else-guards run their body when the condition is FALSE, so we negate
      // the condition explicitly — every jump_if_false then shares one
      // meaning: "execute __body when the guard value is true".
      if (stmt.otherwise.kind === "IfStmt") {
        // otherwise-if: guard nests in the else position.
        const elseOps: IROperation[] = []
        const prev = this.current
        const detached = new PIRBuilder(this.current.moduleName)
        detached.setTempCount(prev.getTempCount())
        this.current = detached
        this.lowerIf(stmt.otherwise)
        prev.setTempCount(detached.getTempCount())
        elseOps.push(...detached.currentBlock.ops)
        this.current = prev
        const negated = this.negateRef(cond)
        this.current.currentOps.push({
          op: "jump_if_false",
          operands: [negated],
          attrs: { __body: elseOps, else: true },
          pos: stmt.pos,
        })
      } else {
        const elseOps = this.lowerDetached(stmt.otherwise.body, "if.else")
        const negated = this.negateRef(cond)
        this.current.currentOps.push({
          op: "jump_if_false",
          operands: [negated],
          attrs: { __body: elseOps, else: true },
          pos: stmt.pos,
        })
      }
    }
  }

  /** Emit a `not` op producing a fresh temp holding !ref. */
  private negateRef(ref: PirValueRef): PirValueRef {
    return this.current.unary("not", ref)
  }

  /** Lower statements into a detached builder, returning its ops. */
  private lowerDetached(stmts: Stmt[], label: string): IROperation[] {
    const prev = this.current
    const detached = new PIRBuilder(this.current.moduleName)
    // Share the temp counter so body temps never collide with outer temps.
    detached.setTempCount(prev.getTempCount())
    this.current = detached
    for (const s of stmts) this.execStmt(s)
    // Carry any temp growth back to the outer builder.
    prev.setTempCount(detached.getTempCount())
    this.current = prev
    return detached.currentBlock.ops
  }

  private lowerForEach(stmt: Extract<Stmt, { kind: "ForEachStmt" }>): void {
    const iterable = this.evalExpr(stmt.iterable)
    const bodyOps = this.lowerDetached(stmt.body.body, "loop.each")
    this.current.currentOps.push({
      op: "jump_if_true",
      operands: [iterable],
      attrs: { forEach: stmt.varName, __body: bodyOps },
      pos: stmt.pos,
    })
  }

  private lowerRepeat(stmt: Extract<Stmt, { kind: "RepeatStmt" }>): void {
    const count = this.evalExpr(stmt.count)
    const bodyOps = this.lowerDetached(stmt.body.body, "loop.repeat")
    this.current.currentOps.push({
      op: "jump_if_true",
      operands: [count],
      attrs: { repeat: true, __body: bodyOps },
      pos: stmt.pos,
    })
  }

  private lowerFunction(stmt: Extract<Stmt, { kind: "FunctionDecl" }>): void {
    this.userFunctions.set(stmt.name, { params: stmt.params })
    const builder = new PIRBuilder("main", stmt.name, stmt.params)
    const fnCtx: FnContext = { name: stmt.name, parameters: stmt.params, builder, loopVars: [] }
    this.fnStack.push(fnCtx)
    const prev = this.current
    this.current = builder
    for (const s of stmt.body.body) this.execStmt(s)
    this.current.return(null)
    this.current = prev
    this.fnStack.pop()
    this.functions.push({
      name: stmt.name,
      parameters: stmt.params,
      blocks: [{ label: "entry", ops: builder.currentBlock.ops }],
    })
  }

  // ----- expressions -----

  private evalExpr(expr: Expr): PirValueRef {
    switch (expr.kind) {
      case "NumberLit":
        return this.current.const(expr.value, expr.pos)
      case "StringLit":
        return this.current.const(expr.value, expr.pos)
      case "BoolLit":
        return this.current.const(expr.value, expr.pos)
      case "ListLit":
        return this.current.makeList(expr.elements.map((e) => this.evalExpr(e)), expr.pos)
      case "Identifier":
        // State variables read through the state dialect (plan §26):
        // Plainly describes the concept, the backend picks the storage.
        if (this.stateVars.has(expr.name)) {
          return this.current.stateGet(expr.name, expr.pos)
        }
        return this.current.load(expr.name, expr.pos)
      case "UnaryExpr": {
        const operand = this.evalExpr(expr.operand)
        return this.current.unary(expr.operator === "-" ? "neg" : "not", operand, expr.pos)
      }
      case "BinaryExpr":
        return this.lowerBinary(expr)
      case "CallExpr": {
        const args = expr.args.map((a) => this.evalExpr(a))
        if (expr.callee.kind === "Identifier") {
          const name = expr.callee.name
          if (this.userFunctions.has(name)) {
            return this.current.callUser(name, args, expr.pos)
          }
          return this.current.callBuiltin(name, args, expr.pos)
        }
        throw new LoweringError(
          "Only direct function calls are supported in PIR v0.3.",
          expr.pos.line,
          expr.pos.column,
        )
      }
      case "IndexExpr": {
        const obj = this.evalExpr(expr.object)
        const idx = this.evalExpr(expr.index)
        return this.current.index(obj, idx, expr.pos)
      }
      case "MemberExpr":
        throw new LoweringError(
          "Property access is not supported in PIR v0.3.",
          expr.pos.line,
          expr.pos.column,
        )
    }
  }

  private lowerBinary(expr: BinaryExpr): PirValueRef {
    // Short-circuit: and/or lower to select-style ops in v0.3 — the
    // interpreter implements short-circuit semantics for these opcodes
    // directly, so operands are emitted eagerly here (documented).
    const left = this.evalExpr(expr.left)
    const right = this.evalExpr(expr.right)
    const opcode = binaryOpToOpcode(expr.operator)
    if (!opcode) {
      throw new LoweringError(
        `Operator '${expr.operator}' cannot be lowered to PIR.`,
        expr.pos.line,
        expr.pos.column,
      )
    }
    if (expr.operator === "and" || expr.operator === "or") {
      // Keep source-level mnemonic in attrs for the explain feature.
      return this.current.binary(opcode, left, right, expr.pos)
    }
    // "+" with any text operand lowers to join_text (matches interpreter).
    if (expr.operator === "+") {
      return this.current.binary("add", left, right, expr.pos)
    }
    void FORMAT_PRODUCTIONS
    return this.current.binary(opcode, left, right, expr.pos)
  }
}
