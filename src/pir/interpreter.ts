/**
 * PIR Interpreter (v0.3).
 *
 * Executes a module directly. Together with the AST interpreter this
 * gives two independent execution systems — if both produce the same
 * output, the lowering is proven behavior-preserving (parity tests).
 *
 * Control flow executes structured blocks:
 *   - `jump_if_false` with `then` attr runs the following nested block
 *     only when the condition holds (if/otherwise).
 *   - `jump_if_true` with `forEach`/`repeat` attrs iterates the block.
 */

import type { IRModule, IRFunction, IROperation } from "./ir.js"
import type { PirValue, PirClosure } from "./types.js"
import { makeFunctionTable, type PirFunctionTable, type PirBuiltinImpl } from "./functions.js"
import { plainThrow, ERROR_CODES, type Position } from "../errors.js"

export interface PirRunResult {
  output: string[]
  /** Final value of `main` (null unless returned). */
  result: PirValue
}

class PirReturn {
  constructor(readonly value: PirValue) {}
}

export class PirInterpreter {
  private globals = new Map<string, PirValue>()
  private states = new Map<string, PirValue>()
  private records = new Map<string, PirValue[]>()
  private output: string[] = []
  private table: PirFunctionTable
  private callDepth = 0
  private static MAX_CALL_DEPTH = 900

  constructor(
    private module: IRModule,
    builtins?: Record<string, PirBuiltinImpl>,
    private print: (s: string) => void = (s) => this.output.push(s),
  ) {
    this.table = makeFunctionTable(module, builtins ?? defaultBuiltins())
  }

  run(): PirRunResult {
    const main = this.module.functions[0]
    if (!main) throw new Error("PIR module has no functions")
    const result = this.callFunction(main, [])
    return { output: [...this.output], result }
  }

  // ----- functions -----

  private callFunction(fn: IRFunction, args: PirValue[]): PirValue {
    if (this.callDepth > PirInterpreter.MAX_CALL_DEPTH) {
      plainThrow(ERROR_CODES.INVALID_OPERATION, "This program recursion is too deep.", { line: 0, column: 0 })
    }
    const locals = new Map<string, PirValue>()
    fn.parameters.forEach((p, i) => locals.set(p, args[i] ?? null))
    this.callDepth++
    try {
      for (const block of fn.blocks) {
        this.execBlock(block.ops, locals, fn)
      }
    } catch (err) {
      if (err instanceof PirReturn) return err.value
      throw err
    } finally {
      this.callDepth--
    }
    return null
  }

  // ----- blocks & ops -----

  private execBlock(ops: IROperation[], env: Map<string, PirValue>, fn: IRFunction): void {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]

      // Structural nested block emitted by builder.endBlock
      if (op.attrs?.__block === true) continue // block contents live in side table — handled below

