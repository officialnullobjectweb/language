import { describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { runSource } from "../src/index.js"

const examplesDir = path.resolve(__dirname, "../examples")

function runExample(name: string): string[] {
  const source = fs.readFileSync(path.join(examplesDir, name), "utf-8")
  const output: string[] = []
  runSource(source, (s) => output.push(s))
  return output
}

describe("examples", () => {
  it("hello.pl prints Hello World", () => {
    expect(runExample("hello.pl")).toEqual(["Hello World"])
  })

  it("variables.pl prints variables", () => {
    expect(runExample("variables.pl")).toEqual(["Plainly", "23", "Hello Plainly"])
  })

  it("expressions.pl computes correctly", () => {
    expect(runExample("expressions.pl")).toEqual(["500", "105", "95", "20", "1"])
  })

  it("conditions.pl picks correct branches", () => {
    expect(runExample("conditions.pl")).toEqual(["Adult", "Grade: B"])
  })

  it("loops.pl iterates lists and text", () => {
    expect(runExample("loops.pl")).toEqual([
      "Hello Aisha", "Hello Ben", "Hello Carlos",
      "Loop!", "Loop!", "Loop!",
      "a", "b", "c",
      "3",
    ])
  })

  it("functions.pl calls functions and indexes", () => {
    expect(runExample("functions.pl")).toEqual(["5", "Hello, Plainly!", "1", "3"])
  })

  it("showcase.pl combines everything", () => {
    expect(runExample("showcase.pl")).toEqual(["Hello Plainly, you are an adult.", "[2, 4, 6, 8]"])
  })
})
