/**
 * Plainly Interpreter (v0.2).
 * Walks the AST and executes it directly (tree-walking interpreter).
 *
 * Errors carry stable codes and beginner-friendly messages; unknown
 * names get "did you mean" suggestions via the error system.
 */

import type { Block, Expr, Program, Stmt } from "./ast.js"
import { PlainError, ERROR_CODES, suggestName } from "./errors.js"
import type { PlainValue, PlainList, KamalFunction, PlainNativeFunction } from "./interpreter-types.js"
import { isList, isFunction, isNative } from "./interpreter-types.js"
import { createStdlib } from "./stdlib.js"
import { formatValue } from "./format.js"
import { BUILTIN_NAMES } from "./words.js"

export type { PlainValue, PlainList, KamalFunction, PlainNativeFunction }

export class ReturnSignal {
  constructor(public value: PlainValue) {}
}

export class Environment {
  private vars = new Map<string, PlainValue>()

  constructor(public parent: Environment | null = null) {}

  declare(name: string, value: PlainValue): void {
    this.vars.set(name, value)
  }

  has(name: string): boolean {
    let env: Environment | null = this
    while (env) {
      if (env.vars.has(name)) return true
      env = env.parent
    }
    return false
  }

  /** All visible names, walking outward (for did-you-mean suggestions). */
  visibleNames(): string[] {
    const names = new Set<string>()
    let env: Environment | null = this
    while (env) {
      for (const n of env.vars.keys()) names.add(n)
      env = env.parent
    }
    return [...names]
  }

