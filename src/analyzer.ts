/**
 * Plainly Semantic Analyzer (v0.2).
 *
 * Walks the AST *without running it* and collects every problem it can
 * find, as Diagnostic[] — so `plainly check` can report all issues at once
 * instead of stopping at the first error.
 *
 * Checks:
 *   - PL-002  using a name that was never set (with did-you-mean)
 *   - PL-011  calling a known function with the wrong number of values
 *   - PL-013  `return` outside a function
 *   - PL-014  a function with two parameters of the same name
 *   - PL-015  a variable that is set but never used (warning)
 *
 * The scope model matches the interpreter exactly:
 *   - `if` / `otherwise` / `repeat` bodies share the surrounding scope
 *   - `for each` creates a fresh scope holding the loop variable
 *   - functions create a scope with their parameters, closing over the
 *     scope where they were defined
 *   - `set` assigns to an existing name up the chain, or declares locally
 *   - a function is only visible *after* its declaration line
 */

import type { Expr, Program, Stmt } from "./ast.js"
import { ERROR_CODES, suggestName, type Diagnostic } from "./errors.js"
import { BUILTIN_NAMES } from "./words.js"

/** Number of values each builtin needs; null = accepts any amount (`list`). */
const BUILTIN_ARITY: Readonly<Record<string, number | null>> = {
  uppercase: 1, lowercase: 1, trim: 1, split: 2, join: 2, contains: 2, replace: 3,
  abs: 1, round: 1, floor: 1, ceil: 1, min: 2, max: 2,
  number: 1, text: 1, push: 2, list: null, length: 1,
}

interface Decl {
  name: string
  kind: "variable" | "function" | "param" | "loop-var"
  line: number
  used: boolean
}

class Scope {
  private names = new Map<string, Decl[]>()

  constructor(public parent: Scope | null = null) {}

  declare(decl: Decl): void {
    const list = this.names.get(decl.name) ?? []
    list.push(decl)
    this.names.set(decl.name, list)
  }

  /** The most recent visible declaration of `name`, walking outward. */
  find(name: string): Decl | null {
    let scope: Scope | null = this
    while (scope) {
      const list = scope.names.get(name)
      if (list && list.length > 0) return list[list.length - 1]
      scope = scope.parent
    }
    return null
  }

  visibleNames(): string[] {
    const names = new Set<string>()
    let scope: Scope | null = this
    while (scope) {
      for (const n of scope.names.keys()) names.add(n)
      scope = scope.parent
    }
    for (const b of BUILTIN_NAMES) names.add(b)
    return [...names]
  }

  allDeclarations(): Decl[] {
    const out: Decl[] = []
    let scope: Scope | null = this
    while (scope) {
      for (const list of scope.names.values()) out.push(...list)
      scope = scope.parent
    }
    return out
  }
}

interface FnInfo {
  params: number
}

export interface AnalysisResult {
  diagnostics: Diagnostic[]
}

