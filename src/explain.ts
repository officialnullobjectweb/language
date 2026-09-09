/**
 * `plainly explain` (v0.3) — answer "what does this program mean?" in plain
 * human sentences, one step per statement. Aligned with the beginner-first
 * philosophy: the compiler teaches while it compiles.
 */

import { compileToAst, PlainError } from "./index.js"
import type { Expr, Program, Stmt } from "./ast.js"

export interface ExplainStep {
  /** One human sentence describing what this statement does. */
  text: string
  /** Source line the step came from (1-based). */
  line: number
}

export interface ExplainResult {
  steps: ExplainStep[]
}

function exprText(e: Expr): string {
  switch (e.kind) {
    case "NumberLit":
      return String(e.value)
    case "StringLit":
      return e.value
    case "BoolLit":
      return e.value ? "true" : "false"
    case "Identifier":
      return e.name
    case "ListLit":
      return `a list (${e.elements.map(exprText).join(", ")})`
    case "IndexExpr":
      return `${exprText(e.object)}, item ${exprText(e.index)}`
    case "MemberExpr":
      return `${exprText(e.object)}.${e.property}`
    case "BinaryExpr":
      return `${exprText(e.left)} ${operatorWord(e.operator)} ${exprText(e.right)}`
    case "UnaryExpr":
      return e.operator === "not" ? `not ${exprText(e.operand)}` : `the opposite of ${exprText(e.operand)}`
    case "CallExpr": {
      const name = e.callee.kind === "Identifier" ? e.callee.name : "a skill"
      return `${name}(${e.args.map(exprText).join(", ")})`
    }
  }
}

function operatorWord(op: string): string {
  const words: Record<string, string> = {
    "+": "+",
    "-": "−",
    "*": "×",
    "/": "÷",
    "%": "remainder of",
    "==": "compared with",
    "!=": "compared (not equal) with",
    ">": "compared (greater) with",
    "<": "compared (less) with",
    ">=": "compared (greater or equal) with",
    "<=": "compared (less or equal) with",
    "and": "and",
    "or": "or",
  }
  return words[op] ?? op
}

export function explainProgram(source: string): ExplainResult {
  const ast = compileToAst(source)
  const steps: ExplainStep[] = []
  for (const stmt of ast.body) explainStmt(stmt, steps, 0)
  return { steps }
}

function explainStmt(stmt: Stmt, steps: ExplainStep[], depth: number): void {
  const pad = "  ".repeat(depth)
  const line = stmt.pos.line
  switch (stmt.kind) {
    case "SayStmt":
      steps.push({ text: `${pad}Show ${describe(exprText(stmt.value))}.`, line })
      return
    case "SetStmt":
      steps.push({ text: `${pad}Make a box named '${stmt.name}' holding ${describe(exprText(stmt.value))}.`, line })
      return
    case "IfStmt":
      steps.push({ text: `${pad}Decide: if ${describe(exprText(stmt.condition))} is true, do the next block.`, line })
      for (const s of stmt.then.body) explainStmt(s, steps, depth + 1)
      if (stmt.otherwise) {
        steps.push({ text: `${pad}Otherwise:`, line })
        if (stmt.otherwise.kind === "IfStmt") {
          explainStmt(stmt.otherwise, steps, depth)
        } else {
          for (const s of stmt.otherwise.body) explainStmt(s, steps, depth + 1)
        }
      }
      return
    case "ForEachStmt":
      steps.push({ text: `${pad}Walk through ${describe(exprText(stmt.iterable))} one item at a time, calling each item '${stmt.varName}'.`, line })
      for (const s of stmt.body.body) explainStmt(s, steps, depth + 1)
      return
    case "RepeatStmt":
      steps.push({ text: `${pad}Repeat ${describe(exprText(stmt.count))} times:`, line })
      for (const s of stmt.body.body) explainStmt(s, steps, depth + 1)
      return
    case "FunctionDecl":
      steps.push({ text: `${pad}Teach Plainly a new skill called '${stmt.name}' (it needs ${stmt.params.length} value${stmt.params.length === 1 ? "" : "s"}: ${stmt.params.join(", ")}).`, line })
      for (const s of stmt.body.body) explainStmt(s, steps, depth + 1)
      return
    case "ReturnStmt":
      steps.push({ text: `${pad}Hand back ${stmt.value ? describe(exprText(stmt.value)) : "nothing"} and stop the function here.`, line })
      return
    case "ExprStmt":
      steps.push({ text: `${pad}Run ${describe(exprText(stmt.expr))}.`, line })
      return
    // ----- application model -----
    case "AppStmt":
      steps.push({ text: `${pad}Declare an application called '${stmt.name}'.`, line })
      return
    case "DatabaseStmt":
      steps.push({
        text: `${pad}Create a database entity '${stmt.name}' with fields ${stmt.fields.map((f) => `${f.name} (${f.type})`).join(", ")}.`,
        line,
      })
      return
    case "PageStmt":
      steps.push({ text: `${pad}Build a page named '${stmt.name}':`, line })
      for (const s of stmt.body.body) explainStmt(s, steps, depth + 1)
      return
    case "TitleStmt":
      steps.push({ text: `${pad}Set the page title to "${stmt.value}".`, line })
      return
    case "ButtonStmt":
      steps.push({ text: `${pad}Show a button labelled "${stmt.label}". When it is clicked:`, line })
      for (const s of stmt.body.body) explainStmt(s, steps, depth + 1)
      return
    case "ShowStmt":
      steps.push({ text: `${pad}Display the '${stmt.entity}' records on this page.`, line })
      return
    case "StateStmt":
      steps.push({ text: `${pad}Remember a piece of state '${stmt.name}' starting at ${describe(exprText(stmt.value))}.`, line })
      return
    case "CreateStmt":
      steps.push({ text: `${pad}Create a new '${stmt.entity}' record when this runs.`, line })
      return
  }
}

function describe(text: string): string {
  return text
}

export function explainSteps(source: string): string[] {
  return explainProgram(source).steps.map((s) => s.text)
}

export { PlainError }