  get(name: string, pos: { line: number; column: number }): PlainValue {
    let env: Environment | null = this
    while (env) {
      if (env.vars.has(name)) return env.vars.get(name)!
      env = env.parent
    }
    const suggestion = suggestName(name, allKnownNames(this))
    throw new PlainError(
      `You tried to use '${name}', but it doesn't exist yet.`,
      pos.line,
      pos.column,
      {
        code: ERROR_CODES.UNDEFINED_VARIABLE,
        hint: suggestion
          ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...`
          : `Create it first with: set ${name} = ...`,
      },
    )
  }

  assign(name: string, value: PlainValue, pos: { line: number; column: number }): void {
    let env: Environment | null = this
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value)
        return
      }
      env = env.parent
    }
    const suggestion = suggestName(name, allKnownNames(this))
    throw new PlainError(
      `You tried to change '${name}', but it doesn't exist yet.`,
      pos.line,
      pos.column,
      {
        code: ERROR_CODES.UNDEFINED_VARIABLE,
        hint: suggestion
          ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...`
          : `Create it first with: set ${name} = ...`,
      },
    )
  }

  /** Assign to the variable if it exists in scope; otherwise declare it here. */
  assignOrDeclare(name: string, value: PlainValue): void {
    let env: Environment | null = this
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value)
        return
      }
      env = env.parent
    }
    this.vars.set(name, value)
  }
}

function allKnownNames(env: Environment): string[] {
  const names = env.visibleNames()
  for (const b of BUILTIN_NAMES) names.push(b)
  return names
}

function truthy(v: PlainValue): boolean {
  if (v === null) return false
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v.length > 0
  if (isList(v)) return v.items.length > 0
  return true
}

export class Interpreter {
  private globals = new Environment()
  private callDepth = 0

  constructor(private print: (s: string) => void = (s) => console.log(s)) {
    for (const [name, native] of Object.entries(createStdlib())) {
      this.globals.declare(name, native)
    }
  }

  run(program: Program): void {
    this.execBlock(program.body, this.globals)
  }

  // ----- statements -----

  private execStmt(stmt: Stmt, env: Environment): void {
    switch (stmt.kind) {
      case "SayStmt": {
        const value = this.evalExpr(stmt.value, env)
        this.print(formatValue(value))
        return
      }
      case "SetStmt": {
        const value = this.evalExpr(stmt.value, env)
        env.assignOrDeclare(stmt.name, value)
        return
      }
      case "IfStmt": {
        if (truthy(this.evalExpr(stmt.condition, env))) {
          this.execBlock(stmt.then.body, env)
        } else if (stmt.otherwise) {
          if (stmt.otherwise.kind === "IfStmt") {
            this.execStmt(stmt.otherwise, env)
          } else {
            this.execBlock(stmt.otherwise.body, env)
          }
        }
        return
      }
      case "ForEachStmt": {
        const iterable = this.evalExpr(stmt.iterable, env)
        let items: PlainValue[]
        if (isList(iterable)) items = [...iterable.items]
        else if (typeof iterable === "string") items = iterable.split("")
        else {
          throw new PlainError(
            `You tried to loop over ${describeType(iterable)}, but you can only loop over a list or text.`,
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH },
          )
        }
        for (const item of items) {
          const loopEnv = new Environment(env)
          loopEnv.declare(stmt.varName, item)
          this.execBlock(stmt.body.body, loopEnv)
        }
        return
      }
      case "RepeatStmt": {
        const countVal = this.evalExpr(stmt.count, env)
        if (typeof countVal !== "number" || !Number.isInteger(countVal) || countVal < 0) {
          throw new PlainError(
            `'repeat' needs a whole number of times (0 or more), but you gave ${formatValue(countVal)}.`,
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH },
          )
        }
        for (let i = 0; i < countVal; i++) {
          this.execBlock(stmt.body.body, env)
        }
        return
      }
      case "FunctionDecl": {
        env.declare(stmt.name, {
          __plain_function: true,
          name: stmt.name,
          params: stmt.params,
          body: stmt.body,
          closure: env,
        })
        return
      }
      case "ReturnStmt": {
        if (this.callDepth === 0) {
          throw new PlainError(
            "'return' can only be used inside a function. Move it inside your function block.",
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.RETURN_OUTSIDE_FUNCTION },
          )
        }
        const value = stmt.value ? this.evalExpr(stmt.value, env) : null
        throw new ReturnSignal(value)
      }
      case "ExprStmt": {
        this.evalExpr(stmt.expr, env)
        return
      }
      // ----- application model (v0.3) -----
      // Declarative statements have no runtime effect on the console
      // interpreter; they are carried into PIR by the lowering pass, where
      // backends give them meaning. Page bodies still execute so that
      // button handlers (simulated clicks) run, matching the PIR parity
      // semantics.
      case "AppStmt":
      case "DatabaseStmt":
      case "TitleStmt":
      case "ShowStmt":
      case "CreateStmt":
        return
      case "PageStmt":
        this.execBlock(stmt.body.body, env)
        return
      case "StateStmt": {
        // State behaves like a variable in v0.3 (mirrors state.create in PIR).
        const value = this.evalExpr(stmt.value, env)
        env.declare(stmt.name, value)
        return
      }
      case "ButtonStmt": {
        // The PIR interpreter simulates one click at declaration time so
        // button side effects are observable; mirror that here for parity.
        this.execBlock(stmt.body.body, env)
        return
      }
      case "FormStmt": {
        // Forms are declarative UI: they produce no console output in the
        // AST interpreter. Lowering carries them into PIR, where the React
        // and backend generators give them meaning (v0.4).
        return
      }
    }
  }

  private execBlock(body: Stmt[], env: Environment): void {
    for (const stmt of body) {
      this.execStmt(stmt, env)
    }
  }

  // ----- expressions -----

  private evalExpr(expr: Expr, env: Environment): PlainValue {
    switch (expr.kind) {
      case "NumberLit":
        return expr.value
      case "StringLit":
        return expr.value
      case "BoolLit":
        return expr.value
      case "ListLit":
        return { __plain_list: true, items: expr.elements.map((e) => this.evalExpr(e, env)) }
      case "Identifier":
        return env.get(expr.name, expr.pos)
      case "UnaryExpr": {
        const v = this.evalExpr(expr.operand, env)
        if (expr.operator === "not") return !truthy(v)
        if (typeof v !== "number") {
          throw new PlainError(
            `You can only negate numbers, but you gave ${describeType(v)}.`,
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH },
          )
        }
        return -v
      }
      case "BinaryExpr":
        return this.evalBinary(expr, env)
      case "CallExpr": {
        const callee = this.evalExpr(expr.callee, env)
        const args = expr.args.map((a) => this.evalExpr(a, env))
        if (isFunction(callee)) {
          return this.callFunction(callee, args, expr.pos)
        }
        if (isNative(callee)) {
          return callee.fn(args, expr.pos)
        }
        throw new PlainError(
          "You tried to call something that isn't a function.",
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.NOT_A_FUNCTION },
        )
      }
      case "MemberExpr": {
        throw new PlainError(
          "Accessing properties with '.' is not supported yet in Plainly v0.2.",
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.UNEXPECTED_TOKEN },
        )
      }
      case "IndexExpr": {
        const obj = this.evalExpr(expr.object, env)
        const index = this.evalExpr(expr.index, env)
        if (isList(obj)) {
          if (typeof index !== "number" || !Number.isInteger(index)) {
            throw new PlainError(
              `List positions must be whole numbers, but you gave ${formatValue(index)}.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.TYPE_MISMATCH },
            )
          }
          if (index < 0 || index >= obj.items.length) {
            throw new PlainError(
              `You tried to get position ${index} from a list with ${obj.items.length} item(s). The first position is 0.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.INDEX_OUT_OF_RANGE },
            )
          }
          return obj.items[index]
        }
        if (typeof obj === "string") {
          if (typeof index !== "number" || !Number.isInteger(index)) {
            throw new PlainError(
              `Text positions must be whole numbers, but you gave ${formatValue(index)}.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.TYPE_MISMATCH },
            )
          }
          if (index < 0 || index >= obj.length) {
            throw new PlainError(
              `You tried to get position ${index} from text with ${obj.length} character(s). The first position is 0.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.INDEX_OUT_OF_RANGE },
            )
          }
          return obj[index]
        }
        throw new PlainError(
          `You tried to reach into ${describeType(obj)}, but only lists and text can be indexed.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH },
        )
      }
    }
  }

  private callFunction(fn: KamalFunction, args: PlainValue[], pos: { line: number; column: number }): PlainValue {
    if (args.length !== fn.params.length) {
      throw new PlainError(
        `The function '${fn.name}' needs ${fn.params.length} value(s), but you gave ${args.length}.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.WRONG_ARG_COUNT },
      )
    }
    const callEnv = new Environment(fn.closure as Environment)
    fn.params.forEach((p, i) => callEnv.declare(p, args[i]))
    this.callDepth++
    try {
      this.execBlock(fn.body.body, callEnv)
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value
      throw err
    } finally {
      this.callDepth--
    }
    return null
  }

  private evalBinary(
    expr: Extract<Expr, { kind: "BinaryExpr" }>,
    env: Environment,
  ): PlainValue {
    // and/or short-circuit
    if (expr.operator === "and") {
      const left = this.evalExpr(expr.left, env)
      return truthy(left) ? this.evalExpr(expr.right, env) : left
    }
    if (expr.operator === "or") {
      const left = this.evalExpr(expr.left, env)
      return truthy(left) ? left : this.evalExpr(expr.right, env)
    }

    const left = this.evalExpr(expr.left, env)
    const right = this.evalExpr(expr.right, env)

    switch (expr.operator) {
      case "+": {
        if (typeof left === "number" && typeof right === "number") return left + right
        if (typeof left === "string" || typeof right === "string") {
          return formatValue(left) + formatValue(right)
        }
        if (isList(left) && isList(right)) {
          return { __plain_list: true, items: [...left.items, ...right.items] }
        }
        throw new PlainError(
          `You tried to add ${describeType(left)} and ${describeType(right)}. Numbers add, text joins, lists combine.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.INVALID_OPERATION },
        )
      }
      case "-":
      case "*":
      case "/":
      case "%": {
        if (typeof left !== "number" || typeof right !== "number") {
          throw new PlainError(
            `You tried to use '${expr.operator}' on ${describeType(left)} and ${describeType(right)}. These operators need numbers.`,
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH },
          )
        }
        if (expr.operator === "/" && right === 0) {
          throw new PlainError(
            "You tried to divide by zero. Check the value you're dividing by.",
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.DIVIDE_BY_ZERO },
          )
        }
        if (expr.operator === "%" && right === 0) {
          throw new PlainError(
            "You tried to take the remainder by zero. Check the value you're dividing by.",
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.DIVIDE_BY_ZERO },
          )
        }
        if (expr.operator === "-") return left - right
        if (expr.operator === "*") return left * right
        if (expr.operator === "/") return left / right
        return left % right
      }
      case ">":
      case "<":
      case ">=":
      case "<=": {
        if (typeof left === "number" && typeof right === "number") {
          switch (expr.operator) {
            case ">": return left > right
            case "<": return left < right
            case ">=": return left >= right
            case "<=": return left <= right
          }
        }
        if (typeof left === "string" && typeof right === "string") {
          switch (expr.operator) {
            case ">": return left > right
            case "<": return left < right
            case ">=": return left >= right
            case "<=": return left <= right
          }
        }
        throw new PlainError(
          `You tried to compare ${describeType(left)} with ${describeType(right)} using '${expr.operator}'. Compare two numbers or two pieces of text.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH },
        )
      }
      case "==":
        return valuesEqual(left, right)
      case "!=":
        return !valuesEqual(left, right)
    }
  }
}

function valuesEqual(left: PlainValue, right: PlainValue): boolean {
  if (isList(left) && isList(right)) {
    if (left.items.length !== right.items.length) return false
    return left.items.every((item, i) => valuesEqual(item, right.items[i]))
  }
  if (typeof left === "number" && typeof right === "number") return left === right
  if (typeof left === "string" && typeof right === "string") return left === right
  if (typeof left === "boolean" && typeof right === "boolean") return left === right
  if (left === null && right === null) return true
  return false
}

export function describeType(v: PlainValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return "a number"
  if (typeof v === "string") return "text"
  if (typeof v === "boolean") return "true/false"
  if (isList(v)) return "a list"
  if (isFunction(v) || isNative(v)) return "a function"
  return "a value"
}
