/**
 * Value formatting for Plainly (v0.2).
 * Shared by the interpreter (`say`), stdlib (`text`, `join`), and the CLI.
 */

import type { PlainValue } from "./interpreter-types.js"
import { isList, isFunction, isNative } from "./interpreter-types.js"

export function formatValue(v: PlainValue): string {
  if (v === null) return "nothing"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "true" : "false"
  if (isList(v)) {
    return `[${v.items.map((item) => formatValueInList(item)).join(", ")}]`
  }
  if (isFunction(v)) return `<function ${v.name}>`
  if (isNative(v)) return `<function ${v.name}>`
  return String(v)
}

function formatValueInList(v: PlainValue): string {
  if (typeof v === "string") return `"${v}"`
  return formatValue(v)
}