      switch (op.op) {
        case "const":
          // Const ops define their result temp (refs also carry the value
          // inline, so consumers can read either way).
          if (op.result) {
            env.set(op.result, op.operands[0].value ?? null)
          }
          break
        case "load": {
          const name = op.operands[0].name!
          if (!env.has(name) && !this.globals.has(name)) {
            plainThrow(
              ERROR_CODES.UNDEFINED_VARIABLE,
              `You tried to use '${name}', but it doesn't exist yet.`,
              this.posOf(op),
            )
          }
          if (op.result) {
            env.set(op.result, env.has(name) ? env.get(name)! : this.globals.get(name)!)
          }
          break
        }
        case "store": {
          const name = op.operands[0].name!
          env.set(name, this.evalRef(op.operands[1], env, fn))
          break
        }
        case "add": {
          const l = this.evalRef(op.operands[0], env, fn)
          const r = this.evalRef(op.operands[1], env, fn)
          this.setTemp(op, joinOrAdd(l, r, this.posOf(op)), env)
          break
        }
        case "sub":
        case "mul":
        case "div":
        case "mod": {
          const l = this.evalRef(op.operands[0], env, fn)
          const r = this.evalRef(op.operands[1], env, fn)
          if (typeof l !== "number" || typeof r !== "number") {
            plainThrow(
              ERROR_CODES.TYPE_MISMATCH,
              `These operations need numbers, but you gave ${describe(l)} and ${describe(r)}.`,
              this.posOf(op),
            )
          }
          if ((op.op === "div" || op.op === "mod") && r === 0) {
            plainThrow(ERROR_CODES.DIVIDE_BY_ZERO, "You tried to divide by zero.", this.posOf(op))
          }
          const v = op.op === "sub" ? l - r : op.op === "mul" ? l * r : op.op === "div" ? l / r : l % r
          this.setTemp(op, v, env)
          break
        }
        case "neg": {
          const v = this.evalRef(op.operands[0], env, fn)
          this.setTemp(op, -(v as number), env)
          break
        }
        case "not":
          this.setTemp(op, !truthy(this.evalRef(op.operands[0], env, fn)), env)
          break
        case "eq":
          this.setTemp(op, deepEqual(this.evalRef(op.operands[0], env, fn), this.evalRef(op.operands[1], env, fn)), env)
          break
        case "ne":
          this.setTemp(op, !deepEqual(this.evalRef(op.operands[0], env, fn), this.evalRef(op.operands[1], env, fn)), env)
          break
        case "gt":
        case "lt":
        case "ge":
        case "le": {
          const l = this.evalRef(op.operands[0], env, fn)
          const r = this.evalRef(op.operands[1], env, fn)
          this.setTemp(op, compare(l, r, op.op, this.posOf(op)), env)
          break
        }
        case "and":
        case "or": {
          const l = this.evalRef(op.operands[0], env, fn)
          const r = this.evalRef(op.operands[1], env, fn)
          this.setTemp(op, op.op === "and" ? (truthy(l) ? r : l) : truthy(l) ? l : r, env)
          break
        }
        case "call": {
          const callee = String(op.attrs?.callee)
          const impl = this.table.builtins.get(callee)
          if (!impl) {
            plainThrow(ERROR_CODES.NOT_A_FUNCTION, `'${callee}' is not a function.`, this.posOf(op))
          }
          const args = op.operands.map((a) => this.evalRef(a, env, fn))
          this.setTemp(op, impl(args), env)
          break
        }
        case "call_user": {
          const callee = String(op.attrs?.callee)
          const entry = this.table.user.get(callee)
          if (!entry) {
            plainThrow(ERROR_CODES.NOT_A_FUNCTION, `There is no function named '${callee}'.`, this.posOf(op))
          }
          const args = op.operands.map((a) => this.evalRef(a, env, fn))
          if (args.length !== entry.ir.parameters.length) {
            plainThrow(
              ERROR_CODES.WRONG_ARG_COUNT,
              `The function '${callee}' needs ${entry.ir.parameters.length} value(s), but you gave ${args.length}.`,
              this.posOf(op),
            )
          }
          this.setTemp(op, this.callFunction(entry.ir, args), env)
          break
        }
        case "return":
          throw new PirReturn(op.operands.length > 0 ? this.evalRef(op.operands[0], env, fn) : null)
        case "print":
          this.print(formatValue(this.evalRef(op.operands[0], env, fn)))
          break
        case "make_list":
          this.setTemp(op, op.operands.map((a) => this.evalRef(a, env, fn)), env)
          break
        case "index": {
          const obj = this.evalRef(op.operands[0], env, fn)
          const idx = this.evalRef(op.operands[1], env, fn)
          this.setTemp(op, this.indexInto(obj, idx, this.posOf(op)), env)
          break
        }
        case "length": {
          const v = this.evalRef(op.operands[0], env, fn)
          if (typeof v === "string") this.setTemp(op, v.length, env)
          else if (Array.isArray(v)) this.setTemp(op, v.length, env)
          else {
            plainThrow(ERROR_CODES.TYPE_MISMATCH, "Only text and lists have a length.", this.posOf(op))
          }
          break
        }
        case "join_text": {
          const l = this.evalRef(op.operands[0], env, fn)
          const r = this.evalRef(op.operands[1], env, fn)
          this.setTemp(op, formatValue(l) + formatValue(r), env)
          break
        }
        // ----- app model -----
        case "app.create":
        case "db.entity":
        case "ui.page":
        case "ui.title":
        case "ui.button":
        case "ui.show":
        case "ui.text":
        case "form.create":
        case "form.field":
        case "form.submit":
          break // declarative: no runtime effect at runtime; backends consume them
        case "event.click": {
          // The handler body runs when the button is clicked; the PIR
          // interpreter simulates one click at declaration time so button
          // side effects (say/create) are observable.
          const body = (op.attrs?.__body as IROperation[] | undefined) ?? []
          if (body.length > 0) this.execBlock(body, env, fn)
          break
        }
        case "state.create": {
          const name = String(op.operands[0].value)
          const initial = this.evalRef(op.operands[1], env, fn)
          this.states.set(name, initial)
          // State variables behave like ordinary variables for reads/writes.
          env.set(name, initial)
          break
        }
        case "state.get": {
          const name = String(op.operands[0].value)
          this.setTemp(op, this.states.get(name) ?? null, env)
          break
        }
        case "state.set": {
          const name = String(op.operands[0].value)
          this.states.set(name, this.evalRef(op.operands[1], env, fn))
          break
        }
        case "db.create": {
          const entity = String(op.attrs?.entity ?? op.operands[0].value)
          if (!this.records.has(entity)) this.records.set(entity, [])
          this.records.get(entity)!.push({
            __pir_function: true,
            name: entity,
            params: [],
            functionIndex: 0,
            env: new Map(),
            __pir_record: entity,
          })
          break
        }
        case "db.query": {
          const entity = String(op.attrs?.entity ?? op.operands[0]?.value ?? "")
          this.setTemp(op, this.records.get(entity) ?? [], env)
          break
        }
        case "jump_if_false": {
          // Guard: execute the inline __body block only when cond is true.
          const cond = truthy(this.evalRef(op.operands[0], env, fn))
          const body = (op.attrs?.__body as IROperation[] | undefined) ?? []
          if (cond && body.length > 0) this.execBlock(body, env, fn)
          break
        }
        case "jump_if_true": {
          // Loop: iterate the inline __body block.
          const body = (op.attrs?.__body as IROperation[] | undefined) ?? []
          if (op.attrs?.forEach) {
            const varName = String(op.attrs.forEach)
            const iterable = this.evalRef(op.operands[0], env, fn)
            const items = typeof iterable === "string" ? iterable.split("") : Array.isArray(iterable) ? iterable : []
            // The body runs in the SAME environment so accumulator writes
            // persist (matches AST interpreter semantics). The loop variable
            // itself is scoped: its previous binding is restored afterwards.
            const hadPrev = env.has(varName)
            const prevValue = env.get(varName)
            for (const item of items) {
              env.set(varName, item)
              this.execBlock(body, env, fn)
            }
            if (hadPrev) env.set(varName, prevValue!)
            else env.delete(varName)
          } else if (op.attrs?.repeat) {
            const countV = this.evalRef(op.operands[0], env, fn)
            const n = typeof countV === "number" && Number.isInteger(countV) && countV >= 0 ? countV : 0
            for (let r = 0; r < n; r++) this.execBlock(body, env, fn)
          }
          break
        }
        case "jump":
          break
        default:
          // Unknown ops are ignored at runtime; the validator reports them.
          break
      }
    }
  }

  private indexInto(obj: PirValue, idx: PirValue, pos: Position): PirValue {
    if (typeof obj === "string" || Array.isArray(obj)) {
      if (typeof idx !== "number" || !Number.isInteger(idx)) {
        plainThrow(ERROR_CODES.TYPE_MISMATCH, "Positions must be whole numbers.", pos)
      }
      if (idx < 0 || idx >= obj.length) {
        plainThrow(
          ERROR_CODES.INDEX_OUT_OF_RANGE,
          `You tried to get position ${idx}, but there ${obj.length === 1 ? "is" : "are"} only ${obj.length}.`,
          pos,
        )
      }
      return obj[idx]
    }
    plainThrow(ERROR_CODES.TYPE_MISMATCH, "Only lists and text can be indexed.", pos)
  }

  private evalRef(ref: IROperation["operands"][number], env: Map<string, PirValue>, fn: IRFunction): PirValue {
    switch (ref.kind) {
      case "const":
        return ref.value ?? null
      case "var": {
        const name = ref.name!
        if (env.has(name)) return env.get(name)!
        if (this.globals.has(name)) return this.globals.get(name)!
        plainThrow(
          ERROR_CODES.UNDEFINED_VARIABLE,
          `You tried to use '${name}', but it doesn't exist yet.`,
          { line: 0, column: 0 },
        )
      }
      case "temp": {
        const name = ref.name!
        if (env.has(name)) return env.get(name)!
        // Temporaries are function-local; missing temps are internal errors.
        plainThrow(
          ERROR_CODES.INVALID_OPERATION,
          `Internal: temporary ${name} was not computed (in ${fn.name}).`,
          { line: 0, column: 0 },
        )
      }
    }
  }

  private setTemp(op: IROperation, value: PirValue, env: Map<string, PirValue>): void {
    if (op.result) env.set(op.result, value)
  }

  private posOf(op: IROperation): Position {
    return op.pos ?? { line: 0, column: 0 }
  }
}

