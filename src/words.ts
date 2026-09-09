/**
 * Plainly reserved words.
 * Shared by the lexer (keyword recognition), the semantic analyzer
 * (reserving names), and the standard library (not shadowing builtins).
 */

export const KEYWORDS: ReadonlySet<string> = new Set([
  "say", "set", "if", "otherwise", "for", "each", "in", "repeat", "times",
  "function", "return", "true", "false", "and", "or", "not",
  // application model (v0.3)
  "app", "database", "page", "title", "button", "show", "state", "create",
  // forms (v0.4)
  "form", "field", "from",
])

/**
 * Standard library function names available in every program.
 * These live in the global environment; user code may shadow them,
 * but the analyzer warns when a builtin is accidentally shadowed by
 * a top-level name that is never used.
 */
export const BUILTIN_NAMES: readonly string[] = [
  // text
  "uppercase", "lowercase", "trim", "split", "join", "contains", "replace",
  // numbers
  "abs", "round", "floor", "ceil", "min", "max",
  // conversion
  "number", "text",
  // lists
  "push", "list",
  // misc
  "length",
]

/** All names that cannot be redefined at the top level. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([...KEYWORDS])
