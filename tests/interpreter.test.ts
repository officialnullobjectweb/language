import { describe, expect, it } from "vitest"
import { runSource, PlainError } from "../src/index.js"

function run(src: string): string[] {
  const output: string[] = []
  runSource(src, (s) => output.push(s))
  return output
}

function runError(src: string): PlainError {
  try {
    run(src)
  } catch (err) {
    if (err instanceof PlainError) return err
    throw err
  }
  throw new Error("expected PlainError but program ran successfully")
}

describe("interpreter", () => {
  it("runs hello world", () => {
    expect(run('say "Hello World"')).toEqual(["Hello World"])
  })

  it("runs variables and prints them", () => {
    const out = run('set name = "Plainly"\nset age = 23\nsay name\nsay age')
    expect(out).toEqual(["Plainly", "23"])
  })

  it("evaluates arithmetic with correct precedence", () => {
    expect(run("say 2 + 3 * 4")).toEqual(["14"])
    expect(run("say (2 + 3) * 4")).toEqual(["20"])
    expect(run("say 10 / 4")).toEqual(["2.5"])
    expect(run("say 10 % 3")).toEqual(["1"])
  })

  it("joins text with +", () => {
    expect(run('say "Hello " + "World"')).toEqual(["Hello World"])
  })

  it("concatenates numbers into text", () => {
    expect(run('set age = 23\nsay "Age: " + age')).toEqual(["Age: 23"])
  })

  it("runs if/otherwise", () => {
    expect(run('if 1 > 2:\n  say "yes"\notherwise:\n  say "no"')).toEqual(["no"])
    expect(run('if 2 > 1:\n  say "yes"\notherwise:\n  say "no"')).toEqual(["yes"])
  })

  it("runs otherwise-if chains", () => {
    const src = `set score = 85
if score >= 90:
  say "A"
otherwise if score >= 80:
  say "B"
otherwise:
  say "F"`
    expect(run(src)).toEqual(["B"])
  })

  it("runs for each over lists", () => {
    expect(run("for each x in [1, 2, 3]:\n  say x")).toEqual(["1", "2", "3"])
  })

  it("runs for each over text", () => {
    expect(run('for each c in "ab":\n  say c')).toEqual(["a", "b"])
  })

  it("runs repeat", () => {
    expect(run('repeat 3 times:\n  say "hi"')).toEqual(["hi", "hi", "hi"])
  })

  it("calls functions and returns values", () => {
    const src = `function add(a, b):
  return a + b
say add(2, 3)`
    expect(run(src)).toEqual(["5"])
  })

  it("supports recursion", () => {
    const src = `function fact(n):
  if n <= 1:
    return 1
  return n * fact(n - 1)
say fact(5)`
    expect(run(src)).toEqual(["120"])
  })

  it("indexes lists and text", () => {
    expect(run("set xs = [10, 20]\nsay xs[1]")).toEqual(["20"])
    expect(run('say "abc"[0]')).toEqual(["a"])
  })

  it("compares values", () => {
    expect(run("say 3 == 3")).toEqual(["true"])
    expect(run("say 3 != 4")).toEqual(["true"])
    expect(run('say "a" < "b"')).toEqual(["true"])
  })

  it("supports and/or/not with short-circuit", () => {
    expect(run("say true and false")).toEqual(["false"])
    expect(run("say true or false")).toEqual(["true"])
    expect(run("say not false")).toEqual(["true"])
  })

  it("uses builtins length/uppercase/lowercase", () => {
    expect(run('say length("hello")')).toEqual(["5"])
    expect(run("say length([1, 2, 3])")).toEqual(["3"])
    expect(run('say uppercase("abc")')).toEqual(["ABC"])
    expect(run('say lowercase("ABC")')).toEqual(["abc"])
  })

  it("formats lists when printed", () => {
    expect(run("say [1, \"a\", true]")).toEqual(['[1, "a", true]'])
  })

  it("nested blocks close correctly", () => {
    const src = `set xs = [1, 2, 3]
set total = 0
for each x in xs:
  if x > 1:
    set total = total + x
say total`
    expect(run(src)).toEqual(["5"])
  })

  // ----- error cases -----

  it("errors on undefined variable", () => {
    const err = runError("say name")
    expect(err.message).toContain("'name'")
    expect(err.line).toBe(1)
  })

  it("errors on divide by zero", () => {
    const err = runError("say 1 / 0")
    expect(err.message).toContain("divide by zero")
  })

  it("errors on repeat with non-integer", () => {
    const err = runError("repeat 2.5 times:\n  say 1")
    expect(err.message).toContain("whole number")
  })

  it("errors on return outside function", () => {
    const err = runError("return 1")
    expect(err.message).toContain("inside a function")
  })

  it("errors on wrong argument count", () => {
    const err = runError("function add(a, b):\n  return a + b\nsay add(1)")
    expect(err.message).toContain("needs 2 value(s)")
  })

  it("errors on indexing out of range", () => {
    const err = runError("say [1, 2][5]")
    expect(err.message).toContain("position 5")
  })

  it("errors on calling a non-function", () => {
    const err = runError("set x = 5\nsay x()")
    expect(err.message).toContain("isn't a function")
  })

  it("errors on looping over a number", () => {
    const err = runError("for each x in 5:\n  say x")
    expect(err.message).toContain("list or text")
  })
})