// ----- helpers -----

function truthy(v: PirValue): boolean {
  if (v === null) return false
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

function deepEqual(a: PirValue, b: PirValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  return a === b
}

function compare(l: PirValue, r: PirValue, op: string, pos: Position): boolean {
  if (typeof l === "number" && typeof r === "number") {
    switch (op) {
      case "gt": return l > r
      case "lt": return l < r
      case "ge": return l >= r
      case "le": return l <= r
    }
  }
  if (typeof l === "string" && typeof r === "string") {
    switch (op) {
      case "gt": return l > r
      case "lt": return l < r
      case "ge": return l >= r
      case "le": return l <= r
    }
  }
  plainThrow(
    ERROR_CODES.TYPE_MISMATCH,
    `You tried to compare ${describe(l)} with ${describe(r)} using '${op}'.`,
    pos,
  )
}

function joinOrAdd(l: PirValue, r: PirValue, pos: Position): PirValue {
  if (typeof l === "number" && typeof r === "number") return l + r
  if (typeof l === "string" || typeof r === "string") return formatValue(l) + formatValue(r)
  if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r]
  plainThrow(
    ERROR_CODES.INVALID_OPERATION,
    `You tried to add ${describe(l)} and ${describe(r)}.`,
    pos,
  )
}

function describe(v: PirValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return "a number"
  if (typeof v === "string") return "text"
  if (typeof v === "boolean") return "true/false"
  if (Array.isArray(v)) return "a list"
  return "a value"
}

