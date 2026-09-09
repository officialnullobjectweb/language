/**
 * Plainly runtime value types.
 * Kept separate from the interpreter so stdlib and analyzer can import
 * them without circular dependencies.
 */

import type { Block } from "./ast.js"
import type { Position } from "./errors.js"

export type PlainValue =
  | number
  | string
  | boolean
  | PlainList
  | KamalFunction
  | PlainNativeFunction
  | null

export interface PlainList {
  __plain_list: true
  items: PlainValue[]
}

export interface KamalFunction {
  __plain_function: true
  name: string
  params: string[]
  body: Block
  closure: EnvLike
}

/** Minimal environment surface used by function values (structural). */
export interface EnvLike {
  declare(name: string, value: PlainValue): void
  get(name: string, pos: { line: number; column: number }): PlainValue
}

export interface PlainNativeFunction {
  __plain_native: true
  name: string
  fn: (args: PlainValue[], pos: Position) => PlainValue
}

export function isList(v: PlainValue): v is PlainList {
  return typeof v === "object" && v !== null && (v as PlainList).__plain_list === true
}

export function isFunction(v: PlainValue): v is KamalFunction {
  return typeof v === "object" && v !== null && (v as KamalFunction).__plain_function === true
}

export function isNative(v: PlainValue): v is PlainNativeFunction {
  return typeof v === "object" && v !== null && (v as PlainNativeFunction).__plain_native === true
}
