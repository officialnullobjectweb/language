import { describe, expect, it } from "vitest"
import { tokenize, PlainError } from "../src/lexer.js"

describe("tokenize", () => {
  it("tokenizes say with a string", () => {
    const tokens = tokenize('say "Hello"')
    expect(tokens.map((t) => t.type)).toEqual(["KEYWORD", "STRING", "EOF"])
    expect(tokens[1].value).toBe("Hello")
  })

  it("tokenizes numbers including decimals", () => {
    const tokens = tokenize("set x = 3.14")
    expect(tokens.map((t) => t.type)).toEqual(["KEYWORD", "IDENT", "OPERATOR", "NUMBER", "EOF"])
    expect(tokens[3].value).toBe("3.14")
  })

  it("tokenizes operators including two-char ones", () => {
    const tokens = tokenize("a >= b")
    expect(tokens.map((t) => t.type)).toEqual(["IDENT", "OPERATOR", "IDENT", "EOF"])
    expect(tokens[1].value).toBe(">=")
  })

  it("emits INDENT and DEDENT for blocks", () => {
    const src = `if x:
  say 1
say 2`
    const tokens = tokenize(src)
    const types = tokens.map((t) => t.type)
    expect(types).toContain("INDENT")
    expect(types).toContain("DEDENT")
    // DEDENT appears before the final `say 2` line
    const dedentIdx = types.indexOf("DEDENT")
    const say2Idx = tokens.findIndex((t, i) => i > dedentIdx && t.value === "2")
    expect(say2Idx).toBeGreaterThan(dedentIdx)
  })

  it("emits multiple DEDENTs for nested blocks", () => {
    const src = `if a:
  if b:
    say 1
say 2`
    const tokens = tokenize(src)
    const dedents = tokens.filter((t) => t.type === "DEDENT")
    // one dedent for inner block close, one for outer
    expect(dedents.length).toBeGreaterThanOrEqual(2)
  })

  it("ignores comments", () => {
    const tokens = tokenize("# this is a comment\nsay 1  # trailing")
    expect(tokens.map((t) => t.type)).toEqual(["KEYWORD", "NUMBER", "EOF"])
  })

  it("ignores blank lines", () => {
    const tokens = tokenize("say 1\n\n\nsay 2")
    expect(tokens.map((t) => t.type)).toEqual(["KEYWORD", "NUMBER", "NEWLINE", "KEYWORD", "NUMBER", "EOF"])
  })

  it("tracks line and column positions", () => {
    const tokens = tokenize('say "hi"')
    expect(tokens[0].pos).toEqual({ line: 1, column: 1 })
    expect(tokens[1].pos).toEqual({ line: 1, column: 5 })
  })

  it("handles string escapes", () => {
    const tokens = tokenize('say "a\\n\\t\\"b"')
    expect(tokens[1].value).toBe("a\n\t\"b")
  })

  it("throws on unterminated string", () => {
    expect(() => tokenize('say "oops')).toThrow(PlainError)
  })

  it("throws on unknown character", () => {
    expect(() => tokenize("say @")).toThrow(PlainError)
  })

  it("throws on odd indentation", () => {
    expect(() => tokenize("if x:\n   say 1")).toThrow(PlainError)
  })

  it("tokenizes list literals", () => {
    const tokens = tokenize("set xs = [1, 2, 3]")
    expect(tokens.map((t) => t.type)).toEqual([
      "KEYWORD", "IDENT", "OPERATOR", "LBRACKET", "NUMBER", "COMMA", "NUMBER", "COMMA", "NUMBER", "RBRACKET", "EOF",
    ])
  })
})