export function formatValue(v: PirValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) {
    return `[${v.map((x) => (typeof x === "string" ? `"${x}"` : formatValue(x))).join(", ")}]`
  }
  if ((v as PirClosure).__pir_function === true) return `<function ${(v as PirClosure).name}>`
  return String(v)
}

function defaultBuiltins(): Record<string, PirBuiltinImpl> {
  return {
    uppercase: (a) => (typeof a[0] === "string" ? a[0].toUpperCase() : null),
    lowercase: (a) => (typeof a[0] === "string" ? a[0].toLowerCase() : null),
    trim: (a) => (typeof a[0] === "string" ? a[0].trim() : null),
    split: (a) => (typeof a[0] === "string" && typeof a[1] === "string" && a[1] !== "" ? a[0].split(a[1]) : null),
    join: (a) => (Array.isArray(a[0]) ? a[0].map(formatValue).join(typeof a[1] === "string" ? a[1] : "") : null),
    contains: (a) =>
      typeof a[0] === "string"
        ? a[0].includes(String(a[1]))
        : Array.isArray(a[0])
          ? a[0].some((x) => deepEqual(x, a[1]))
          : false,
    replace: (a) => (typeof a[0] === "string" ? a[0].split(String(a[1])).join(String(a[2])) : null),
    abs: (a) => (typeof a[0] === "number" ? Math.abs(a[0]) : null),
    round: (a) => (typeof a[0] === "number" ? Math.round(a[0]) : null),
    floor: (a) => (typeof a[0] === "number" ? Math.floor(a[0]) : null),
    ceil: (a) => (typeof a[0] === "number" ? Math.ceil(a[0]) : null),
    min: (a) => (typeof a[0] === "number" && typeof a[1] === "number" ? Math.min(a[0], a[1]) : null),
    max: (a) => (typeof a[0] === "number" && typeof a[1] === "number" ? Math.max(a[0], a[1]) : null),
    number: (a) => {
      const v = a[0]
      if (typeof v === "number") return v
      if (typeof v === "string") {
        const n = Number(v)
        return v.trim() !== "" && !Number.isNaN(n) ? n : null
      }
      return null
    },
    text: (a) => formatValue(a[0]),
    push: (a) => {
      if (Array.isArray(a[0])) {
        a[0].push(a[1])
        return a[0]
      }
      return null
    },
    list: (a) => [...a],
    length: (a) => {
      const v = a[0]
      if (typeof v === "string") return v.length
      if (Array.isArray(v)) return v.length
      return null
    },
  }
}
