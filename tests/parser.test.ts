import { describe, expect, it } from "vitest"
import { tokenize } from "../src/lexer.js"
import { parse } from "../src/parser.js"
import { PlainError } from "../src/lexer.js"
import type { Program } from "../src/ast.js"

function parseSrc(src: string): Program {
  return parse(tokenize(src))
}

describe("parser", () => {
  it("parses say statement", () => {
    const ast = parseSrc('say "Hello"')
    expect(ast.body[0].kind).toBe("SayStmt")
  })

  it("parses set statement", () => {
    const ast = parseSrc('set name = "Plainly"')
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("SetStmt")
    if (stmt.kind === "SetStmt") {
      expect(stmt.name).toBe("name")
      expect(stmt.value.kind).toBe("StringLit")
    }
  })

  it("respects operator precedence (2 + 3 * 4)", () => {
    const ast = parseSrc("set t = 2 + 3 * 4")
    const stmt = ast.body[0]
    if (stmt.kind === "SetStmt" && stmt.value.kind === "BinaryExpr") {
      expect(stmt.value.operator).toBe("+")
      expect(stmt.value.right.kind).toBe("BinaryExpr")
    } else {
      throw new Error("unexpected AST shape")
    }
  })

  it("parses parenthesized expressions", () => {
    const ast = parseSrc("set t = (2 + 3) * 4")
    const stmt = ast.body[0]
    if (stmt.kind === "SetStmt" && stmt.value.kind === "BinaryExpr") {
      expect(stmt.value.operator).toBe("*")
      expect(stmt.value.left.kind).toBe("BinaryExpr")
    } else {
      throw new Error("unexpected AST shape")
    }
  })

  it("parses if/otherwise", () => {
    const ast = parseSrc('if age >= 18:\n  say "Adult"\notherwise:\n  say "Minor"')
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("IfStmt")
    if (stmt.kind === "IfStmt") {
      expect(stmt.then.body[0].kind).toBe("SayStmt")
      expect(stmt.otherwise).toBeDefined()
      expect(stmt.otherwise!.kind).toBe("Block")
    }
  })

  it("parses otherwise if chains", () => {
    const src = `if a:
  say 1
otherwise if b:
  say 2
otherwise:
  say 3`
    const ast = parseSrc(src)
    const stmt = ast.body[0]
    if (stmt.kind === "IfStmt") {
      expect(stmt.otherwise!.kind).toBe("IfStmt")
    } else {
      throw new Error("unexpected AST shape")
    }
  })

  it("parses for each loops", () => {
    const ast = parseSrc("for each user in users:\n  say user")
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("ForEachStmt")
  })

  it("parses repeat loops", () => {
    const ast = parseSrc('repeat 10 times:\n  say "Hello"')
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("RepeatStmt")
  })

  it("parses function declarations", () => {
    const ast = parseSrc("function add(a, b):\n  return a + b")
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("FunctionDecl")
    if (stmt.kind === "FunctionDecl") {
      expect(stmt.params).toEqual(["a", "b"])
    }
  })

  it("parses function calls", () => {
    const ast = parseSrc("say add(2, 3)")
    const stmt = ast.body[0]
    expect(stmt.kind).toBe("SayStmt")
    if (stmt.kind === "SayStmt") {
      expect(stmt.value.kind).toBe("CallExpr")
    }
  })

  it("parses list literals and indexing", () => {
    const ast = parseSrc("say numbers[0]")
    const stmt = ast.body[0]
    if (stmt.kind === "SayStmt" && stmt.value.kind === "IndexExpr") {
      expect(stmt.value.object.kind).toBe("Identifier")
    } else {
      throw new Error("unexpected AST shape")
    }
  })

  it("parses return without value", () => {
    const ast = parseSrc("function done():\n  return")
    expect(ast.body[0].kind).toBe("FunctionDecl")
  })

  it("throws on missing colon", () => {
    expect(() => parseSrc("if x\n  say 1")).toThrow(PlainError)
  })

  it("throws on missing block body", () => {
    expect(() => parseSrc("if x:")).toThrow(PlainError)
  })

  it("throws on unclosed paren", () => {
    expect(() => parseSrc("say add(1, 2")).toThrow(PlainError)
  })

  it("throws on assignment without set", () => {
    expect(() => parseSrc("x = 5")).toThrow(PlainError)
  })
})
