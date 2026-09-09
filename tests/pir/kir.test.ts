import { describe, expect, it } from "vitest"
import {
  compileToPir,
  runSource,
  runSourceThroughPir,
  optimizeSource,
  validateSource,
  printModule,
  moduleToStableJSON,
  validateModule,
  runPasses,
  runPir,
  constantFolding,
  constantPropagation,
  deadCodeElimination,
} from "../../src/index.js"

function ops(src: string) {
  const mod = compileToPir(src)
  return mod.functions[0].blocks[0].ops
}

describe("3A.3 lowering", () => {
  it("lowers set/say to const/store/load/print", () => {
    const o = ops("set price = 100\nsay price")
    expect(o.map((x) => x.op)).toEqual(["const", "store", "load", "print", "return"])
  })

  it("lowers arithmetic to SSA temps", () => {
    const o = ops("set total = 2 + 3 * 4")
    // const 2, const 3, const 4, mul, add, store
    expect(o.filter((x) => x.op === "mul" || x.op === "add").map((x) => x.op)).toEqual(["mul", "add"])
  })

  it("guards carry inline bodies", () => {
    const o = ops("if true:\n    say \"x\"")
    const guard = o.find((x) => x.op === "jump_if_false")
    expect(guard).toBeDefined()
    expect(guard!.attrs?.__body).toBeDefined()
  })

  it("else guard uses a negated condition", () => {
    const o = ops("if 1 > 2:\n    say \"a\"\notherwise:\n    say \"b\"")
    const guards = o.filter((x) => x.op === "jump_if_false")
    expect(guards.length).toBe(2)
    // The second guard's operand must be the result of a `not` on the first condition
    const nots = o.filter((x) => x.op === "not")
    expect(nots.length).toBe(1)
  })

  it("app model lowers to ui/db dialect ops", () => {
    const o = ops(
      'app "Todo"\n\ndatabase Todo:\n    title: text\n    completed: boolean\n\npage "Home":\n    title "My Todos"\n    show Todo\n    button "Add Todo":\n        create Todo',
    )
    expect(o.map((x) => x.op)).toEqual([
      "app.create",
      "db.entity",
      "ui.page",
      "ui.title",
      "ui.show",
      "ui.button",
      "event.click",
      "return",
    ])
  })

  it("state lowers to state.create/state.get/state.set", () => {
    const mod = compileToPir('app "C"\n\npage "Home":\n    state count = 0\n    button "Up":\n        set count = count + 1')
    const all = mod.functions[0].blocks.flatMap((b) => b.ops)
    expect(all.some((x) => x.op === "state.create")).toBe(true)
    // inside the click handler body
    const click = all.find((x) => x.op === "event.click")
    const body = click!.attrs?.__body as { op: string }[]
    expect(body.some((x) => x.op === "state.get")).toBe(true)
    expect(body.some((x) => x.op === "state.set")).toBe(true)
  })
})

describe("3A.4 printer", () => {
  it("prints human-readable PIR", () => {
    const text = printModule(compileToPir("set x = 1\nsay x"))
    expect(text).toContain("module main")
    expect(text).toContain("function main():")
    expect(text).toContain("entry:")
    expect(text).toContain("= const 1")
    expect(text).toContain("print %")
    expect(text).toContain("return")
  })

  it("prints app ops with dialect mnemonics", () => {
    const text = printModule(compileToPir('app "T"\ndatabase T:\n    name: text'))
    expect(text).toContain("app.create")
    expect(text).toContain("db.entity")
  })

  it("JSON round-trip is stable", () => {
    const mod = compileToPir("set x = 1 + 2")
    const a = moduleToStableJSON(mod)
    const b = moduleToStableJSON(compileToPir("set x = 1 + 2"))
    expect(a).toBe(b)
    const parsed = JSON.parse(a)
    expect(parsed.kind).toBe("IRModule")
    expect(parsed.version).toBe("0.3")
  })
})

describe("3A.5 validator", () => {
  it("accepts valid modules", () => {
    const { validation } = validateSource("set x = 1\nsay x")
    expect(validation.ok).toBe(true)
    expect(validation.diagnostics).toHaveLength(0)
  })

  it("rejects string * number with PIR001", () => {
    const mod = compileToPir('set x = "hello"\nsay x')
    // Corrupt the module the way a buggy pass would: force a mul over text.
    // A valid program lowering `"hello" * x` doesn't exist, so we inject a
    // mul op directly with a text left operand.
    const entry = mod.functions[0].blocks[0]
    entry.ops.splice(2, 0, {
      op: "mul",
      operands: [
        { kind: "const", value: "hello", type: "string" },
        { kind: "const", value: 5, type: "number" },
      ],
      result: "%90",
      pos: { line: 1, column: 1 },
    } as never)
    const result = validateModule(mod)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === "PIR001")).toBe(true)
  })

  it("rejects unknown op with PIR002", () => {
    const mod = compileToPir("say 1")
    const entry = mod.functions[0].blocks[0]
    entry.ops.splice(1, 0, { op: "frobnicate" as never, operands: [] } as never)
    const result = validateModule(mod)
    expect(result.diagnostics.some((d) => d.code === "PIR002")).toBe(true)
  })
})

