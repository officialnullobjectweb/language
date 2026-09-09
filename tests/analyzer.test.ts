import { describe, expect, it } from "vitest"
import { checkSource, ERROR_CODES } from "../src/index.js"
import type { Diagnostic } from "../src/index.js"

function diags(src: string): Diagnostic[] {
  return checkSource(src).diagnostics
}

function codes(src: string): string[] {
  return diags(src).map((d) => d.code)
}

describe("analyzer", () => {
  it("clean program reports nothing", () => {
    const src = `set name = "Plainly"
say name`
    expect(diags(src)).toEqual([])
  })

  it("detects undefined variables with suggestions", () => {
    const src = `set age = 23
say agge`
    const d = diags(src).filter((x) => x.code === ERROR_CODES.UNDEFINED_VARIABLE)
    expect(d.length).toBe(1)
    expect(d[0].severity).toBe("error")
    expect(d[0].hint).toContain("'age'")
  })

  it("allows builtins without declaration", () => {
    expect(diags('say uppercase("hi")')).toEqual([])
  })

  it("detects wrong arity for user functions", () => {
    const src = `function add(a, b):
  return a + b
say add(1)`
    const d = diags(src)
    expect(d.length).toBe(1)
    expect(d[0].code).toBe(ERROR_CODES.WRONG_ARG_COUNT)
  })

  it("detects wrong arity for builtins", () => {
    expect(codes("say split(\"a\")")).toContain(ERROR_CODES.WRONG_ARG_COUNT)
    expect(codes("say length()")).toContain(ERROR_CODES.WRONG_ARG_COUNT)
  })

  it("list() accepts any number of values", () => {
    expect(diags("say list()")).toEqual([])
    expect(diags("say list(1, 2, 3)")).toEqual([])
  })

  it("detects return outside a function", () => {
    const d = diags("return 1")
    expect(d.length).toBe(1)
    expect(d[0].code).toBe(ERROR_CODES.RETURN_OUTSIDE_FUNCTION)
  })

  it("allows return inside a function", () => {
    const src = `function f():
  return 1
say f()`
    expect(diags(src)).toEqual([])
  })

  it("detects duplicate parameters", () => {
    const src = `function f(a, a):
  return a
say f(1, 2)`
    const d = diags(src)
    expect(d.length).toBe(1)
    expect(d[0].code).toBe(ERROR_CODES.DUPLICATE_PARAMETER)
  })

  it("warns on unused variables", () => {
    const src = `set name = "Plainly"
say "hello"`
    const d = diags(src)
    expect(d.length).toBe(1)
    expect(d[0].code).toBe(ERROR_CODES.UNUSED_VARIABLE)
    expect(d[0].severity).toBe("warning")
  })

  it("warns on unused loop variables", () => {
    const src = `repeat 3 times:
  say "hi"
for each item in [1, 2]:
  say "looping"`
    const d = diags(src)
    const warnings = d.filter((x) => x.code === ERROR_CODES.UNUSED_VARIABLE)
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toContain("'item'")
  })

  it("checks reads before declaration (use-before-set)", () => {
    const d = diags("say total\nset total = 5")
    expect(d.some((x) => x.code === ERROR_CODES.UNDEFINED_VARIABLE)).toBe(true)
  })

  it("set re-assignment keeps the original declaration", () => {
    const src = `set count = 0
set count = count + 1
say count`
    expect(diags(src)).toEqual([])
  })

  it("reports multiple problems at once, sorted by line", () => {
    const src = `say alpha
say beta
return 1`
    const d = diags(src)
    expect(d.length).toBe(3)
    expect(d[0].pos.line).toBe(1)
    expect(d[1].pos.line).toBe(2)
    expect(d[2].pos.line).toBe(3)
  })

  it("functions are visible only after their declaration line", () => {
    const src = `say helper(1)
function helper(n):
  return n`
    const d = diags(src)
    expect(d.some((x) => x.code === ERROR_CODES.UNDEFINED_VARIABLE)).toBe(true)
  })

  it("loop variable is visible inside the loop only", () => {
    expect(diags("for each x in [1, 2]:\n  say x")).toEqual([])
    const d = diags("for each x in [1, 2]:\n  say x\nsay x")
    expect(d.some((x) => x.code === ERROR_CODES.UNDEFINED_VARIABLE)).toBe(true)
  })

  it("checkSource.ok is false only when there are errors", () => {
    expect(checkSource('say "hi"').ok).toBe(true)
    expect(checkSource("set x = 1\nsay \"hi\"").ok).toBe(true) // warning only
    expect(checkSource("say missing").ok).toBe(false)
  })
})
