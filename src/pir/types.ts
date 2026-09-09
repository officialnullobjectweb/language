/**
 * PIR types (v0.3).
 *
 * PIR v0.1 carries a small set of primitive types. The type system is
 * deliberately tiny: number, string, boolean, null, list, and "unknown"
 * (used only where inference cannot yet reach — the validator rejects
 * unknown in operations that need concrete types).
 */

export type PirType =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "list"
  | "function"
  | "unknown"

export function pirTypeOf(value: PirValue): PirType {
  if (value === null) return "null"
  if (typeof value === "number") return "number"
  if (typeof value === "string") return "string"
  if (typeof value === "boolean") return "boolean"
  if (Array.isArray(value)) return "list"
  if (typeof value === "object" && (value as PirClosure).__pir_function === true) return "function"
  return "unknown"
}
/** PIR runtime values (same shapes as the AST interpreter's values). */
export type PirValue =
  | number
  | string
  | boolean
  | PirValue[]
  | PirClosure
  | null

export interface PirClosure {
  __pir_function: true
  name: string
  params: string[]
  /** Index into the module's function table that created this closure. */
  functionIndex: number
  /** Captured variable bindings at closure-creation time. */
  env: Map<string, PirValue>
  /** Records carry their entity name for db.create bookkeeping. */
  __pir_record?: string
}

/** Type name as written in app-model source (database fields). */
export type AppFieldType = "text" | "number" | "boolean" | "money" | "email" | "date"

export function appFieldTypeToPir(t: AppFieldType): PirType {
  switch (t) {
    case "text":
    case "money":
    case "email":
    case "date":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
  }
}
