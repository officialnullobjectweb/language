/**
 * Plainly Lexer.
 * Turns raw source text into a stream of tokens (with line/column positions).
 *
 * Example:
 *   say "Hello"
 * becomes
 *   SAY, STRING("Hello"), EOF
 */

import type { Position } from "./ast.js"
import { PlainError, ERROR_CODES, suggestName } from "./errors.js"
import { KEYWORDS } from "./words.js"

export { ERROR_CODES } from "./errors.js"

export type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "KEYWORD"
  | "NEWLINE"
  | "INDENT"
  | "DEDENT"
  | "COLON"
  | "COMMA"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "OPERATOR"
  | "EOF"

export interface Token {
  type: TokenType
  value: string
  pos: Position
}

export { PlainError }

/** Convert leading whitespace to a width (tabs count as 4, aligned). */
function indentWidth(text: string, line: number): number {
  let width = 0
  for (const ch of text) {
    if (ch === " ") width++
    else if (ch === "\t") width += 4 - (width % 4)
    else break
  }
  if (width % 2 !== 0) {
    throw new PlainError(
      `Indentation must use a consistent multiple of 2 spaces (found ${width} spaces). Align this line with the line above it.`,
      line,
      1,
      { code: ERROR_CODES.BAD_INDENTATION, length: width },
    )
  }
  return width
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const lines = source.split(/\r?\n/)
  const indents: number[] = [0]

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const lineNo = lineIdx + 1

    // --- Skip blank / comment-only lines (they don't affect indentation) ---
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue

    // --- Handle indentation ---
    const width = indentWidth(line, lineNo)
    if (width > indents[indents.length - 1]) {
      indents.push(width)
      tokens.push({ type: "INDENT", value: "", pos: { line: lineNo, column: 1 } })
    } else if (width < indents[indents.length - 1]) {
      while (indents.length > 1 && width < indents[indents.length - 1]) {
        indents.pop()
        tokens.push({ type: "DEDENT", value: "", pos: { line: lineNo, column: 1 } })
      }
      if (width !== indents[indents.length - 1]) {
        throw new PlainError(
          "This line is not aligned with any open block. Make sure your indentation matches an outer level.",
          lineNo,
          1,
          { code: ERROR_CODES.BAD_INDENTATION, length: width },
        )
      }
    }

    // --- Scan the rest of the line ---
    let i = 0
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++

    while (i < line.length) {
      const ch = line[i]

      // Skip spaces between tokens
      if (ch === " " || ch === "\t") {
        i++
        continue
      }

      // Comments run to end of line
      if (ch === "#") break

      // Strings
      if (ch === '"') {
        let j = i + 1
        let value = ""
        let closed = false
        while (j < line.length) {
          const c = line[j]
          if (c === "\\") {
            const next = line[j + 1]
            if (next === "n") value += "\n"
            else if (next === "t") value += "\t"
            else if (next === '"') value += '"'
            else if (next === "\\") value += "\\"
            else {
              throw new PlainError(
                `Unknown escape sequence '\\${next}' in string. Valid: \\n \\t \\" \\\\`,
                lineNo,
                j + 1,
                { code: ERROR_CODES.BAD_ESCAPE, length: 2 },
              )
            }
            j += 2
            continue
          }
          if (c === '"') {
            closed = true
            j++
            break
          }
          value += c
          j++
        }
        if (!closed) {
          throw new PlainError(
            'This string is missing its closing quote. Add a " at the end.',
            lineNo,
            i + 1,
            { code: ERROR_CODES.MISSING_QUOTE, length: line.length - i, hint: 'Add a " at the end of the line.' },
          )
        }
        tokens.push({ type: "STRING", value, pos: { line: lineNo, column: i + 1 } })
        i = j
        continue
      }

      // Numbers
      if (ch >= "0" && ch <= "9") {
        let j = i
        while (j < line.length && line[j] >= "0" && line[j] <= "9") j++
        if (line[j] === "." && j + 1 < line.length && line[j + 1] >= "0" && line[j + 1] <= "9") {
          j++
          while (j < line.length && line[j] >= "0" && line[j] <= "9") j++
        }
        tokens.push({ type: "NUMBER", value: line.slice(i, j), pos: { line: lineNo, column: i + 1 } })
        i = j
        continue
      }

      // Identifiers / keywords
      if (isIdentStart(ch)) {
        let j = i
        while (j < line.length && isIdentPart(line[j])) j++
        const word = line.slice(i, j)
        tokens.push({
          type: KEYWORDS.has(word) ? "KEYWORD" : "IDENT",
          value: word,
          pos: { line: lineNo, column: i + 1 },
        })
        i = j
        continue
      }

      // Operators & punctuation
      const two = line.slice(i, i + 2)
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        tokens.push({ type: "OPERATOR", value: two, pos: { line: lineNo, column: i + 1 } })
        i += 2
        continue
      }
      if ("+-*/%><=".includes(ch)) {
        tokens.push({ type: "OPERATOR", value: ch, pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === ":") {
        tokens.push({ type: "COLON", value: ":", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === ",") {
        tokens.push({ type: "COMMA", value: ",", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === "(") {
        tokens.push({ type: "LPAREN", value: "(", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === ")") {
        tokens.push({ type: "RPAREN", value: ")", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === "[") {
        tokens.push({ type: "LBRACKET", value: "[", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }
      if (ch === "]") {
        tokens.push({ type: "RBRACKET", value: "]", pos: { line: lineNo, column: i + 1 } })
        i++
        continue
      }

      const suggestion = suggestName(ch, ["+", "-", "*", "/", "%", ">", "<", "=", ":", ",", "(", ")", "[", "]", '"'])
      throw new PlainError(
        `I don't recognize the character '${ch}' here. Remove it or check for a typo.`,
        lineNo,
        i + 1,
        {
          code: ERROR_CODES.UNKNOWN_CHARACTER,
          length: 1,
          hint: suggestion ? `Did you mean '${suggestion}'?` : undefined,
        },
      )
    }

    // End of statement
    const isLast = lineIdx === lines.length - 1
    if (!isLast) {
      tokens.push({ type: "NEWLINE", value: "\\n", pos: { line: lineNo, column: line.length + 1 } })
    }
  }

  // Close any remaining open blocks
  while (indents.length > 1) {
    indents.pop()
    tokens.push({ type: "DEDENT", value: "", pos: { line: lines.length, column: 1 } })
  }
  tokens.push({ type: "EOF", value: "", pos: { line: lines.length, column: 1 } })
  return tokens
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch)
}
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}