export function analyze(program: Program): AnalysisResult {
  const diagnostics: Diagnostic[] = []
  const globalScope = new Scope()
  const functions = new Map<string, FnInfo>() // visible function arities
  const unusedCandidates: Decl[] = []

  const error = (
    code: string,
    message: string,
    pos: { line: number; column: number },
    hint?: string,
  ): void => {
    diagnostics.push({ code, severity: "error", message, hint, pos, length: 1 })
  }

  const warn = (
    code: string,
    message: string,
    pos: { line: number; column: number },
    hint?: string,
  ): void => {
    diagnostics.push({ code, severity: "warning", message, hint, pos, length: 1 })
  }

  function readName(name: string, pos: { line: number; column: number }, scope: Scope): void {
    const decl = scope.find(name)
    if (decl) {
      decl.used = true
      return
    }
    const isBuiltin = (BUILTIN_NAMES as readonly string[]).includes(name)
    if (!isBuiltin) {
      const suggestion = suggestName(name, scope.visibleNames())
      error(
        ERROR_CODES.UNDEFINED_VARIABLE,
        `You tried to use '${name}', but it doesn't exist yet.`,
        pos,
        suggestion
          ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...`
          : `Create it first with: set ${name} = ...`,
      )
    }
  }

  function checkCallArity(
    name: string,
    argCount: number,
    pos: { line: number; column: number },
  ): void {
    const fn = functions.get(name)
    if (fn) {
      if (argCount !== fn.params) {
        error(
          ERROR_CODES.WRONG_ARG_COUNT,
          `The function '${name}' needs ${fn.params} value(s), but you gave ${argCount}.`,
          pos,
          `Write it as ${name}(${Array.from({ length: fn.params }, (_, i) => `value${i + 1}`).join(", ")}) — or check the function's parameters.`,
        )
      }
      return
    }
    if ((BUILTIN_NAMES as readonly string[]).includes(name)) {
      const arity = BUILTIN_ARITY[name]
      if (arity !== null && arity !== undefined && argCount !== arity) {
        error(
          ERROR_CODES.WRONG_ARG_COUNT,
          `The function '${name}' needs ${arity} value(s), but you gave ${argCount}.`,
          pos,
          `Correct shape: ${name}(${(BUILTIN_ARITY[name] ?? 0) >= 0 && arity !== null ? hintParams(name, arity) : "..."}) — see 'plainly explain ${name}'.`,
        )
      }
    }
  }

  function hintParams(name: string, arity: number): string {
    const shapes: Record<string, string> = {
      split: "text, separator", join: "list, separator", contains: "where, what",
      replace: "text, from, to", min: "a, b", max: "a, b", push: "list, value",
      uppercase: "text", lowercase: "text", trim: "text", abs: "n", round: "n",
      floor: "n", ceil: "n", number: "value", text: "value", length: "value",
    }
    return shapes[name] ?? Array.from({ length: arity }, (_, i) => `value${i + 1}`).join(", ")
  }

  /** Tracks app/page placement for the v0.3 application model. */
  interface AppContext {
    appName: string | null
    entities: Set<string>
    pages: Set<string>
    inPage: boolean
  }
  const context: AppContext = {
    appName: null,
    entities: new Set(),
    pages: new Set(),
    inPage: false,
  }
  /** entity name → field names, for form-field validation (v0.4). */
  const entityFieldMap = new Map<string, Set<string>>()
  // Programs without any app-model statements never enter placement checks —
  // this keeps existing plain programs fully backward compatible.
  // Placement is checked sequentially: `app` must come first, then
  // databases/pages may follow.

  function execStmt(stmt: Stmt, scope: Scope, inFunction: boolean): void {
    switch (stmt.kind) {
      case "SayStmt":
        walkExpr(stmt.value, scope, inFunction)
        return
      case "SetStmt": {
        // Note: RHS is evaluated first, so reads inside it must be checked
        // against the scope *before* this name is declared.
        walkExpr(stmt.value, scope, inFunction)
        const existing = scope.find(stmt.name)
        if (existing) {
          // re-assignment: keep the original declaration record
        } else {
          const decl: Decl = { name: stmt.name, kind: "variable", line: stmt.pos.line, used: false }
          scope.declare(decl)
          unusedCandidates.push(decl)
        }
        return
      }
      case "IfStmt":
        walkExpr(stmt.condition, scope, inFunction)
        for (const s of stmt.then.body) execStmt(s, scope, inFunction)
        if (stmt.otherwise) {
          if (stmt.otherwise.kind === "IfStmt") {
            execStmt(stmt.otherwise, scope, inFunction)
          } else {
            for (const s of stmt.otherwise.body) execStmt(s, scope, inFunction)
          }
        }
        return
      case "ForEachStmt": {
        walkExpr(stmt.iterable, scope, inFunction)
        const loopScope = new Scope(scope)
        const loopDecl: Decl = { name: stmt.varName, kind: "loop-var", line: stmt.pos.line, used: false }
        loopScope.declare(loopDecl)
        unusedCandidates.push(loopDecl)
        for (const s of stmt.body.body) execStmt(s, loopScope, inFunction)
        return
      }
      case "RepeatStmt":
        walkExpr(stmt.count, scope, inFunction)
        for (const s of stmt.body.body) execStmt(s, scope, inFunction)
        return
      case "FunctionDecl": {
        // Duplicate parameter check
        const seen = new Set<string>()
        for (const p of stmt.params) {
          if (seen.has(p)) {
            error(
              ERROR_CODES.DUPLICATE_PARAMETER,
              `The function '${stmt.name}' has two parameters both named '${p}'. Give each parameter a different name.`,
              stmt.pos,
              `For example: function ${stmt.name}(first${stmt.params.length > 1 ? ", second" : ""}):`,
            )
          }
          seen.add(p)
        }
        // Warn if a parameter shadows... nothing yet. Register the function.
        functions.set(stmt.name, { params: stmt.params.length })
        scope.declare({ name: stmt.name, kind: "function", line: stmt.pos.line, used: true })
        const fnScope = new Scope(scope)
        for (const p of stmt.params) fnScope.declare({ name: p, kind: "param", line: stmt.pos.line, used: false })
        for (const s of stmt.body.body) execStmt(s, fnScope, true)
        return
      }
      case "ReturnStmt":
        if (!inFunction) {
          error(
            ERROR_CODES.RETURN_OUTSIDE_FUNCTION,
            "'return' can only be used inside a function. Move it inside your function block.",
            stmt.pos,
          )
        }
        if (stmt.value) walkExpr(stmt.value, scope, inFunction)
        return
      case "ExprStmt":
        walkExpr(stmt.expr, scope, inFunction)
        return
      // ----- application model (v0.3) -----
      case "AppStmt": {
        if (context.appName !== null) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `The app is already named '${context.appName}'. There can be only one app declaration.`,
            stmt.pos,
          )
        }
        context.appName = stmt.name
        return
      }
      case "DatabaseStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The database '${stmt.name}' must come after an app declaration. Start your file with:  app "My App"`,
            stmt.pos,
          )
        }
        if (context.entities.has(stmt.name)) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `There are two databases named '${stmt.name}'. Give each one a different name.`,
            stmt.pos,
          )
        }
        context.entities.add(stmt.name)
        entityFieldMap.set(stmt.name, new Set(stmt.fields.map((f) => f.name)))
        return
      }
      case "PageStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The page '${stmt.name}' must come after an app declaration. Start your file with:  app "My App"`,
            stmt.pos,
          )
        }
        if (context.pages.has(stmt.name)) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `There are two pages named '${stmt.name}'. Page names must be unique.`,
            stmt.pos,
          )
        }
        context.pages.add(stmt.name)
        const wasInPage = context.inPage
        context.inPage = true
        for (const s of stmt.body.body) execStmt(s, scope, inFunction)
        context.inPage = wasInPage
        return
      }
      case "TitleStmt":
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            "'title' can only be used inside a page.",
            stmt.pos,
            "Move this line inside a page block:  page \"Home\":\n  title \"…\"",
          )
        }
        return
      case "ButtonStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The button '${stmt.label}' must be inside a page. Buttons live inside page blocks.`,
            stmt.pos,
          )
        }
        for (const s of stmt.body.body) execStmt(s, scope, inFunction)
        return
      }
      case "ShowStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            "'show' can only be used inside a page.",
            stmt.pos,
          )
        }
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.UNKNOWN_ENTITY,
            `You tried to show '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0
              ? `Databases in this app: ${[...context.entities].join(", ")}.`
              : `Declare it first:  database ${stmt.entity}:\n  name: text`,
          )
        }
        return
      }
      case "FormStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The form '${stmt.label}' must be inside an app. Start your file with:  app "My App"`,
            stmt.pos,
          )
        }
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.FORM_WITHOUT_ENTITY,
            `The form '${stmt.label}' fills '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0
              ? `Databases in this app: ${[...context.entities].join(", ")}.`
              : `Declare it first:\n  database ${stmt.entity}:\n    name: text`,
          )
        }
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The form '${stmt.label}' must be inside a page. Move it into a page block.`,
            stmt.pos,
          )
        }
        const entityFields = entityFieldMap.get(stmt.entity)
        for (const f of stmt.fields) {
          if (entityFields && !entityFields.has(f.name)) {
            error(
              ERROR_CODES.UNKNOWN_FORM_FIELD,
              `The form field '${f.name}' does not exist in the database '${stmt.entity}'.`,
              stmt.pos,
              entityFields.size > 0
                ? `Fields in ${stmt.entity}: ${[...entityFields].join(", ")}.`
                : `Add it to the database first:  database ${stmt.entity}:\n    ${f.name}: ${f.type}`,
            )
          }
        }
        return
      }
      case "CreateStmt": {
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.UNKNOWN_ENTITY,
            `You tried to create a '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0
              ? `Databases in this app: ${[...context.entities].join(", ")}.`
              : `Declare it first:  database ${stmt.entity}:\n  name: text`,
          )
        }
        return
      }
      case "StateStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `'state' can only be used inside a page. Move 'state ${stmt.name} = …' into a page block.`,
            stmt.pos,
          )
        }
        walkExpr(stmt.value, scope, inFunction)
        // State variables behave like declared variables from here on:
        // button handlers inside this page read/write them.
        if (!scope.find(stmt.name)) {
          const decl: Decl = { name: stmt.name, kind: "variable", line: stmt.pos.line, used: false }
          scope.declare(decl)
          unusedCandidates.push(decl)
        }
        return
      }
    }
  }

  function walkExpr(expr: Expr, scope: Scope, inFunction: boolean): void {
    switch (expr.kind) {
      case "Identifier":
        readName(expr.name, expr.pos, scope)
        return
      case "NumberLit":
      case "StringLit":
      case "BoolLit":
        return
      case "ListLit":
        for (const e of expr.elements) walkExpr(e, scope, inFunction)
        return
      case "UnaryExpr":
        walkExpr(expr.operand, scope, inFunction)
        return
      case "BinaryExpr":
        walkExpr(expr.left, scope, inFunction)
        walkExpr(expr.right, scope, inFunction)
        return
      case "CallExpr": {
        if (expr.callee.kind === "Identifier") {
          readName(expr.callee.name, expr.callee.pos, scope)
          checkCallArity(expr.callee.name, expr.args.length, expr.pos)
        } else {
          walkExpr(expr.callee, scope, inFunction)
        }
        for (const a of expr.args) walkExpr(a, scope, inFunction)
        return
      }
      case "IndexExpr":
        walkExpr(expr.object, scope, inFunction)
        walkExpr(expr.index, scope, inFunction)
        return
      case "MemberExpr":
        walkExpr(expr.object, scope, inFunction)
        return
    }
  }

  for (const stmt of program.body) execStmt(stmt, globalScope, false)

  // ----- unused-variable warnings -----
  for (const decl of unusedCandidates) {
    if (decl.used) continue
    if (decl.kind === "loop-var") {
      warn(
        ERROR_CODES.UNUSED_VARIABLE,
        `The loop variable '${decl.name}' is never used inside the loop.`,
        { line: decl.line, column: 1 },
        `Either use '${decl.name}' inside the loop, or use 'repeat N times:' if you don't need the value.`,
      )
    } else {
      warn(
        ERROR_CODES.UNUSED_VARIABLE,
        `You set '${decl.name}' but never use it.`,
        { line: decl.line, column: 1 },
        `Remove this line, or use '${decl.name}' somewhere below.`,
      )
    }
  }

  // Sort so check output reads top-to-bottom.
  diagnostics.sort((a, b) => a.pos.line - b.pos.line || a.pos.column - b.pos.column)

  return { diagnostics }
}