describe("3A.6 PIR interpreter parity", () => {
  const programs = [
    'set price = 100\nset quantity = 5\nset total = price * quantity\nsay total',
    'set a = 3\nset b = 4\nif a < b:\n    say "smaller"\notherwise:\n    say "bigger"',
    'set n = 7\nif n > 10:\n    say "big"\notherwise if n > 5:\n    say "medium"\notherwise:\n    say "small"',
    'repeat 3 times:\n    say "hi"',
    'set items = [1, 2, 3]\nfor each x in items:\n    say x',
    'function add(a, b):\n    return a + b\nsay add(2, 3)',
    'function fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nsay fact(5)',
    'set x = 10\nset y = 3\nsay x / y\nsay x % y\nsay -x\nsay not (x > 5)',
    'set s = "Hello"\nsay uppercase(s)\nsay length(s)\nsay "a" + "b"',
    'set items = [10, 20, 30]\nsay items[1]\nsay min(10, 20)\nsay max(10, 20)',
    'say 1 == 1\nsay 2 != 3\nsay true and false\nsay true or false',
  ]

  for (const prog of programs) {
    it(`AST and PIR agree for: ${prog.split("\n")[0].slice(0, 40)}…`, () => {
      const astOut: string[] = []
      runSource(prog, (s) => astOut.push(s))
      const pirOut: string[] = []
      runSourceThroughPir(prog, (s) => pirOut.push(s))
      expect(pirOut).toEqual(astOut)
    })
  }

  it("loop accumulator writes persist (Phase 1 semantics)", () => {
    const prog = 'set doubled = []\nset numbers = [1, 2, 3]\nfor each n in numbers:\n    set doubled = doubled + [n * 2]\nsay doubled'
    const astOut: string[] = []
    runSource(prog, (s) => astOut.push(s))
    const pirOut: string[] = []
    runSourceThroughPir(prog, (s) => pirOut.push(s))
    expect(pirOut).toEqual(astOut)
    expect(astOut).toEqual(["[2, 4, 6]"])
  })

  it("state reads/writes use the state dialect", () => {
    const prog = 'app "C"\n\npage "Home":\n    state count = 0\n    button "Up":\n        set count = count + 1\n        say count'
    const astOut: string[] = []
    runSource(prog, (s) => astOut.push(s))
    const pirOut: string[] = []
    runSourceThroughPir(prog, (s) => pirOut.push(s))
    expect(pirOut).toEqual(astOut)
    expect(astOut).toEqual(["1"])
  })

  it("optimized PIR behaves identically to unoptimized", () => {
    const prog = 'set a = 2 + 3\nset b = a * 4\nsay b\nsay "unused calc" + ""'
    const plain: string[] = []
    runSourceThroughPir(prog, (s) => plain.push(s))
    const { module } = optimizeSource(prog)
    const optOut: string[] = []
    runPir(module, (s: string) => optOut.push(s))
    expect(optOut).toEqual(plain)
  })
})

describe("3A.8–3A.10 passes", () => {
  it("constant folding collapses 10 + 20", () => {
    const result = runPasses(compileToPir("set t = 10 + 20\nsay t"), [constantFolding])
    expect(result.report.some((r) => r.includes("constant folding"))).toBe(true)
    expect(result.changed).toBe(true)
    // The add over two consts is rewritten to a single const op.
    const ops = result.module.functions[0].blocks[0].ops
    expect(ops.some((o) => o.op === "add")).toBe(false)
    expect(ops.some((o) => o.op === "const" && o.operands[0]?.value === 30)).toBe(true)
  })

  it("constant propagation replaces loads of known stores", () => {
    const after = runPasses(compileToPir("set x = 7\nsay x"), [constantPropagation]).module.functions[0].blocks[0].ops
    const loads = after.filter((o) => o.op === "load")
    expect(loads).toHaveLength(0)
  })

  it("DCE removes dead stores", () => {
    const after = runPasses(
      compileToPir("set used = 1\nsay used\nset unused = 99"),
      [constantPropagation, deadCodeElimination],
    ).module.functions[0].blocks[0].ops
    const stores = after.filter((o) => o.op === "store" && String(o.operands[0]?.value) === "unused")
    expect(stores).toHaveLength(0)
  })

  it("full default pipeline keeps behavior identical", () => {
    const prog = 'set price = 100\nset quantity = 5\nset total = price * quantity\nsay total'
    const plain: string[] = []
    runSourceThroughPir(prog, (s) => plain.push(s))
    const { module } = optimizeSource(prog)
    const fast: string[] = []
    runPir(module, (s: string) => fast.push(s))
    expect(fast).toEqual(plain)
  })
})

describe("3A.7 golden snapshot", () => {
  it("stable JSON matches the recorded golden file", async () => {
    const mod = compileToPir("set price = 100\nset quantity = 5\nset total = price * quantity\nsay total")
    const actual = JSON.parse(moduleToStableJSON(mod))
    const golden = (await import("../../tests/golden/price-total.pir.json")).default
    expect(actual).toEqual(golden)
  })
})
