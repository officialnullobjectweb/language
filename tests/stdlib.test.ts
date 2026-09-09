import { describe, expect, it } from "vitest"
import { runSource, PlainError, ERROR_CODES } from "../src/index.js"

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

describe("stdlib", () => {
  // ----- text -----
  it("uppercase and lowercase", () => {
    expect(run('say uppercase("hello")')).toEqual(["HELLO"])
    expect(run('say lowercase("WORLD")')).toEqual(["world"])
  })

  it("trim removes surrounding spaces", () => {
    expect(run('say trim("  hi  ")')).toEqual(["hi"])
  })

  it("split makes a list, join glues it back", () => {
    expect(run('say split("a,b,c", ",")')).toEqual(['["a", "b", "c"]'])
    expect(run('say join(split("a,b,c", ","), "-")')).toEqual(["a-b-c"])
  })

  it("contains works on text and lists", () => {
    expect(run('say contains("hello", "ell")')).toEqual(["true"])
    expect(run('say contains("hello", "xyz")')).toEqual(["false"])
    expect(run("say contains([1, 2, 3], 2)")).toEqual(["true"])
    expect(run('say contains(["a", "b"], "b")')).toEqual(["true"])
  })

  it("replace swaps text", () => {
    expect(run('say replace("aaa", "a", "b")')).toEqual(["bbb"])
  })

  // ----- numbers -----
  it("abs, round, floor, ceil", () => {
    expect(run("say abs(-5)")).toEqual(["5"])
    expect(run("say round(2.6)")).toEqual(["3"])
    expect(run("say floor(2.9)")).toEqual(["2"])
    expect(run("say ceil(2.1)")).toEqual(["3"])
  })

  it("min and max", () => {
    expect(run("say min(3, 7)")).toEqual(["3"])
    expect(run("say max(3, 7)")).toEqual(["7"])
  })

  // ----- conversion -----
  it("number converts numeric text", () => {
    expect(run('say number("42")')).toEqual(["42"])
    expect(run('say number("3.14")')).toEqual(["3.14"])
    expect(run('say number("42") + 1')).toEqual(["43"])
  })

  it("number refuses non-numeric text with a friendly error", () => {
    const err = runError('say number("abc")')
    expect(err.code).toBe(ERROR_CODES.TYPE_MISMATCH)
    expect(err.message).toContain("couldn't turn")
  })

  it("text converts anything", () => {
    expect(run("say text(42) + \"!\"")).toEqual(["42!"])
    expect(run("say text([1, 2])")).toEqual(["[1, 2]"])
    expect(run("say text(true)")).toEqual(["true"])
  })

  // ----- lists -----
  it("push adds to a list", () => {
    const out = run("set xs = [1, 2]\npush(xs, 3)\nsay xs")
    expect(out).toEqual(["[1, 2, 3]"])
  })

  it("list() builds a list", () => {
    expect(run("say list(1, \"a\", true)")).toEqual(['[1, "a", true]'])
  })

  it("length counts text and lists", () => {
    expect(run('say length("hello")')).toEqual(["5"])
    expect(run("say length([1, 2, 3])")).toEqual(["3"])
  })

  it("errors on length of a number", () => {
    const err = runError("say length(5)")
    expect(err.code).toBe(ERROR_CODES.TYPE_MISMATCH)
  })

  it("errors on wrong arg count for builtins", () => {
    const err = runError("say uppercase()")
    expect(err.code).toBe(ERROR_CODES.WRONG_ARG_COUNT)
  })
})

describe("did-you-mean suggestions", () => {
  it("suggests a close name for a typo", () => {
    const err = runError("set name = \"Plainly\"\nsay nane")
    expect(err.code).toBe(ERROR_CODES.UNDEFINED_VARIABLE)
    expect(err.hint).toContain("'name'")
  })

  it("suggests a builtin for a typo", () => {
    const err = runError("say lengt(\"hi\")")
    expect(err.hint).toContain("'length'")
  })

  it("no suggestion for a wildly different name", () => {
    const err = runError("say zzzzz")
    expect(err.hint).not.toContain("Did you mean")
    expect(err.hint).toContain("set zzzzz = ...")
  })
})

describe("runtime error codes", () => {
  it("divide by zero carries PL-008", () => {
    expect(runError("say 1 / 0").code).toBe(ERROR_CODES.DIVIDE_BY_ZERO)
  })

  it("index out of range carries PL-012", () => {
    expect(runError("say [1, 2][5]").code).toBe(ERROR_CODES.INDEX_OUT_OF_RANGE)
  })

  it("calling a non-function carries PL-010", () => {
    expect(runError("set x = 5\nsay x()").code).toBe(ERROR_CODES.NOT_A_FUNCTION)
  })

  it("wrong arg count for user functions carries PL-011", () => {
    expect(runError("function f(a):\n  return a\nsay f(1, 2)").code).toBe(ERROR_CODES.WRONG_ARG_COUNT)
  })
})
