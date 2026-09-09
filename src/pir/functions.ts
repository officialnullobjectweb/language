/**
 * PIR function registry (v0.3).
 *
 * Lowering produces a PirFunctionTable: the module's functions plus the
 * builtin registry. The PIR interpreter executes from this table, so
 * call_user resolves the same way regardless of target.
 */

import type { IRFunction, IRModule } from "./ir.js"
import type { PirValue } from "./types.js"

export type PirBuiltinImpl = (args: PirValue[]) => PirValue

export interface PirFunctionTable {
  /** name → function IR */
  user: Map<string, { ir: IRFunction; index: number }>
  /** name → builtin implementation */
  builtins: Map<string, PirBuiltinImpl>
}

export function makeFunctionTable(module: IRModule, builtins: Record<string, PirBuiltinImpl>): PirFunctionTable {
  const user = new Map<string, { ir: IRFunction; index: number }>()
  module.functions.forEach((fn, index) => {
    user.set(fn.name, { ir: fn, index })
  })
  return { user, builtins: new Map(Object.entries(builtins)) }
}
