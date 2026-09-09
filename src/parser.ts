/**
 * Plainly Parser.
 * Turns the token stream into an AST.
 *
 * Grammar (v0.1):
 *   program        := statement*
 *   statement      := sayStmt | setStmt | ifStmt | forEachStmt | repeatStmt
 *                   | functionDecl | returnStmt | exprStmt
 *   sayStmt        := "say" expression
 *   setStmt        := "set" IDENT "=" expression
 *   ifStmt         := "if" expression ":" block ("otherwise" (ifStmt | ":" block))?
 *   forEachStmt    := "for" "each" IDENT "in" expression ":" block
 *   repeatStmt     := "repeat" expression "times" ":" block
 *   functionDecl   := "function" IDENT "(" params? ")" ":" block
 *   returnStmt     := "return" expression?
 *   block          := INDENT statement+ DEDENT
 *
 * Expressions use precedence climbing:
 *   or < and < equality < comparison < additive < multiplicative < unary < postfix
 */

import type {
  Block, EntityField, Expr, IfStmt, Program, Stmt,
} from "./ast.js"
import { PlainError, ERROR_CODES, type Token } from "./lexer.js"

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram()
}

class Parser {
  private pos = 0

  constructor(private tokens: Token[]) {}

  // ----- helpers -----

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  private next(): Token {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) this.pos++
    return t
  }

  private at(type: Token["type"], value?: string): boolean {
    const t = this.peek()
    return t.type === type && (value === undefined || t.value === value)
  }

  private atKw(...words: string[]): boolean {
    const t = this.peek()
    return t.type === "KEYWORD" && words.includes(t.value)
  }

  private expect(type: Token["type"], value?: string): Token {
    const t = this.peek()
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      const expected = value ?? type.toLowerCase()
      const got = describeToken(t)
      const hint = expected === "COLON"
        ? "Blocks start with a colon, like:  if age >= 18:"
        : expected === "RPAREN"
          ? "Check that every opening ( has a matching )."
          : expected === "RBRACKET"
            ? "Check that every opening [ has a matching ]."
            : undefined
      throw this.error(t, `I expected ${article(expected)} ${expected} here, but found ${got}.`, hint)
    }
    return this.next()
  }

  private error(t: Token, message: string, hint?: string): PlainError {
    return new PlainError(message, t.pos.line, t.pos.column, {
      code: ERROR_CODES.UNEXPECTED_TOKEN,
      hint,
      length: Math.max(1, t.value.length),
    })
  }

  private skipNewlines(): void {
    while (this.at("NEWLINE")) this.next()
  }

  // ----- program -----

  parseProgram(): Program {
    const body: Stmt[] = []
    this.skipNewlines()
    while (!this.at("EOF")) {
      body.push(this.parseStatement())
      this.skipNewlines()
    }
    return { kind: "Program", body }
  }

  // ----- statements -----

  parseStatement(): Stmt {
    if (this.atKw("say")) return this.parseSay()
    if (this.atKw("set")) return this.parseSet()
    if (this.atKw("if")) return this.parseIf()
    if (this.atKw("for")) return this.parseForEach()
    if (this.atKw("repeat")) return this.parseRepeat()
    if (this.atKw("function")) return this.parseFunction()
    if (this.atKw("return")) return this.parseReturn()
    // Application model (v0.3)
    if (this.atKw("app")) return this.parseApp()
    if (this.atKw("database")) return this.parseDatabase()
    if (this.atKw("page")) return this.parsePage()
    if (this.atKw("title")) return this.parseTitle()
    if (this.atKw("button")) return this.parseButton()
    if (this.atKw("show")) return this.parseShow()
    if (this.atKw("state")) return this.parseState()
    if (this.atKw("create")) return this.parseCreate()
    if (this.atKw("form")) return this.parseForm()
    // Expression statement (e.g. a bare function call)
    const pos = this.peek().pos
    const expr = this.parseExpression()
    return { kind: "ExprStmt", expr, pos }
  }

  // ----- application model -----

  private parseApp(): Stmt {
    const kw = this.next() // app
    const name = this.expect("STRING").value
    return { kind: "AppStmt", name, pos: kw.pos }
  }

  private parseDatabase(): Stmt {
    const kw = this.next() // database
    const name = this.expect("IDENT").value
    this.expect("COLON")
    this.skipNewlines()
    this.expect("INDENT")
    const fields: EntityField[] = []
    this.skipNewlines()
    while (!this.at("DEDENT") && !this.at("EOF")) {
      // Field names may be keywords (e.g. `title: text`) — the colon after
      // the name disambiguates them from statements.
      const nameTok = this.next()
      if (nameTok.type !== "IDENT" && nameTok.type !== "KEYWORD") {
        throw this.error(nameTok, `Expected a field name, got '${nameTok.value}'.`)
      }
      const fieldName = nameTok.value
      this.expect("COLON")
      const typeTok = this.expect("IDENT")
      if (!isFieldType(typeTok.value)) {
        throw this.error(
          typeTok,
          `'${typeTok.value}' is not a field type. Valid types: text, number, boolean, money, email, date.`,
          `Write the field like:  ${fieldName}: text`,
        )
      }
      fields.push({ name: fieldName, type: typeTok.value as EntityField["type"] })
      this.skipNewlines()
    }
    this.expect("DEDENT")
    if (fields.length === 0) {
      throw new PlainError(
        `The database '${name}' has no fields. Add at least one, like:  name: text`,
        kw.pos.line,
        kw.pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK },
      )
    }
    return { kind: "DatabaseStmt", name, fields, pos: kw.pos }
  }

  private parsePage(): Stmt {
    const kw = this.next() // page
    const name = this.expect("STRING").value
    this.expect("COLON")
    const body = this.parsePageBlock()
    return { kind: "PageStmt", name, body, pos: kw.pos }
  }

  private parseTitle(): Stmt {
    const kw = this.next() // title
    const value = this.expect("STRING").value
    return { kind: "TitleStmt", value, pos: kw.pos }
  }

  private parseButton(): Stmt {
    const kw = this.next() // button
    const label = this.expect("STRING").value
    this.expect("COLON")
    const body = this.parsePageBlock()
    return { kind: "ButtonStmt", label, body, pos: kw.pos }
  }

  private parseShow(): Stmt {
    const kw = this.next() // show
    const entity = this.expect("IDENT").value
    return { kind: "ShowStmt", entity, pos: kw.pos }
  }

  private parseState(): Stmt {
    const kw = this.next() // state
    const name = this.expect("IDENT").value
    this.expect("OPERATOR", "=")
    const value = this.parseExpression()
    return { kind: "StateStmt", name, value, pos: kw.pos }
  }

  private parseCreate(): Stmt {
    const kw = this.next() // create
    const entity = this.expect("IDENT").value
    return { kind: "CreateStmt", entity, pos: kw.pos }
  }

  /**
   * form "Label" from Entity:
   *     field name: text
   *     field age: number
   */
  private parseForm(): Stmt {
    const kw = this.next() // form
    const label = this.expect("STRING").value
    if (this.atKw("from")) {
      this.next()
    } else {
      throw this.error(
        this.peek(),
        `A form needs to know which database it fills. Write:  form "${label}" from Entity:`,
      )
    }
    const entity = this.expect("IDENT").value
    this.expect("COLON")
    this.skipNewlines()
    this.expect("INDENT")
    const fields: EntityField[] = []
    this.skipNewlines()
    while (!this.at("DEDENT") && !this.at("EOF")) {
      if (!this.atKw("field")) {
        throw this.error(
          this.peek(),
          `Inside a form, each line starts with 'field'. Got '${this.peek().value}' instead.`,
          `Write:  field name: text`,
        )
      }
      this.next() // field
      const nameTok = this.next()
      if (nameTok.type !== "IDENT" && nameTok.type !== "KEYWORD") {
        throw this.error(nameTok, `Expected a field name, got '${nameTok.value}'.`)
      }
      this.expect("COLON")
      const typeTok = this.expect("IDENT")
      if (!isFieldType(typeTok.value)) {
        throw this.error(
          typeTok,
          `'${typeTok.value}' is not a field type. Valid types: text, number, boolean, money, email, date.`,
          `Write the field like:  ${nameTok.value}: text`,
        )
      }
      fields.push({ name: nameTok.value, type: typeTok.value as EntityField["type"] })
      this.skipNewlines()
    }
    this.expect("DEDENT")
    if (fields.length === 0) {
      throw new PlainError(
        `The form '${label}' has no fields. Add at least one, like:  field name: text`,
        kw.pos.line,
        kw.pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK },
      )
    }
    return { kind: "FormStmt", label, entity, fields, pos: kw.pos }
  }

  /**
   * Page-style block: allows the UI statements (title/show/button/state/create/say/set)
   * and keeps the standard block rules otherwise.
   */
  private parsePageBlock(): Block {
    return this.parseBlock()
  }

  private parseSay(): Stmt {
    const kw = this.next() // say
    const value = this.parseExpression()
    return { kind: "SayStmt", value, pos: kw.pos }
  }

  private parseSet(): Stmt {
    const kw = this.next() // set
    const name = this.expect("IDENT").value
    this.expect("OPERATOR", "=")
    const value = this.parseExpression()
    return { kind: "SetStmt", name, value, pos: kw.pos }
  }

  private parseIf(): IfStmt {
    const kw = this.next() // if
    const condition = this.parseExpression()
    this.expect("COLON")
    const then = this.parseBlock()
    this.skipNewlines()
    if (this.atKw("otherwise")) {
      const otherwiseTok = this.peek()
      this.next()
      if (this.atKw("if")) {
        const nested: IfStmt = this.parseIf()
        return { kind: "IfStmt", condition, then, otherwise: nested, pos: kw.pos }
      }
      this.expect("COLON")
      const otherwise = this.parseBlock()
      void otherwiseTok
      return { kind: "IfStmt", condition, then, otherwise, pos: kw.pos }
    }
    return { kind: "IfStmt", condition, then, pos: kw.pos }
  }

  private parseForEach(): Stmt {
    const kw = this.next() // for
    this.expect("KEYWORD", "each")
    const varName = this.expect("IDENT").value
    this.expect("KEYWORD", "in")
    const iterable = this.parseExpression()
    this.expect("COLON")
    const body = this.parseBlock()
    return { kind: "ForEachStmt", varName, iterable, body, pos: kw.pos }
  }

  private parseRepeat(): Stmt {
    const kw = this.next() // repeat
    const count = this.parseExpression()
    this.expect("KEYWORD", "times")
    this.expect("COLON")
    const body = this.parseBlock()
    return { kind: "RepeatStmt", count, body, pos: kw.pos }
  }

  private parseFunction(): Stmt {
    const kw = this.next() // function
    const name = this.expect("IDENT").value
    this.expect("LPAREN")
    const params: string[] = []
    if (!this.at("RPAREN")) {
      do {
        params.push(this.expect("IDENT").value)
      } while (this.at("COMMA") && (this.next(), true))
    }
    this.expect("RPAREN")
    this.expect("COLON")
    const body = this.parseBlock()
    return { kind: "FunctionDecl", name, params, body, pos: kw.pos }
  }

  private parseReturn(): Stmt {
    const kw = this.next() // return
    // Allow `return` with no value when the line ends here.
    if (this.at("NEWLINE") || this.at("EOF") || this.at("DEDENT")) {
      return { kind: "ReturnStmt", pos: kw.pos }
    }
    const value = this.parseExpression()
    return { kind: "ReturnStmt", value, pos: kw.pos }
  }

  private parseBlock(): Block {
    this.skipNewlines()
    this.expect("INDENT")
    const body: Stmt[] = []
    this.skipNewlines()
    while (!this.at("DEDENT") && !this.at("EOF")) {
      body.push(this.parseStatement())
      this.skipNewlines()
    }
    this.expect("DEDENT")
    if (body.length === 0) {
      throw new PlainError(
        "This block is empty. Add at least one indented line after the colon.",
        this.peek().pos.line,
        this.peek().pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK },
      )
    }
    return { kind: "Block", body }
  }

  // ----- expressions (precedence climbing) -----

  parseExpression(): Expr {
    return this.parseOr()
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.atKw("or")) {
      const op = this.next()
      const right = this.parseAnd()
      left = { kind: "BinaryExpr", left, operator: "or", right, pos: op.pos }
    }
    return left
  }

  private parseAnd(): Expr {
    let left = this.parseEquality()
    while (this.atKw("and")) {
      const op = this.next()
      const right = this.parseEquality()
      left = { kind: "BinaryExpr", left, operator: "and", right, pos: op.pos }
    }
    return left
  }

  private parseEquality(): Expr {
    let left = this.parseComparison()
    while (this.at("OPERATOR", "==") || this.at("OPERATOR", "!=")) {
      const op = this.next()
      const right = this.parseComparison()
      left = { kind: "BinaryExpr", left, operator: op.value as BinaryOperator, right, pos: op.pos }
    }
    return left
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive()
    while (this.at("OPERATOR", ">") || this.at("OPERATOR", "<") || this.at("OPERATOR", ">=") || this.at("OPERATOR", "<=")) {
      const op = this.next()
      const right = this.parseAdditive()
      left = { kind: "BinaryExpr", left, operator: op.value as BinaryOperator, right, pos: op.pos }
    }
    return left
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative()
    while (this.at("OPERATOR", "+") || this.at("OPERATOR", "-")) {
      const op = this.next()
      const right = this.parseMultiplicative()
      left = { kind: "BinaryExpr", left, operator: op.value as BinaryOperator, right, pos: op.pos }
    }
    return left
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary()
    while (this.at("OPERATOR", "*") || this.at("OPERATOR", "/") || this.at("OPERATOR", "%")) {
      const op = this.next()
      const right = this.parseUnary()
      left = { kind: "BinaryExpr", left, operator: op.value as BinaryOperator, right, pos: op.pos }
    }
    return left
  }

  private parseUnary(): Expr {
    if (this.atKw("not")) {
      const op = this.next()
      const operand = this.parseUnary()
      return { kind: "UnaryExpr", operator: "not", operand, pos: op.pos }
    }
    if (this.at("OPERATOR", "-")) {
      const op = this.next()
      const operand = this.parseUnary()
      return { kind: "UnaryExpr", operator: "-", operand, pos: op.pos }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary()
    while (true) {
      if (this.at("LPAREN")) {
        this.next()
        const args: Expr[] = []
        if (!this.at("RPAREN")) {
          do {
            args.push(this.parseExpression())
          } while (this.at("COMMA") && (this.next(), true))
        }
        this.expect("RPAREN")
        expr = { kind: "CallExpr", callee: expr, args, pos: expr.pos }
      } else if (this.at("LBRACKET")) {
        this.next()
        const index = this.parseExpression()
        this.expect("RBRACKET")
        expr = { kind: "IndexExpr", object: expr, index, pos: expr.pos }
      } else {
        break
      }
    }
    return expr
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (t.type === "NUMBER") {
      this.next()
      return { kind: "NumberLit", value: Number(t.value), pos: t.pos }
    }
    if (t.type === "STRING") {
      this.next()
      return { kind: "StringLit", value: t.value, pos: t.pos }
    }
    if (t.type === "IDENT") {
      this.next()
      return { kind: "Identifier", name: t.value, pos: t.pos }
    }
    if (this.atKw("true") || this.atKw("false")) {
      this.next()
      return { kind: "BoolLit", value: t.value === "true", pos: t.pos }
    }
    if (this.at("LPAREN")) {
      this.next()
      const expr = this.parseExpression()
      this.expect("RPAREN")
      return expr
    }
    if (this.at("LBRACKET")) {
      this.next()
      const elements: Expr[] = []
      if (!this.at("RBRACKET")) {
        do {
          elements.push(this.parseExpression())
        } while (this.at("COMMA") && (this.next(), true))
      }
      this.expect("RBRACKET")
      return { kind: "ListLit", elements, pos: t.pos }
    }
    throw this.error(t, `I expected a value here (a number, text, name, or list) but found ${describeToken(t)}.`)
  }
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

const FIELD_TYPES = new Set(["text", "number", "boolean", "money", "email", "date"])
function isFieldType(word: string): boolean {
  return FIELD_TYPES.has(word)
}

type BinaryOperator = import("./ast.js").BinaryOperator

function describeToken(t: Token): string {
  switch (t.type) {
    case "NEWLINE": return "the end of the line"
    case "EOF": return "the end of the file"
    case "INDENT": return "an indented block"
    case "DEDENT": return "the end of a block"
    default: return `'${t.value}'`
  }
}
