/**
 * Plainly Standard Library (v0.2).
 *
 * Native functions registered into the global environment of every
 * interpreter. Every function:
 *   - checks its argument count and types with beginner-friendly errors
 *   - throws PlainError with a stable code (PL-011 / PL-009)
 *   - is documented in STDLIB_DOCS so `plainly explain` and the docs
 *     can describe it without duplicating text.
 */

import { PlainError, ERROR_CODES, type Position } from "./errors.js"
import type { PlainValue, PlainList, PlainNativeFunction } from "./interpreter-types.js"
import { isList } from "./interpreter-types.js"

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function makeList(items: PlainValue[]): PlainList {
  return { __plain_list: true, items }
}

function describeType(v: PlainValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return "a number"
  if (typeof v === "string") return "text"
  if (typeof v === "boolean") return "true/false"
  if (isList(v)) return "a list"
  return "a value"
}

function wrongArgCount(name: string, got: number, want: string, pos: Position): never {
  throw new PlainError(
    `The function '${name}' needs ${want}, but you gave ${got}.`,
    pos.line,
    pos.column,
    {
      code: ERROR_CODES.WRONG_ARG_COUNT,
      hint: `Correct shape: ${name}(${want.replace(/[^a-z, ]/gi, "").trim()}) — see 'plainly explain ${name}'.`,
    },
  )
}

function checkCount(name: string, args: PlainValue[], count: number, pos: Position): void {
  if (args.length !== count) {
    wrongArgCount(name, args.length, String(count), pos)
  }
}

function requireString(args: PlainValue[], i: number, name: string, pos: Position): string {
  const v = args[i]
  if (typeof v !== "string") {
    throw new PlainError(
      `${name}() needs text in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH },
    )
  }
  return v
}

function requireNumber(args: PlainValue[], i: number, name: string, pos: Position): number {
  const v = args[i]
  if (typeof v !== "number") {
    throw new PlainError(
      `${name}() needs a number in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH },
    )
  }
  return v
}

