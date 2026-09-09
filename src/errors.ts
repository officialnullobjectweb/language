/**
 * Plainly Error System (v0.2).
 *
 * Every diagnostic has:
 *   - a stable code (PL-XXX) so docs, `plainly explain`, and IDEs can reference it
 *   - a severity (error | warning)
 *   - a beginner-friendly message written in plain language
 *   - an optional hint (how to fix it)
 *   - a position (1-based line/column)
 *
 * The formatter renders them with source context and a caret:
 *
 *   PL-002 at line 2, column 5: You tried to use 'agge', but it doesn't exist yet.
 *
 *       say agge
 *           ^^^^
 *     Hint: Did you mean 'age'?
 */

export type Severity = "error" | "warning"

export interface Position {
  line: number // 1-based
  column: number // 1-based
}

export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  hint?: string
  pos: Position
  /** Length of the affected span (for underlining); defaults to 1. */
  length?: number
}

export const ERROR_CODES = {
  UNKNOWN_CHARACTER: "PL-001",
  UNDEFINED_VARIABLE: "PL-002",
  MISSING_QUOTE: "PL-003",
  BAD_INDENTATION: "PL-004",
  UNEXPECTED_TOKEN: "PL-005",
  BAD_ESCAPE: "PL-006",
  EMPTY_BLOCK: "PL-007",
  DIVIDE_BY_ZERO: "PL-008",
  TYPE_MISMATCH: "PL-009",
  NOT_A_FUNCTION: "PL-010",
  WRONG_ARG_COUNT: "PL-011",
  INDEX_OUT_OF_RANGE: "PL-012",
  RETURN_OUTSIDE_FUNCTION: "PL-013",
  DUPLICATE_PARAMETER: "PL-014",
  UNUSED_VARIABLE: "PL-015",
  INVALID_OPERATION: "PL-016",
  RESERVED_NAME: "PL-017",
  BAD_PLACEMENT: "PL-018",
  UNKNOWN_ENTITY: "PL-019",
  DUPLICATE_DECL: "PL-020",
  UNKNOWN_FORM_FIELD: "PL-021",
  FORM_WITHOUT_ENTITY: "PL-022",
} as const

export class PlainError extends Error {
  public readonly code: string
  public readonly severity: Severity
  public readonly hint?: string
  public readonly line: number
  public readonly column: number
  public readonly length: number

  constructor(
    message: string,
    line: number,
    column: number,
    options?: {
      code?: string
      hint?: string
      length?: number
      severity?: Severity
    },
  ) {
    super(message)
    this.name = "PlainError"
    this.code = options?.code ?? ERROR_CODES.UNEXPECTED_TOKEN
    this.hint = options?.hint
    this.length = options?.length ?? 1
    this.severity = options?.severity ?? "error"
    this.line = line
    this.column = column
  }

  toDiagnostic(): Diagnostic {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      hint: this.hint,
      pos: { line: this.line, column: this.column },
      length: this.length,
    }
  }
}

/** Throw a PlainError with a given code. Small helper to keep call sites tidy. */
export function plainThrow(
  code: string,
  message: string,
  pos: Position,
  hint?: string,
  length?: number,
): never {
  throw new PlainError(message, pos.line, pos.column, { code, hint, length })
}

// ---------------------------------------------------------------------------
// Did-you-mean suggestions
// ---------------------------------------------------------------------------

/** Levenshtein edit distance, capped for speed. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const prev = new Array<number>(b.length + 1)
  const curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/**
 * Find the closest name in `candidates` to `name`.
 * Returns null when nothing is close enough to be a believable typo.
 */
export function suggestName(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const candidate of candidates) {
    const d = editDistance(name.toLowerCase(), candidate.toLowerCase())
    if (d < bestScore) {
      bestScore = d
      best = candidate
    }
  }
  // Rule of thumb: a suggestion must be within ~1/3 of the name's length.
  const threshold = Math.max(2, Math.floor(name.length / 3))
  return best !== null && bestScore <= threshold ? best : null
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDiagnostic(diag: Diagnostic, source?: string): string {
  const lines: string[] = []
  const where = `line ${diag.pos.line}, column ${diag.pos.column}`
  lines.push(`${diag.code} at ${where}: ${diag.message}`)

  if (source) {
    const srcLines = source.split(/\r?\n/)
    const lineText = srcLines[diag.pos.line - 1]
    if (lineText !== undefined) {
      lines.push("")
      lines.push(`    ${lineText}`)
      const width = Math.max(1, diag.length ?? 1)
      const caret = "^".repeat(width)
      lines.push(`    ${" ".repeat(Math.max(0, diag.pos.column - 1))}${caret}`)
    }
  }

  if (diag.hint) {
    lines.push(`Hint: ${diag.hint}`)
  }
  return lines.join("\n")
}

export function formatError(err: PlainError, source?: string): string {
  return formatDiagnostic(err.toDiagnostic(), source)
}
