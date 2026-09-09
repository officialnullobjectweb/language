// Entry point for the browser bundle used by the Plainly book playground.
import { runSource, checkSource, compileToPir, formatError, ERROR_CODES, STDLIB_DOCS } from "../src/index.js"

;(window as unknown as Record<string, unknown>).PlainlyBook = {
  runSource,
  checkSource,
  compileToPir,
  formatError,
  ERROR_CODES,
  STDLIB_DOCS,
}