function requireList(args: PlainValue[], i: number, name: string, pos: Position): PlainList {
  const v = args[i]
  if (!isList(v)) {
    throw new PlainError(
      `${name}() needs a list in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH },
    )
  }
  return v
}

function deepEqual(a: PlainValue, b: PlainValue): boolean {
  if (isList(a) && isList(b)) {
    return a.items.length === b.items.length && a.items.every((x, i) => deepEqual(x, b.items[i]))
  }
  return a === b
}

/** Render any Plainly value as display text (same rules as `say`). */
export function formatItem(v: PlainValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "true" : "false"
  if (isList(v)) return `[${v.items.map((x) => (typeof x === "string" ? `"${x}"` : formatItem(x))).join(", ")}]`
  return "a function"
}

// ---------------------------------------------------------------------------
// The functions
// ---------------------------------------------------------------------------

type NativeFn = PlainNativeFunction["fn"]

interface Entry {
  name: string
  signature: string
  summary: string
  example: string
  fn: NativeFn
}

const entries: Entry[] = [
  // ----- text -----
  {
    name: "uppercase",
    signature: "uppercase(text)",
    summary: "Turns text into ALL CAPITALS.",
    example: 'uppercase("hello")  →  "HELLO"',
    fn: (args, pos) => {
      checkCount("uppercase", args, 1, pos)
      return requireString(args, 0, "uppercase", pos).toUpperCase()
    },
  },
  {
    name: "lowercase",
    signature: "lowercase(text)",
    summary: "Turns text into all lowercase.",
    example: 'lowercase("HELLO")  →  "hello"',
    fn: (args, pos) => {
      checkCount("lowercase", args, 1, pos)
      return requireString(args, 0, "lowercase", pos).toLowerCase()
    },
  },
  {
    name: "trim",
    signature: "trim(text)",
    summary: "Removes spaces from the start and end of text.",
    example: 'trim("  hi  ")  →  "hi"',
    fn: (args, pos) => {
      checkCount("trim", args, 1, pos)
      return requireString(args, 0, "trim", pos).trim()
    },
  },
  {
    name: "split",
    signature: "split(text, separator)",
    summary: "Breaks text into a list of pieces wherever the separator appears.",
    example: 'split("a,b,c", ",")  →  ["a", "b", "c"]',
    fn: (args, pos) => {
      checkCount("split", args, 2, pos)
      const text = requireString(args, 0, "split", pos)
      const sep = requireString(args, 1, "split", pos)
      if (sep === "") {
        throw new PlainError(
          "split() needs a separator between the quotes (like \",\" or \" \"). An empty separator doesn't say where to break the text.",
          pos.line,
          pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH, hint: 'Try split(text, ",") or split(text, " ").' },
        )
      }
      return makeList(text.split(sep))
    },
  },
  {
    name: "join",
    signature: "join(list, separator)",
    summary: "Glues a list of values into one piece of text, with the separator between items.",
    example: 'join(["a", "b"], "-")  →  "a-b"',
    fn: (args, pos) => {
      checkCount("join", args, 2, pos)
      const items = requireList(args, 0, "join", pos).items
      const sep = requireString(args, 1, "join", pos)
      return items.map(formatItem).join(sep)
    },
  },
  {
    name: "contains",
    signature: "contains(where, what)",
    summary: "Checks whether text contains a piece of text, or a list contains a value. Gives true or false.",
    example: 'contains("hello", "ell")  →  true;  contains([1, 2], 2)  →  true',
    fn: (args, pos) => {
      checkCount("contains", args, 2, pos)
      if (typeof args[0] === "string") {
        return args[0].includes(requireString(args, 1, "contains", pos))
      }
      const hay = requireList(args, 0, "contains", pos)
      return hay.items.some((item) => deepEqual(item, args[1]))
    },
  },
  {
    name: "replace",
    signature: "replace(text, from, to)",
    summary: "Replaces every occurrence of some text with different text.",
    example: 'replace("aaa", "a", "b")  →  "bbb"',
    fn: (args, pos) => {
      checkCount("replace", args, 3, pos)
      const text = requireString(args, 0, "replace", pos)
      const from = requireString(args, 1, "replace", pos)
      const to = requireString(args, 2, "replace", pos)
      if (from === "") {
        throw new PlainError(
          "replace() needs something to replace. The second value can't be empty text.",
          pos.line,
          pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH },
        )
      }
      return text.split(from).join(to)
    },
  },
  // ----- numbers -----
  {
    name: "abs",
    signature: "abs(n)",
    summary: "Gives a number without its sign (distance from zero).",
    example: "abs(-5)  →  5",
    fn: (args, pos) => {
      checkCount("abs", args, 1, pos)
      return Math.abs(requireNumber(args, 0, "abs", pos))
    },
  },
  {
    name: "round",
    signature: "round(n)",
    summary: "Rounds a number to the nearest whole number.",
    example: "round(2.6)  →  3",
    fn: (args, pos) => {
      checkCount("round", args, 1, pos)
      return Math.round(requireNumber(args, 0, "round", pos))
    },
  },
  {
    name: "floor",
    signature: "floor(n)",
    summary: "Rounds a number DOWN to the nearest whole number.",
    example: "floor(2.9)  →  2",
    fn: (args, pos) => {
      checkCount("floor", args, 1, pos)
      return Math.floor(requireNumber(args, 0, "floor", pos))
    },
  },
  {
    name: "ceil",
    signature: "ceil(n)",
    summary: "Rounds a number UP to the nearest whole number.",
    example: "ceil(2.1)  →  3",
    fn: (args, pos) => {
      checkCount("ceil", args, 1, pos)
      return Math.ceil(requireNumber(args, 0, "ceil", pos))
    },
  },
  {
    name: "min",
    signature: "min(a, b)",
    summary: "Gives the smaller of two numbers.",
    example: "min(3, 7)  →  3",
    fn: (args, pos) => {
      checkCount("min", args, 2, pos)
      return Math.min(requireNumber(args, 0, "min", pos), requireNumber(args, 1, "min", pos))
    },
  },
  {
    name: "max",
    signature: "max(a, b)",
    summary: "Gives the larger of two numbers.",
    example: "max(3, 7)  →  7",
    fn: (args, pos) => {
      checkCount("max", args, 2, pos)
      return Math.max(requireNumber(args, 0, "max", pos), requireNumber(args, 1, "max", pos))
    },
  },
  // ----- conversion -----
  {
    name: "number",
    signature: "number(value)",
    summary: "Turns text like \"42\" into the number 42.",
    example: 'number("3.14")  →  3.14',
    fn: (args, pos) => {
      checkCount("number", args, 1, pos)
      const v = args[0]
      if (typeof v === "number") return v
      if (typeof v === "string") {
        const n = Number(v)
        if (v.trim() !== "" && !Number.isNaN(n)) return n
        throw new PlainError(
          `I couldn't turn ${JSON.stringify(v)} into a number.`,
          pos.line,
          pos.column,
          {
            code: ERROR_CODES.TYPE_MISMATCH,
            hint: 'Only text that looks like a number works, like "42" or "3.14".',
          },
        )
      }
      throw new PlainError(
        `You can only turn text into a number, but you gave ${describeType(v)}.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.TYPE_MISMATCH },
      )
    },
  },
  {
    name: "text",
    signature: "text(value)",
    summary: "Turns any value (number, list, true/false) into text.",
    example: "text(42)  →  \"42\"",
    fn: (args, pos) => {
      checkCount("text", args, 1, pos)
      return formatItem(args[0])
    },
  },
  // ----- lists -----
  {
    name: "push",
    signature: "push(list, value)",
    summary: "Adds a value to the end of a list and gives the list back.",
    example: "push(xs, 4)  →  xs is now [1, 2, 3, 4]",
    fn: (args, pos) => {
      checkCount("push", args, 2, pos)
      const list = requireList(args, 0, "push", pos)
      list.items.push(args[1])
      return list
    },
  },
  {
    name: "list",
    signature: "list(...)",
    summary: "Makes a new list from any values you give it.",
    example: "list(1, 2, 3)  →  [1, 2, 3]",
    fn: (args) => makeList(args),
  },
  // ----- misc -----
  {
    name: "length",
    signature: "length(value)",
    summary: "Counts the characters in text, or the items in a list.",
    example: 'length("hello")  →  5;  length([1, 2, 3])  →  3',
    fn: (args, pos) => {
      checkCount("length", args, 1, pos)
      const v = args[0]
      if (typeof v === "string") return v.length
      if (isList(v)) return v.items.length
      throw new PlainError(
        `You tried to get the length of ${describeType(v)}, but only text and lists have a length.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.TYPE_MISMATCH },
      )
    },
  },
]

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const STDLIB_DOCS = entries.map(({ name, signature, summary, example }) => ({
  name,
  signature,
  summary,
  example,
}))

export function getStdlibDoc(name: string): { name: string; signature: string; summary: string; example: string } | null {
  return STDLIB_DOCS.find((d) => d.name === name) ?? null
}

/** One native function per builtin name, ready to declare in the global env. */
export function createStdlib(): Record<string, PlainNativeFunction> {
  const out: Record<string, PlainNativeFunction> = {}
  for (const entry of entries) {
    out[entry.name] = { __plain_native: true, name: entry.name, fn: entry.fn }
  }
  return out
}
