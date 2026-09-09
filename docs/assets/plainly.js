// src/errors.ts
var ERROR_CODES = {
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
  FORM_WITHOUT_ENTITY: "PL-022"
};
var PlainError = class extends Error {
  code;
  severity;
  hint;
  line;
  column;
  length;
  constructor(message, line, column, options) {
    super(message);
    this.name = "PlainError";
    this.code = options?.code ?? ERROR_CODES.UNEXPECTED_TOKEN;
    this.hint = options?.hint;
    this.length = options?.length ?? 1;
    this.severity = options?.severity ?? "error";
    this.line = line;
    this.column = column;
  }
  toDiagnostic() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      hint: this.hint,
      pos: { line: this.line, column: this.column },
      length: this.length
    };
  }
};
function editDistance(a, b, cap = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
function suggestName(name, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const threshold = Math.max(2, Math.floor(name.length / 3));
  return best !== null && bestScore <= threshold ? best : null;
}

// src/words.ts
var KEYWORDS = /* @__PURE__ */ new Set([
  "say",
  "set",
  "if",
  "otherwise",
  "for",
  "each",
  "in",
  "repeat",
  "times",
  "function",
  "return",
  "true",
  "false",
  "and",
  "or",
  "not",
  // application model (v0.3)
  "app",
  "database",
  "page",
  "title",
  "button",
  "show",
  "state",
  "create",
  // forms (v0.4)
  "form",
  "field",
  "from"
]);
var BUILTIN_NAMES = [
  // text
  "uppercase",
  "lowercase",
  "trim",
  "split",
  "join",
  "contains",
  "replace",
  // numbers
  "abs",
  "round",
  "floor",
  "ceil",
  "min",
  "max",
  // conversion
  "number",
  "text",
  // lists
  "push",
  "list",
  // misc
  "length"
];
var RESERVED_NAMES = /* @__PURE__ */ new Set([...KEYWORDS]);

// src/lexer.ts
function indentWidth(text, line) {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width++;
    else if (ch === "	") width += 4 - width % 4;
    else break;
  }
  if (width % 2 !== 0) {
    throw new PlainError(
      `Indentation must use a consistent multiple of 2 spaces (found ${width} spaces). Align this line with the line above it.`,
      line,
      1,
      { code: ERROR_CODES.BAD_INDENTATION, length: width }
    );
  }
  return width;
}
function tokenize(source) {
  const tokens = [];
  const lines = source.split(/\r?\n/);
  const indents = [0];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNo = lineIdx + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const width = indentWidth(line, lineNo);
    if (width > indents[indents.length - 1]) {
      indents.push(width);
      tokens.push({ type: "INDENT", value: "", pos: { line: lineNo, column: 1 } });
    } else if (width < indents[indents.length - 1]) {
      while (indents.length > 1 && width < indents[indents.length - 1]) {
        indents.pop();
        tokens.push({ type: "DEDENT", value: "", pos: { line: lineNo, column: 1 } });
      }
      if (width !== indents[indents.length - 1]) {
        throw new PlainError(
          "This line is not aligned with any open block. Make sure your indentation matches an outer level.",
          lineNo,
          1,
          { code: ERROR_CODES.BAD_INDENTATION, length: width }
        );
      }
    }
    let i = 0;
    while (i < line.length && (line[i] === " " || line[i] === "	")) i++;
    while (i < line.length) {
      const ch = line[i];
      if (ch === " " || ch === "	") {
        i++;
        continue;
      }
      if (ch === "#") break;
      if (ch === '"') {
        let j = i + 1;
        let value = "";
        let closed = false;
        while (j < line.length) {
          const c = line[j];
          if (c === "\\") {
            const next = line[j + 1];
            if (next === "n") value += "\n";
            else if (next === "t") value += "	";
            else if (next === '"') value += '"';
            else if (next === "\\") value += "\\";
            else {
              throw new PlainError(
                `Unknown escape sequence '\\${next}' in string. Valid: \\n \\t \\" \\\\`,
                lineNo,
                j + 1,
                { code: ERROR_CODES.BAD_ESCAPE, length: 2 }
              );
            }
            j += 2;
            continue;
          }
          if (c === '"') {
            closed = true;
            j++;
            break;
          }
          value += c;
          j++;
        }
        if (!closed) {
          throw new PlainError(
            'This string is missing its closing quote. Add a " at the end.',
            lineNo,
            i + 1,
            { code: ERROR_CODES.MISSING_QUOTE, length: line.length - i, hint: 'Add a " at the end of the line.' }
          );
        }
        tokens.push({ type: "STRING", value, pos: { line: lineNo, column: i + 1 } });
        i = j;
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        let j = i;
        while (j < line.length && line[j] >= "0" && line[j] <= "9") j++;
        if (line[j] === "." && j + 1 < line.length && line[j + 1] >= "0" && line[j + 1] <= "9") {
          j++;
          while (j < line.length && line[j] >= "0" && line[j] <= "9") j++;
        }
        tokens.push({ type: "NUMBER", value: line.slice(i, j), pos: { line: lineNo, column: i + 1 } });
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i;
        while (j < line.length && isIdentPart(line[j])) j++;
        const word = line.slice(i, j);
        tokens.push({
          type: KEYWORDS.has(word) ? "KEYWORD" : "IDENT",
          value: word,
          pos: { line: lineNo, column: i + 1 }
        });
        i = j;
        continue;
      }
      const two = line.slice(i, i + 2);
      if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
        tokens.push({ type: "OPERATOR", value: two, pos: { line: lineNo, column: i + 1 } });
        i += 2;
        continue;
      }
      if ("+-*/%><=".includes(ch)) {
        tokens.push({ type: "OPERATOR", value: ch, pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === ":") {
        tokens.push({ type: "COLON", value: ":", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === ",") {
        tokens.push({ type: "COMMA", value: ",", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === "(") {
        tokens.push({ type: "LPAREN", value: "(", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === ")") {
        tokens.push({ type: "RPAREN", value: ")", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === "[") {
        tokens.push({ type: "LBRACKET", value: "[", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      if (ch === "]") {
        tokens.push({ type: "RBRACKET", value: "]", pos: { line: lineNo, column: i + 1 } });
        i++;
        continue;
      }
      const suggestion = suggestName(ch, ["+", "-", "*", "/", "%", ">", "<", "=", ":", ",", "(", ")", "[", "]", '"']);
      throw new PlainError(
        `I don't recognize the character '${ch}' here. Remove it or check for a typo.`,
        lineNo,
        i + 1,
        {
          code: ERROR_CODES.UNKNOWN_CHARACTER,
          length: 1,
          hint: suggestion ? `Did you mean '${suggestion}'?` : void 0
        }
      );
    }
    const isLast = lineIdx === lines.length - 1;
    if (!isLast) {
      tokens.push({ type: "NEWLINE", value: "\\n", pos: { line: lineNo, column: line.length + 1 } });
    }
  }
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: "DEDENT", value: "", pos: { line: lines.length, column: 1 } });
  }
  tokens.push({ type: "EOF", value: "", pos: { line: lines.length, column: 1 } });
  return tokens;
}
function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}
function isIdentPart(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

// src/parser.ts
function parse(tokens) {
  return new Parser(tokens).parseProgram();
}
var Parser = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  tokens;
  pos = 0;
  // ----- helpers -----
  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  next() {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === void 0 || t.value === value);
  }
  atKw(...words) {
    const t = this.peek();
    return t.type === "KEYWORD" && words.includes(t.value);
  }
  expect(type, value) {
    const t = this.peek();
    if (t.type !== type || value !== void 0 && t.value !== value) {
      const expected = value ?? type.toLowerCase();
      const got = describeToken(t);
      const hint = expected === "COLON" ? "Blocks start with a colon, like:  if age >= 18:" : expected === "RPAREN" ? "Check that every opening ( has a matching )." : expected === "RBRACKET" ? "Check that every opening [ has a matching ]." : void 0;
      throw this.error(t, `I expected ${article(expected)} ${expected} here, but found ${got}.`, hint);
    }
    return this.next();
  }
  error(t, message, hint) {
    return new PlainError(message, t.pos.line, t.pos.column, {
      code: ERROR_CODES.UNEXPECTED_TOKEN,
      hint,
      length: Math.max(1, t.value.length)
    });
  }
  skipNewlines() {
    while (this.at("NEWLINE")) this.next();
  }
  // ----- program -----
  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.at("EOF")) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { kind: "Program", body };
  }
  // ----- statements -----
  parseStatement() {
    if (this.atKw("say")) return this.parseSay();
    if (this.atKw("set")) return this.parseSet();
    if (this.atKw("if")) return this.parseIf();
    if (this.atKw("for")) return this.parseForEach();
    if (this.atKw("repeat")) return this.parseRepeat();
    if (this.atKw("function")) return this.parseFunction();
    if (this.atKw("return")) return this.parseReturn();
    if (this.atKw("app")) return this.parseApp();
    if (this.atKw("database")) return this.parseDatabase();
    if (this.atKw("page")) return this.parsePage();
    if (this.atKw("title")) return this.parseTitle();
    if (this.atKw("button")) return this.parseButton();
    if (this.atKw("show")) return this.parseShow();
    if (this.atKw("state")) return this.parseState();
    if (this.atKw("create")) return this.parseCreate();
    if (this.atKw("form")) return this.parseForm();
    const pos = this.peek().pos;
    const expr = this.parseExpression();
    return { kind: "ExprStmt", expr, pos };
  }
  // ----- application model -----
  parseApp() {
    const kw = this.next();
    const name = this.expect("STRING").value;
    return { kind: "AppStmt", name, pos: kw.pos };
  }
  parseDatabase() {
    const kw = this.next();
    const name = this.expect("IDENT").value;
    this.expect("COLON");
    this.skipNewlines();
    this.expect("INDENT");
    const fields = [];
    this.skipNewlines();
    while (!this.at("DEDENT") && !this.at("EOF")) {
      const nameTok = this.next();
      if (nameTok.type !== "IDENT" && nameTok.type !== "KEYWORD") {
        throw this.error(nameTok, `Expected a field name, got '${nameTok.value}'.`);
      }
      const fieldName = nameTok.value;
      this.expect("COLON");
      const typeTok = this.expect("IDENT");
      if (!isFieldType(typeTok.value)) {
        throw this.error(
          typeTok,
          `'${typeTok.value}' is not a field type. Valid types: text, number, boolean, money, email, date.`,
          `Write the field like:  ${fieldName}: text`
        );
      }
      fields.push({ name: fieldName, type: typeTok.value });
      this.skipNewlines();
    }
    this.expect("DEDENT");
    if (fields.length === 0) {
      throw new PlainError(
        `The database '${name}' has no fields. Add at least one, like:  name: text`,
        kw.pos.line,
        kw.pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK }
      );
    }
    return { kind: "DatabaseStmt", name, fields, pos: kw.pos };
  }
  parsePage() {
    const kw = this.next();
    const name = this.expect("STRING").value;
    this.expect("COLON");
    const body = this.parsePageBlock();
    return { kind: "PageStmt", name, body, pos: kw.pos };
  }
  parseTitle() {
    const kw = this.next();
    const value = this.expect("STRING").value;
    return { kind: "TitleStmt", value, pos: kw.pos };
  }
  parseButton() {
    const kw = this.next();
    const label = this.expect("STRING").value;
    this.expect("COLON");
    const body = this.parsePageBlock();
    return { kind: "ButtonStmt", label, body, pos: kw.pos };
  }
  parseShow() {
    const kw = this.next();
    const entity = this.expect("IDENT").value;
    return { kind: "ShowStmt", entity, pos: kw.pos };
  }
  parseState() {
    const kw = this.next();
    const name = this.expect("IDENT").value;
    this.expect("OPERATOR", "=");
    const value = this.parseExpression();
    return { kind: "StateStmt", name, value, pos: kw.pos };
  }
  parseCreate() {
    const kw = this.next();
    const entity = this.expect("IDENT").value;
    return { kind: "CreateStmt", entity, pos: kw.pos };
  }
  /**
   * form "Label" from Entity:
   *     field name: text
   *     field age: number
   */
  parseForm() {
    const kw = this.next();
    const label = this.expect("STRING").value;
    if (this.atKw("from")) {
      this.next();
    } else {
      throw this.error(
        this.peek(),
        `A form needs to know which database it fills. Write:  form "${label}" from Entity:`
      );
    }
    const entity = this.expect("IDENT").value;
    this.expect("COLON");
    this.skipNewlines();
    this.expect("INDENT");
    const fields = [];
    this.skipNewlines();
    while (!this.at("DEDENT") && !this.at("EOF")) {
      if (!this.atKw("field")) {
        throw this.error(
          this.peek(),
          `Inside a form, each line starts with 'field'. Got '${this.peek().value}' instead.`,
          `Write:  field name: text`
        );
      }
      this.next();
      const nameTok = this.next();
      if (nameTok.type !== "IDENT" && nameTok.type !== "KEYWORD") {
        throw this.error(nameTok, `Expected a field name, got '${nameTok.value}'.`);
      }
      this.expect("COLON");
      const typeTok = this.expect("IDENT");
      if (!isFieldType(typeTok.value)) {
        throw this.error(
          typeTok,
          `'${typeTok.value}' is not a field type. Valid types: text, number, boolean, money, email, date.`,
          `Write the field like:  ${nameTok.value}: text`
        );
      }
      fields.push({ name: nameTok.value, type: typeTok.value });
      this.skipNewlines();
    }
    this.expect("DEDENT");
    if (fields.length === 0) {
      throw new PlainError(
        `The form '${label}' has no fields. Add at least one, like:  field name: text`,
        kw.pos.line,
        kw.pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK }
      );
    }
    return { kind: "FormStmt", label, entity, fields, pos: kw.pos };
  }
  /**
   * Page-style block: allows the UI statements (title/show/button/state/create/say/set)
   * and keeps the standard block rules otherwise.
   */
  parsePageBlock() {
    return this.parseBlock();
  }
  parseSay() {
    const kw = this.next();
    const value = this.parseExpression();
    return { kind: "SayStmt", value, pos: kw.pos };
  }
  parseSet() {
    const kw = this.next();
    const name = this.expect("IDENT").value;
    this.expect("OPERATOR", "=");
    const value = this.parseExpression();
    return { kind: "SetStmt", name, value, pos: kw.pos };
  }
  parseIf() {
    const kw = this.next();
    const condition = this.parseExpression();
    this.expect("COLON");
    const then = this.parseBlock();
    this.skipNewlines();
    if (this.atKw("otherwise")) {
      const otherwiseTok = this.peek();
      this.next();
      if (this.atKw("if")) {
        const nested = this.parseIf();
        return { kind: "IfStmt", condition, then, otherwise: nested, pos: kw.pos };
      }
      this.expect("COLON");
      const otherwise = this.parseBlock();
      void otherwiseTok;
      return { kind: "IfStmt", condition, then, otherwise, pos: kw.pos };
    }
    return { kind: "IfStmt", condition, then, pos: kw.pos };
  }
  parseForEach() {
    const kw = this.next();
    this.expect("KEYWORD", "each");
    const varName = this.expect("IDENT").value;
    this.expect("KEYWORD", "in");
    const iterable = this.parseExpression();
    this.expect("COLON");
    const body = this.parseBlock();
    return { kind: "ForEachStmt", varName, iterable, body, pos: kw.pos };
  }
  parseRepeat() {
    const kw = this.next();
    const count = this.parseExpression();
    this.expect("KEYWORD", "times");
    this.expect("COLON");
    const body = this.parseBlock();
    return { kind: "RepeatStmt", count, body, pos: kw.pos };
  }
  parseFunction() {
    const kw = this.next();
    const name = this.expect("IDENT").value;
    this.expect("LPAREN");
    const params = [];
    if (!this.at("RPAREN")) {
      do {
        params.push(this.expect("IDENT").value);
      } while (this.at("COMMA") && (this.next(), true));
    }
    this.expect("RPAREN");
    this.expect("COLON");
    const body = this.parseBlock();
    return { kind: "FunctionDecl", name, params, body, pos: kw.pos };
  }
  parseReturn() {
    const kw = this.next();
    if (this.at("NEWLINE") || this.at("EOF") || this.at("DEDENT")) {
      return { kind: "ReturnStmt", pos: kw.pos };
    }
    const value = this.parseExpression();
    return { kind: "ReturnStmt", value, pos: kw.pos };
  }
  parseBlock() {
    this.skipNewlines();
    this.expect("INDENT");
    const body = [];
    this.skipNewlines();
    while (!this.at("DEDENT") && !this.at("EOF")) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect("DEDENT");
    if (body.length === 0) {
      throw new PlainError(
        "This block is empty. Add at least one indented line after the colon.",
        this.peek().pos.line,
        this.peek().pos.column,
        { code: ERROR_CODES.EMPTY_BLOCK }
      );
    }
    return { kind: "Block", body };
  }
  // ----- expressions (precedence climbing) -----
  parseExpression() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.atKw("or")) {
      const op = this.next();
      const right = this.parseAnd();
      left = { kind: "BinaryExpr", left, operator: "or", right, pos: op.pos };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseEquality();
    while (this.atKw("and")) {
      const op = this.next();
      const right = this.parseEquality();
      left = { kind: "BinaryExpr", left, operator: "and", right, pos: op.pos };
    }
    return left;
  }
  parseEquality() {
    let left = this.parseComparison();
    while (this.at("OPERATOR", "==") || this.at("OPERATOR", "!=")) {
      const op = this.next();
      const right = this.parseComparison();
      left = { kind: "BinaryExpr", left, operator: op.value, right, pos: op.pos };
    }
    return left;
  }
  parseComparison() {
    let left = this.parseAdditive();
    while (this.at("OPERATOR", ">") || this.at("OPERATOR", "<") || this.at("OPERATOR", ">=") || this.at("OPERATOR", "<=")) {
      const op = this.next();
      const right = this.parseAdditive();
      left = { kind: "BinaryExpr", left, operator: op.value, right, pos: op.pos };
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.at("OPERATOR", "+") || this.at("OPERATOR", "-")) {
      const op = this.next();
      const right = this.parseMultiplicative();
      left = { kind: "BinaryExpr", left, operator: op.value, right, pos: op.pos };
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.at("OPERATOR", "*") || this.at("OPERATOR", "/") || this.at("OPERATOR", "%")) {
      const op = this.next();
      const right = this.parseUnary();
      left = { kind: "BinaryExpr", left, operator: op.value, right, pos: op.pos };
    }
    return left;
  }
  parseUnary() {
    if (this.atKw("not")) {
      const op = this.next();
      const operand = this.parseUnary();
      return { kind: "UnaryExpr", operator: "not", operand, pos: op.pos };
    }
    if (this.at("OPERATOR", "-")) {
      const op = this.next();
      const operand = this.parseUnary();
      return { kind: "UnaryExpr", operator: "-", operand, pos: op.pos };
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.at("LPAREN")) {
        this.next();
        const args = [];
        if (!this.at("RPAREN")) {
          do {
            args.push(this.parseExpression());
          } while (this.at("COMMA") && (this.next(), true));
        }
        this.expect("RPAREN");
        expr = { kind: "CallExpr", callee: expr, args, pos: expr.pos };
      } else if (this.at("LBRACKET")) {
        this.next();
        const index = this.parseExpression();
        this.expect("RBRACKET");
        expr = { kind: "IndexExpr", object: expr, index, pos: expr.pos };
      } else {
        break;
      }
    }
    return expr;
  }
  parsePrimary() {
    const t = this.peek();
    if (t.type === "NUMBER") {
      this.next();
      return { kind: "NumberLit", value: Number(t.value), pos: t.pos };
    }
    if (t.type === "STRING") {
      this.next();
      return { kind: "StringLit", value: t.value, pos: t.pos };
    }
    if (t.type === "IDENT") {
      this.next();
      return { kind: "Identifier", name: t.value, pos: t.pos };
    }
    if (this.atKw("true") || this.atKw("false")) {
      this.next();
      return { kind: "BoolLit", value: t.value === "true", pos: t.pos };
    }
    if (this.at("LPAREN")) {
      this.next();
      const expr = this.parseExpression();
      this.expect("RPAREN");
      return expr;
    }
    if (this.at("LBRACKET")) {
      this.next();
      const elements = [];
      if (!this.at("RBRACKET")) {
        do {
          elements.push(this.parseExpression());
        } while (this.at("COMMA") && (this.next(), true));
      }
      this.expect("RBRACKET");
      return { kind: "ListLit", elements, pos: t.pos };
    }
    throw this.error(t, `I expected a value here (a number, text, name, or list) but found ${describeToken(t)}.`);
  }
};
function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
var FIELD_TYPES = /* @__PURE__ */ new Set(["text", "number", "boolean", "money", "email", "date"]);
function isFieldType(word) {
  return FIELD_TYPES.has(word);
}
function describeToken(t) {
  switch (t.type) {
    case "NEWLINE":
      return "the end of the line";
    case "EOF":
      return "the end of the file";
    case "INDENT":
      return "an indented block";
    case "DEDENT":
      return "the end of a block";
    default:
      return `'${t.value}'`;
  }
}

// src/interpreter-types.ts
function isList(v) {
  return typeof v === "object" && v !== null && v.__plain_list === true;
}
function isFunction(v) {
  return typeof v === "object" && v !== null && v.__plain_function === true;
}
function isNative(v) {
  return typeof v === "object" && v !== null && v.__plain_native === true;
}

// src/stdlib.ts
function makeList(items) {
  return { __plain_list: true, items };
}
function describeType(v) {
  if (v === null) return "nothing";
  if (typeof v === "number") return "a number";
  if (typeof v === "string") return "text";
  if (typeof v === "boolean") return "true/false";
  if (isList(v)) return "a list";
  return "a value";
}
function wrongArgCount(name, got, want, pos) {
  throw new PlainError(
    `The function '${name}' needs ${want}, but you gave ${got}.`,
    pos.line,
    pos.column,
    {
      code: ERROR_CODES.WRONG_ARG_COUNT,
      hint: `Correct shape: ${name}(${want.replace(/[^a-z, ]/gi, "").trim()}) \u2014 see 'plainly explain ${name}'.`
    }
  );
}
function checkCount(name, args, count, pos) {
  if (args.length !== count) {
    wrongArgCount(name, args.length, String(count), pos);
  }
}
function requireString(args, i, name, pos) {
  const v = args[i];
  if (typeof v !== "string") {
    throw new PlainError(
      `${name}() needs text in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH }
    );
  }
  return v;
}
function requireNumber(args, i, name, pos) {
  const v = args[i];
  if (typeof v !== "number") {
    throw new PlainError(
      `${name}() needs a number in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH }
    );
  }
  return v;
}
function requireList(args, i, name, pos) {
  const v = args[i];
  if (!isList(v)) {
    throw new PlainError(
      `${name}() needs a list in position ${i + 1}, but you gave ${describeType(v)}.`,
      pos.line,
      pos.column,
      { code: ERROR_CODES.TYPE_MISMATCH }
    );
  }
  return v;
}
function deepEqual(a, b) {
  if (isList(a) && isList(b)) {
    return a.items.length === b.items.length && a.items.every((x, i) => deepEqual(x, b.items[i]));
  }
  return a === b;
}
function formatItem(v) {
  if (v === null) return "nothing";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (isList(v)) return `[${v.items.map((x) => typeof x === "string" ? `"${x}"` : formatItem(x)).join(", ")}]`;
  return "a function";
}
var entries = [
  // ----- text -----
  {
    name: "uppercase",
    signature: "uppercase(text)",
    summary: "Turns text into ALL CAPITALS.",
    example: 'uppercase("hello")  \u2192  "HELLO"',
    fn: (args, pos) => {
      checkCount("uppercase", args, 1, pos);
      return requireString(args, 0, "uppercase", pos).toUpperCase();
    }
  },
  {
    name: "lowercase",
    signature: "lowercase(text)",
    summary: "Turns text into all lowercase.",
    example: 'lowercase("HELLO")  \u2192  "hello"',
    fn: (args, pos) => {
      checkCount("lowercase", args, 1, pos);
      return requireString(args, 0, "lowercase", pos).toLowerCase();
    }
  },
  {
    name: "trim",
    signature: "trim(text)",
    summary: "Removes spaces from the start and end of text.",
    example: 'trim("  hi  ")  \u2192  "hi"',
    fn: (args, pos) => {
      checkCount("trim", args, 1, pos);
      return requireString(args, 0, "trim", pos).trim();
    }
  },
  {
    name: "split",
    signature: "split(text, separator)",
    summary: "Breaks text into a list of pieces wherever the separator appears.",
    example: 'split("a,b,c", ",")  \u2192  ["a", "b", "c"]',
    fn: (args, pos) => {
      checkCount("split", args, 2, pos);
      const text = requireString(args, 0, "split", pos);
      const sep = requireString(args, 1, "split", pos);
      if (sep === "") {
        throw new PlainError(
          `split() needs a separator between the quotes (like "," or " "). An empty separator doesn't say where to break the text.`,
          pos.line,
          pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH, hint: 'Try split(text, ",") or split(text, " ").' }
        );
      }
      return makeList(text.split(sep));
    }
  },
  {
    name: "join",
    signature: "join(list, separator)",
    summary: "Glues a list of values into one piece of text, with the separator between items.",
    example: 'join(["a", "b"], "-")  \u2192  "a-b"',
    fn: (args, pos) => {
      checkCount("join", args, 2, pos);
      const items = requireList(args, 0, "join", pos).items;
      const sep = requireString(args, 1, "join", pos);
      return items.map(formatItem).join(sep);
    }
  },
  {
    name: "contains",
    signature: "contains(where, what)",
    summary: "Checks whether text contains a piece of text, or a list contains a value. Gives true or false.",
    example: 'contains("hello", "ell")  \u2192  true;  contains([1, 2], 2)  \u2192  true',
    fn: (args, pos) => {
      checkCount("contains", args, 2, pos);
      if (typeof args[0] === "string") {
        return args[0].includes(requireString(args, 1, "contains", pos));
      }
      const hay = requireList(args, 0, "contains", pos);
      return hay.items.some((item) => deepEqual(item, args[1]));
    }
  },
  {
    name: "replace",
    signature: "replace(text, from, to)",
    summary: "Replaces every occurrence of some text with different text.",
    example: 'replace("aaa", "a", "b")  \u2192  "bbb"',
    fn: (args, pos) => {
      checkCount("replace", args, 3, pos);
      const text = requireString(args, 0, "replace", pos);
      const from = requireString(args, 1, "replace", pos);
      const to = requireString(args, 2, "replace", pos);
      if (from === "") {
        throw new PlainError(
          "replace() needs something to replace. The second value can't be empty text.",
          pos.line,
          pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH }
        );
      }
      return text.split(from).join(to);
    }
  },
  // ----- numbers -----
  {
    name: "abs",
    signature: "abs(n)",
    summary: "Gives a number without its sign (distance from zero).",
    example: "abs(-5)  \u2192  5",
    fn: (args, pos) => {
      checkCount("abs", args, 1, pos);
      return Math.abs(requireNumber(args, 0, "abs", pos));
    }
  },
  {
    name: "round",
    signature: "round(n)",
    summary: "Rounds a number to the nearest whole number.",
    example: "round(2.6)  \u2192  3",
    fn: (args, pos) => {
      checkCount("round", args, 1, pos);
      return Math.round(requireNumber(args, 0, "round", pos));
    }
  },
  {
    name: "floor",
    signature: "floor(n)",
    summary: "Rounds a number DOWN to the nearest whole number.",
    example: "floor(2.9)  \u2192  2",
    fn: (args, pos) => {
      checkCount("floor", args, 1, pos);
      return Math.floor(requireNumber(args, 0, "floor", pos));
    }
  },
  {
    name: "ceil",
    signature: "ceil(n)",
    summary: "Rounds a number UP to the nearest whole number.",
    example: "ceil(2.1)  \u2192  3",
    fn: (args, pos) => {
      checkCount("ceil", args, 1, pos);
      return Math.ceil(requireNumber(args, 0, "ceil", pos));
    }
  },
  {
    name: "min",
    signature: "min(a, b)",
    summary: "Gives the smaller of two numbers.",
    example: "min(3, 7)  \u2192  3",
    fn: (args, pos) => {
      checkCount("min", args, 2, pos);
      return Math.min(requireNumber(args, 0, "min", pos), requireNumber(args, 1, "min", pos));
    }
  },
  {
    name: "max",
    signature: "max(a, b)",
    summary: "Gives the larger of two numbers.",
    example: "max(3, 7)  \u2192  7",
    fn: (args, pos) => {
      checkCount("max", args, 2, pos);
      return Math.max(requireNumber(args, 0, "max", pos), requireNumber(args, 1, "max", pos));
    }
  },
  // ----- conversion -----
  {
    name: "number",
    signature: "number(value)",
    summary: 'Turns text like "42" into the number 42.',
    example: 'number("3.14")  \u2192  3.14',
    fn: (args, pos) => {
      checkCount("number", args, 1, pos);
      const v = args[0];
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (v.trim() !== "" && !Number.isNaN(n)) return n;
        throw new PlainError(
          `I couldn't turn ${JSON.stringify(v)} into a number.`,
          pos.line,
          pos.column,
          {
            code: ERROR_CODES.TYPE_MISMATCH,
            hint: 'Only text that looks like a number works, like "42" or "3.14".'
          }
        );
      }
      throw new PlainError(
        `You can only turn text into a number, but you gave ${describeType(v)}.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.TYPE_MISMATCH }
      );
    }
  },
  {
    name: "text",
    signature: "text(value)",
    summary: "Turns any value (number, list, true/false) into text.",
    example: 'text(42)  \u2192  "42"',
    fn: (args, pos) => {
      checkCount("text", args, 1, pos);
      return formatItem(args[0]);
    }
  },
  // ----- lists -----
  {
    name: "push",
    signature: "push(list, value)",
    summary: "Adds a value to the end of a list and gives the list back.",
    example: "push(xs, 4)  \u2192  xs is now [1, 2, 3, 4]",
    fn: (args, pos) => {
      checkCount("push", args, 2, pos);
      const list = requireList(args, 0, "push", pos);
      list.items.push(args[1]);
      return list;
    }
  },
  {
    name: "list",
    signature: "list(...)",
    summary: "Makes a new list from any values you give it.",
    example: "list(1, 2, 3)  \u2192  [1, 2, 3]",
    fn: (args) => makeList(args)
  },
  // ----- misc -----
  {
    name: "length",
    signature: "length(value)",
    summary: "Counts the characters in text, or the items in a list.",
    example: 'length("hello")  \u2192  5;  length([1, 2, 3])  \u2192  3',
    fn: (args, pos) => {
      checkCount("length", args, 1, pos);
      const v = args[0];
      if (typeof v === "string") return v.length;
      if (isList(v)) return v.items.length;
      throw new PlainError(
        `You tried to get the length of ${describeType(v)}, but only text and lists have a length.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.TYPE_MISMATCH }
      );
    }
  }
];
var STDLIB_DOCS = entries.map(({ name, signature, summary, example }) => ({
  name,
  signature,
  summary,
  example
}));
function createStdlib() {
  const out = {};
  for (const entry of entries) {
    out[entry.name] = { __plain_native: true, name: entry.name, fn: entry.fn };
  }
  return out;
}

// src/format.ts
function formatValue(v) {
  if (v === null) return "nothing";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (isList(v)) {
    return `[${v.items.map((item) => formatValueInList(item)).join(", ")}]`;
  }
  if (isFunction(v)) return `<function ${v.name}>`;
  if (isNative(v)) return `<function ${v.name}>`;
  return String(v);
}
function formatValueInList(v) {
  if (typeof v === "string") return `"${v}"`;
  return formatValue(v);
}

// src/interpreter.ts
var ReturnSignal = class {
  constructor(value) {
    this.value = value;
  }
  value;
};
var Environment = class {
  constructor(parent = null) {
    this.parent = parent;
  }
  parent;
  vars = /* @__PURE__ */ new Map();
  declare(name, value) {
    this.vars.set(name, value);
  }
  has(name) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) return true;
      env = env.parent;
    }
    return false;
  }
  /** All visible names, walking outward (for did-you-mean suggestions). */
  visibleNames() {
    const names = /* @__PURE__ */ new Set();
    let env = this;
    while (env) {
      for (const n of env.vars.keys()) names.add(n);
      env = env.parent;
    }
    return [...names];
  }
  get(name, pos) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) return env.vars.get(name);
      env = env.parent;
    }
    const suggestion = suggestName(name, allKnownNames(this));
    throw new PlainError(
      `You tried to use '${name}', but it doesn't exist yet.`,
      pos.line,
      pos.column,
      {
        code: ERROR_CODES.UNDEFINED_VARIABLE,
        hint: suggestion ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...` : `Create it first with: set ${name} = ...`
      }
    );
  }
  assign(name, value, pos) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value);
        return;
      }
      env = env.parent;
    }
    const suggestion = suggestName(name, allKnownNames(this));
    throw new PlainError(
      `You tried to change '${name}', but it doesn't exist yet.`,
      pos.line,
      pos.column,
      {
        code: ERROR_CODES.UNDEFINED_VARIABLE,
        hint: suggestion ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...` : `Create it first with: set ${name} = ...`
      }
    );
  }
  /** Assign to the variable if it exists in scope; otherwise declare it here. */
  assignOrDeclare(name, value) {
    let env = this;
    while (env) {
      if (env.vars.has(name)) {
        env.vars.set(name, value);
        return;
      }
      env = env.parent;
    }
    this.vars.set(name, value);
  }
};
function allKnownNames(env) {
  const names = env.visibleNames();
  for (const b of BUILTIN_NAMES) names.push(b);
  return names;
}
function truthy(v) {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (isList(v)) return v.items.length > 0;
  return true;
}
var Interpreter = class {
  constructor(print = (s) => console.log(s)) {
    this.print = print;
    for (const [name, native] of Object.entries(createStdlib())) {
      this.globals.declare(name, native);
    }
  }
  print;
  globals = new Environment();
  callDepth = 0;
  run(program) {
    this.execBlock(program.body, this.globals);
  }
  // ----- statements -----
  execStmt(stmt, env) {
    switch (stmt.kind) {
      case "SayStmt": {
        const value = this.evalExpr(stmt.value, env);
        this.print(formatValue(value));
        return;
      }
      case "SetStmt": {
        const value = this.evalExpr(stmt.value, env);
        env.assignOrDeclare(stmt.name, value);
        return;
      }
      case "IfStmt": {
        if (truthy(this.evalExpr(stmt.condition, env))) {
          this.execBlock(stmt.then.body, env);
        } else if (stmt.otherwise) {
          if (stmt.otherwise.kind === "IfStmt") {
            this.execStmt(stmt.otherwise, env);
          } else {
            this.execBlock(stmt.otherwise.body, env);
          }
        }
        return;
      }
      case "ForEachStmt": {
        const iterable = this.evalExpr(stmt.iterable, env);
        let items;
        if (isList(iterable)) items = [...iterable.items];
        else if (typeof iterable === "string") items = iterable.split("");
        else {
          throw new PlainError(
            `You tried to loop over ${describeType2(iterable)}, but you can only loop over a list or text.`,
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH }
          );
        }
        for (const item of items) {
          const loopEnv = new Environment(env);
          loopEnv.declare(stmt.varName, item);
          this.execBlock(stmt.body.body, loopEnv);
        }
        return;
      }
      case "RepeatStmt": {
        const countVal = this.evalExpr(stmt.count, env);
        if (typeof countVal !== "number" || !Number.isInteger(countVal) || countVal < 0) {
          throw new PlainError(
            `'repeat' needs a whole number of times (0 or more), but you gave ${formatValue(countVal)}.`,
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH }
          );
        }
        for (let i = 0; i < countVal; i++) {
          this.execBlock(stmt.body.body, env);
        }
        return;
      }
      case "FunctionDecl": {
        env.declare(stmt.name, {
          __plain_function: true,
          name: stmt.name,
          params: stmt.params,
          body: stmt.body,
          closure: env
        });
        return;
      }
      case "ReturnStmt": {
        if (this.callDepth === 0) {
          throw new PlainError(
            "'return' can only be used inside a function. Move it inside your function block.",
            stmt.pos.line,
            stmt.pos.column,
            { code: ERROR_CODES.RETURN_OUTSIDE_FUNCTION }
          );
        }
        const value = stmt.value ? this.evalExpr(stmt.value, env) : null;
        throw new ReturnSignal(value);
      }
      case "ExprStmt": {
        this.evalExpr(stmt.expr, env);
        return;
      }
      // ----- application model (v0.3) -----
      // Declarative statements have no runtime effect on the console
      // interpreter; they are carried into PIR by the lowering pass, where
      // backends give them meaning. Page bodies still execute so that
      // button handlers (simulated clicks) run, matching the PIR parity
      // semantics.
      case "AppStmt":
      case "DatabaseStmt":
      case "TitleStmt":
      case "ShowStmt":
      case "CreateStmt":
        return;
      case "PageStmt":
        this.execBlock(stmt.body.body, env);
        return;
      case "StateStmt": {
        const value = this.evalExpr(stmt.value, env);
        env.declare(stmt.name, value);
        return;
      }
      case "ButtonStmt": {
        this.execBlock(stmt.body.body, env);
        return;
      }
      case "FormStmt": {
        return;
      }
    }
  }
  execBlock(body, env) {
    for (const stmt of body) {
      this.execStmt(stmt, env);
    }
  }
  // ----- expressions -----
  evalExpr(expr, env) {
    switch (expr.kind) {
      case "NumberLit":
        return expr.value;
      case "StringLit":
        return expr.value;
      case "BoolLit":
        return expr.value;
      case "ListLit":
        return { __plain_list: true, items: expr.elements.map((e) => this.evalExpr(e, env)) };
      case "Identifier":
        return env.get(expr.name, expr.pos);
      case "UnaryExpr": {
        const v = this.evalExpr(expr.operand, env);
        if (expr.operator === "not") return !truthy(v);
        if (typeof v !== "number") {
          throw new PlainError(
            `You can only negate numbers, but you gave ${describeType2(v)}.`,
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH }
          );
        }
        return -v;
      }
      case "BinaryExpr":
        return this.evalBinary(expr, env);
      case "CallExpr": {
        const callee = this.evalExpr(expr.callee, env);
        const args = expr.args.map((a) => this.evalExpr(a, env));
        if (isFunction(callee)) {
          return this.callFunction(callee, args, expr.pos);
        }
        if (isNative(callee)) {
          return callee.fn(args, expr.pos);
        }
        throw new PlainError(
          "You tried to call something that isn't a function.",
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.NOT_A_FUNCTION }
        );
      }
      case "MemberExpr": {
        throw new PlainError(
          "Accessing properties with '.' is not supported yet in Plainly v0.2.",
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.UNEXPECTED_TOKEN }
        );
      }
      case "IndexExpr": {
        const obj = this.evalExpr(expr.object, env);
        const index = this.evalExpr(expr.index, env);
        if (isList(obj)) {
          if (typeof index !== "number" || !Number.isInteger(index)) {
            throw new PlainError(
              `List positions must be whole numbers, but you gave ${formatValue(index)}.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.TYPE_MISMATCH }
            );
          }
          if (index < 0 || index >= obj.items.length) {
            throw new PlainError(
              `You tried to get position ${index} from a list with ${obj.items.length} item(s). The first position is 0.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.INDEX_OUT_OF_RANGE }
            );
          }
          return obj.items[index];
        }
        if (typeof obj === "string") {
          if (typeof index !== "number" || !Number.isInteger(index)) {
            throw new PlainError(
              `Text positions must be whole numbers, but you gave ${formatValue(index)}.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.TYPE_MISMATCH }
            );
          }
          if (index < 0 || index >= obj.length) {
            throw new PlainError(
              `You tried to get position ${index} from text with ${obj.length} character(s). The first position is 0.`,
              expr.pos.line,
              expr.pos.column,
              { code: ERROR_CODES.INDEX_OUT_OF_RANGE }
            );
          }
          return obj[index];
        }
        throw new PlainError(
          `You tried to reach into ${describeType2(obj)}, but only lists and text can be indexed.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH }
        );
      }
    }
  }
  callFunction(fn, args, pos) {
    if (args.length !== fn.params.length) {
      throw new PlainError(
        `The function '${fn.name}' needs ${fn.params.length} value(s), but you gave ${args.length}.`,
        pos.line,
        pos.column,
        { code: ERROR_CODES.WRONG_ARG_COUNT }
      );
    }
    const callEnv = new Environment(fn.closure);
    fn.params.forEach((p, i) => callEnv.declare(p, args[i]));
    this.callDepth++;
    try {
      this.execBlock(fn.body.body, callEnv);
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value;
      throw err;
    } finally {
      this.callDepth--;
    }
    return null;
  }
  evalBinary(expr, env) {
    if (expr.operator === "and") {
      const left2 = this.evalExpr(expr.left, env);
      return truthy(left2) ? this.evalExpr(expr.right, env) : left2;
    }
    if (expr.operator === "or") {
      const left2 = this.evalExpr(expr.left, env);
      return truthy(left2) ? left2 : this.evalExpr(expr.right, env);
    }
    const left = this.evalExpr(expr.left, env);
    const right = this.evalExpr(expr.right, env);
    switch (expr.operator) {
      case "+": {
        if (typeof left === "number" && typeof right === "number") return left + right;
        if (typeof left === "string" || typeof right === "string") {
          return formatValue(left) + formatValue(right);
        }
        if (isList(left) && isList(right)) {
          return { __plain_list: true, items: [...left.items, ...right.items] };
        }
        throw new PlainError(
          `You tried to add ${describeType2(left)} and ${describeType2(right)}. Numbers add, text joins, lists combine.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.INVALID_OPERATION }
        );
      }
      case "-":
      case "*":
      case "/":
      case "%": {
        if (typeof left !== "number" || typeof right !== "number") {
          throw new PlainError(
            `You tried to use '${expr.operator}' on ${describeType2(left)} and ${describeType2(right)}. These operators need numbers.`,
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.TYPE_MISMATCH }
          );
        }
        if (expr.operator === "/" && right === 0) {
          throw new PlainError(
            "You tried to divide by zero. Check the value you're dividing by.",
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.DIVIDE_BY_ZERO }
          );
        }
        if (expr.operator === "%" && right === 0) {
          throw new PlainError(
            "You tried to take the remainder by zero. Check the value you're dividing by.",
            expr.pos.line,
            expr.pos.column,
            { code: ERROR_CODES.DIVIDE_BY_ZERO }
          );
        }
        if (expr.operator === "-") return left - right;
        if (expr.operator === "*") return left * right;
        if (expr.operator === "/") return left / right;
        return left % right;
      }
      case ">":
      case "<":
      case ">=":
      case "<=": {
        if (typeof left === "number" && typeof right === "number") {
          switch (expr.operator) {
            case ">":
              return left > right;
            case "<":
              return left < right;
            case ">=":
              return left >= right;
            case "<=":
              return left <= right;
          }
        }
        if (typeof left === "string" && typeof right === "string") {
          switch (expr.operator) {
            case ">":
              return left > right;
            case "<":
              return left < right;
            case ">=":
              return left >= right;
            case "<=":
              return left <= right;
          }
        }
        throw new PlainError(
          `You tried to compare ${describeType2(left)} with ${describeType2(right)} using '${expr.operator}'. Compare two numbers or two pieces of text.`,
          expr.pos.line,
          expr.pos.column,
          { code: ERROR_CODES.TYPE_MISMATCH }
        );
      }
      case "==":
        return valuesEqual(left, right);
      case "!=":
        return !valuesEqual(left, right);
    }
  }
};
function valuesEqual(left, right) {
  if (isList(left) && isList(right)) {
    if (left.items.length !== right.items.length) return false;
    return left.items.every((item, i) => valuesEqual(item, right.items[i]));
  }
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (typeof left === "string" && typeof right === "string") return left === right;
  if (typeof left === "boolean" && typeof right === "boolean") return left === right;
  if (left === null && right === null) return true;
  return false;
}
function describeType2(v) {
  if (v === null) return "nothing";
  if (typeof v === "number") return "a number";
  if (typeof v === "string") return "text";
  if (typeof v === "boolean") return "true/false";
  if (isList(v)) return "a list";
  if (isFunction(v) || isNative(v)) return "a function";
  return "a value";
}

// src/analyzer.ts
var BUILTIN_ARITY = {
  uppercase: 1,
  lowercase: 1,
  trim: 1,
  split: 2,
  join: 2,
  contains: 2,
  replace: 3,
  abs: 1,
  round: 1,
  floor: 1,
  ceil: 1,
  min: 2,
  max: 2,
  number: 1,
  text: 1,
  push: 2,
  list: null,
  length: 1
};
var Scope = class {
  constructor(parent = null) {
    this.parent = parent;
  }
  parent;
  names = /* @__PURE__ */ new Map();
  declare(decl) {
    const list = this.names.get(decl.name) ?? [];
    list.push(decl);
    this.names.set(decl.name, list);
  }
  /** The most recent visible declaration of `name`, walking outward. */
  find(name) {
    let scope = this;
    while (scope) {
      const list = scope.names.get(name);
      if (list && list.length > 0) return list[list.length - 1];
      scope = scope.parent;
    }
    return null;
  }
  visibleNames() {
    const names = /* @__PURE__ */ new Set();
    let scope = this;
    while (scope) {
      for (const n of scope.names.keys()) names.add(n);
      scope = scope.parent;
    }
    for (const b of BUILTIN_NAMES) names.add(b);
    return [...names];
  }
  allDeclarations() {
    const out = [];
    let scope = this;
    while (scope) {
      for (const list of scope.names.values()) out.push(...list);
      scope = scope.parent;
    }
    return out;
  }
};
function analyze(program) {
  const diagnostics = [];
  const globalScope = new Scope();
  const functions = /* @__PURE__ */ new Map();
  const unusedCandidates = [];
  const error = (code, message, pos, hint) => {
    diagnostics.push({ code, severity: "error", message, hint, pos, length: 1 });
  };
  const warn = (code, message, pos, hint) => {
    diagnostics.push({ code, severity: "warning", message, hint, pos, length: 1 });
  };
  function readName(name, pos, scope) {
    const decl = scope.find(name);
    if (decl) {
      decl.used = true;
      return;
    }
    const isBuiltin = BUILTIN_NAMES.includes(name);
    if (!isBuiltin) {
      const suggestion = suggestName(name, scope.visibleNames());
      error(
        ERROR_CODES.UNDEFINED_VARIABLE,
        `You tried to use '${name}', but it doesn't exist yet.`,
        pos,
        suggestion ? `Did you mean '${suggestion}'? If not, create it first with: set ${name} = ...` : `Create it first with: set ${name} = ...`
      );
    }
  }
  function checkCallArity(name, argCount, pos) {
    const fn = functions.get(name);
    if (fn) {
      if (argCount !== fn.params) {
        error(
          ERROR_CODES.WRONG_ARG_COUNT,
          `The function '${name}' needs ${fn.params} value(s), but you gave ${argCount}.`,
          pos,
          `Write it as ${name}(${Array.from({ length: fn.params }, (_, i) => `value${i + 1}`).join(", ")}) \u2014 or check the function's parameters.`
        );
      }
      return;
    }
    if (BUILTIN_NAMES.includes(name)) {
      const arity = BUILTIN_ARITY[name];
      if (arity !== null && arity !== void 0 && argCount !== arity) {
        error(
          ERROR_CODES.WRONG_ARG_COUNT,
          `The function '${name}' needs ${arity} value(s), but you gave ${argCount}.`,
          pos,
          `Correct shape: ${name}(${(BUILTIN_ARITY[name] ?? 0) >= 0 && arity !== null ? hintParams(name, arity) : "..."}) \u2014 see 'plainly explain ${name}'.`
        );
      }
    }
  }
  function hintParams(name, arity) {
    const shapes = {
      split: "text, separator",
      join: "list, separator",
      contains: "where, what",
      replace: "text, from, to",
      min: "a, b",
      max: "a, b",
      push: "list, value",
      uppercase: "text",
      lowercase: "text",
      trim: "text",
      abs: "n",
      round: "n",
      floor: "n",
      ceil: "n",
      number: "value",
      text: "value",
      length: "value"
    };
    return shapes[name] ?? Array.from({ length: arity }, (_, i) => `value${i + 1}`).join(", ");
  }
  const context = {
    appName: null,
    entities: /* @__PURE__ */ new Set(),
    pages: /* @__PURE__ */ new Set(),
    inPage: false
  };
  const entityFieldMap = /* @__PURE__ */ new Map();
  function execStmt(stmt, scope, inFunction) {
    switch (stmt.kind) {
      case "SayStmt":
        walkExpr(stmt.value, scope, inFunction);
        return;
      case "SetStmt": {
        walkExpr(stmt.value, scope, inFunction);
        const existing = scope.find(stmt.name);
        if (existing) {
        } else {
          const decl = { name: stmt.name, kind: "variable", line: stmt.pos.line, used: false };
          scope.declare(decl);
          unusedCandidates.push(decl);
        }
        return;
      }
      case "IfStmt":
        walkExpr(stmt.condition, scope, inFunction);
        for (const s of stmt.then.body) execStmt(s, scope, inFunction);
        if (stmt.otherwise) {
          if (stmt.otherwise.kind === "IfStmt") {
            execStmt(stmt.otherwise, scope, inFunction);
          } else {
            for (const s of stmt.otherwise.body) execStmt(s, scope, inFunction);
          }
        }
        return;
      case "ForEachStmt": {
        walkExpr(stmt.iterable, scope, inFunction);
        const loopScope = new Scope(scope);
        const loopDecl = { name: stmt.varName, kind: "loop-var", line: stmt.pos.line, used: false };
        loopScope.declare(loopDecl);
        unusedCandidates.push(loopDecl);
        for (const s of stmt.body.body) execStmt(s, loopScope, inFunction);
        return;
      }
      case "RepeatStmt":
        walkExpr(stmt.count, scope, inFunction);
        for (const s of stmt.body.body) execStmt(s, scope, inFunction);
        return;
      case "FunctionDecl": {
        const seen = /* @__PURE__ */ new Set();
        for (const p of stmt.params) {
          if (seen.has(p)) {
            error(
              ERROR_CODES.DUPLICATE_PARAMETER,
              `The function '${stmt.name}' has two parameters both named '${p}'. Give each parameter a different name.`,
              stmt.pos,
              `For example: function ${stmt.name}(first${stmt.params.length > 1 ? ", second" : ""}):`
            );
          }
          seen.add(p);
        }
        functions.set(stmt.name, { params: stmt.params.length });
        scope.declare({ name: stmt.name, kind: "function", line: stmt.pos.line, used: true });
        const fnScope = new Scope(scope);
        for (const p of stmt.params) fnScope.declare({ name: p, kind: "param", line: stmt.pos.line, used: false });
        for (const s of stmt.body.body) execStmt(s, fnScope, true);
        return;
      }
      case "ReturnStmt":
        if (!inFunction) {
          error(
            ERROR_CODES.RETURN_OUTSIDE_FUNCTION,
            "'return' can only be used inside a function. Move it inside your function block.",
            stmt.pos
          );
        }
        if (stmt.value) walkExpr(stmt.value, scope, inFunction);
        return;
      case "ExprStmt":
        walkExpr(stmt.expr, scope, inFunction);
        return;
      // ----- application model (v0.3) -----
      case "AppStmt": {
        if (context.appName !== null) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `The app is already named '${context.appName}'. There can be only one app declaration.`,
            stmt.pos
          );
        }
        context.appName = stmt.name;
        return;
      }
      case "DatabaseStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The database '${stmt.name}' must come after an app declaration. Start your file with:  app "My App"`,
            stmt.pos
          );
        }
        if (context.entities.has(stmt.name)) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `There are two databases named '${stmt.name}'. Give each one a different name.`,
            stmt.pos
          );
        }
        context.entities.add(stmt.name);
        entityFieldMap.set(stmt.name, new Set(stmt.fields.map((f) => f.name)));
        return;
      }
      case "PageStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The page '${stmt.name}' must come after an app declaration. Start your file with:  app "My App"`,
            stmt.pos
          );
        }
        if (context.pages.has(stmt.name)) {
          error(
            ERROR_CODES.DUPLICATE_DECL,
            `There are two pages named '${stmt.name}'. Page names must be unique.`,
            stmt.pos
          );
        }
        context.pages.add(stmt.name);
        const wasInPage = context.inPage;
        context.inPage = true;
        for (const s of stmt.body.body) execStmt(s, scope, inFunction);
        context.inPage = wasInPage;
        return;
      }
      case "TitleStmt":
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            "'title' can only be used inside a page.",
            stmt.pos,
            'Move this line inside a page block:  page "Home":\n  title "\u2026"'
          );
        }
        return;
      case "ButtonStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The button '${stmt.label}' must be inside a page. Buttons live inside page blocks.`,
            stmt.pos
          );
        }
        for (const s of stmt.body.body) execStmt(s, scope, inFunction);
        return;
      }
      case "ShowStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            "'show' can only be used inside a page.",
            stmt.pos
          );
        }
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.UNKNOWN_ENTITY,
            `You tried to show '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0 ? `Databases in this app: ${[...context.entities].join(", ")}.` : `Declare it first:  database ${stmt.entity}:
  name: text`
          );
        }
        return;
      }
      case "FormStmt": {
        if (context.appName === null) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The form '${stmt.label}' must be inside an app. Start your file with:  app "My App"`,
            stmt.pos
          );
        }
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.FORM_WITHOUT_ENTITY,
            `The form '${stmt.label}' fills '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0 ? `Databases in this app: ${[...context.entities].join(", ")}.` : `Declare it first:
  database ${stmt.entity}:
    name: text`
          );
        }
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `The form '${stmt.label}' must be inside a page. Move it into a page block.`,
            stmt.pos
          );
        }
        const entityFields = entityFieldMap.get(stmt.entity);
        for (const f of stmt.fields) {
          if (entityFields && !entityFields.has(f.name)) {
            error(
              ERROR_CODES.UNKNOWN_FORM_FIELD,
              `The form field '${f.name}' does not exist in the database '${stmt.entity}'.`,
              stmt.pos,
              entityFields.size > 0 ? `Fields in ${stmt.entity}: ${[...entityFields].join(", ")}.` : `Add it to the database first:  database ${stmt.entity}:
    ${f.name}: ${f.type}`
            );
          }
        }
        return;
      }
      case "CreateStmt": {
        if (!context.entities.has(stmt.entity)) {
          error(
            ERROR_CODES.UNKNOWN_ENTITY,
            `You tried to create a '${stmt.entity}', but there is no database with that name.`,
            stmt.pos,
            context.entities.size > 0 ? `Databases in this app: ${[...context.entities].join(", ")}.` : `Declare it first:  database ${stmt.entity}:
  name: text`
          );
        }
        return;
      }
      case "StateStmt": {
        if (!context.inPage) {
          error(
            ERROR_CODES.BAD_PLACEMENT,
            `'state' can only be used inside a page. Move 'state ${stmt.name} = \u2026' into a page block.`,
            stmt.pos
          );
        }
        walkExpr(stmt.value, scope, inFunction);
        if (!scope.find(stmt.name)) {
          const decl = { name: stmt.name, kind: "variable", line: stmt.pos.line, used: false };
          scope.declare(decl);
          unusedCandidates.push(decl);
        }
        return;
      }
    }
  }
  function walkExpr(expr, scope, inFunction) {
    switch (expr.kind) {
      case "Identifier":
        readName(expr.name, expr.pos, scope);
        return;
      case "NumberLit":
      case "StringLit":
      case "BoolLit":
        return;
      case "ListLit":
        for (const e of expr.elements) walkExpr(e, scope, inFunction);
        return;
      case "UnaryExpr":
        walkExpr(expr.operand, scope, inFunction);
        return;
      case "BinaryExpr":
        walkExpr(expr.left, scope, inFunction);
        walkExpr(expr.right, scope, inFunction);
        return;
      case "CallExpr": {
        if (expr.callee.kind === "Identifier") {
          readName(expr.callee.name, expr.callee.pos, scope);
          checkCallArity(expr.callee.name, expr.args.length, expr.pos);
        } else {
          walkExpr(expr.callee, scope, inFunction);
        }
        for (const a of expr.args) walkExpr(a, scope, inFunction);
        return;
      }
      case "IndexExpr":
        walkExpr(expr.object, scope, inFunction);
        walkExpr(expr.index, scope, inFunction);
        return;
      case "MemberExpr":
        walkExpr(expr.object, scope, inFunction);
        return;
    }
  }
  for (const stmt of program.body) execStmt(stmt, globalScope, false);
  for (const decl of unusedCandidates) {
    if (decl.used) continue;
    if (decl.kind === "loop-var") {
      warn(
        ERROR_CODES.UNUSED_VARIABLE,
        `The loop variable '${decl.name}' is never used inside the loop.`,
        { line: decl.line, column: 1 },
        `Either use '${decl.name}' inside the loop, or use 'repeat N times:' if you don't need the value.`
      );
    } else {
      warn(
        ERROR_CODES.UNUSED_VARIABLE,
        `You set '${decl.name}' but never use it.`,
        { line: decl.line, column: 1 },
        `Remove this line, or use '${decl.name}' somewhere below.`
      );
    }
  }
  diagnostics.sort((a, b) => a.pos.line - b.pos.line || a.pos.column - b.pos.column);
  return { diagnostics };
}

// src/pir/ir.ts
function makeValueRefTemp(name, type = "unknown") {
  return { kind: "temp", name, type };
}
function makeValueRefVar(name, type = "unknown") {
  return { kind: "var", name, type };
}
function makeValueRefConst(value) {
  return { kind: "const", value, type: typeof value === "number" ? "number" : typeof value === "string" ? "string" : typeof value === "boolean" ? "boolean" : Array.isArray(value) ? "list" : value === null ? "null" : "unknown" };
}
function makeEntity(name, fields) {
  return {
    name,
    fields: fields.map((f) => ({
      name: f.name,
      type: f.type,
      pirType: f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string"
    }))
  };
}

// src/pir/builder.ts
var PIRBuilder = class {
  constructor(moduleName, functionName = "main", parameters = []) {
    this.moduleName = moduleName;
    this.functionName = functionName;
    this.parameters = parameters;
    this.entry = { label: "entry", ops: [] };
    this.scopes.push({ block: this.entry, ended: false });
  }
  moduleName;
  functionName;
  parameters;
  tempCounter = 0;
  /** Every temp value that was allocated but not yet attached to an op. */
  danglingTemps = /* @__PURE__ */ new Set();
  scopes = [];
  entry;
  /** Temp numbering, shared between a builder and its detached children. */
  getTempCount() {
    return this.tempCounter;
  }
  setTempCount(n) {
    this.tempCounter = n;
  }
  // ----- structure -----
  get currentBlock() {
    return this.scopes[this.scopes.length - 1].block;
  }
  get currentOps() {
    return this.currentBlock.ops;
  }
  beginBlock(label) {
    this.scopes.push({ block: { label, ops: [] }, ended: false });
  }
  endBlock() {
    const scope = this.scopes.pop();
    if (!scope) throw new Error("PIRBuilder: endBlock() with no open block");
    scope.ended = true;
    const parent = this.scopes[this.scopes.length - 1];
    if (parent) {
      parent.block.ops.push({
        op: "jump",
        // structural marker; printer renders this as a block
        operands: [],
        attrs: { __block: true, label: scope.block.label }
        // nested ops are carried via a side table on the function
      });
      this.nestedBlocks.push(scope.block);
    }
    return scope.block;
  }
  /** Nested blocks accumulated during building, attached to the function. */
  nestedBlocks = [];
  // ----- temporaries -----
  /** Allocate a fresh temp. Call attachTemp() when its op is emitted. */
  newTemp() {
    const name = `%${this.tempCounter++}`;
    this.danglingTemps.add(name);
    return name;
  }
  /** Mark a temp as produced by its defining op (cleared from dangling). */
  attachTemp(name) {
    this.danglingTemps.delete(name);
  }
  peekTemp() {
    return `%${this.tempCounter}`;
  }
  // ----- core ops -----
  /** Emit a constant; returns its ref. Constants get a result temp so the
   *  interpreter tracks them like every other value-producing op. */
  const(value, pos) {
    const result = this.newTemp();
    this.emit({ op: "const", operands: [makeValueRefConst(value)], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, typeOfConst(value));
  }
  load(name, pos, type = "unknown") {
    const result = this.newTemp();
    this.emit({ op: "load", operands: [makeValueRefVar(name, type)], result, pos });
    return makeValueRefTemp(result, type);
  }
  store(name, value, pos) {
    this.emit({ op: "store", operands: [makeValueRefVar(name), value], pos });
  }
  binary(op, left, right, pos) {
    const result = this.newTemp();
    this.emit({ op, operands: [left, right], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, OP_PRODUCES[op] ?? "unknown");
  }
  unary(op, operand, pos) {
    const result = this.newTemp();
    this.emit({ op, operands: [operand], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, OP_PRODUCES[op] ?? "unknown");
  }
  callBuiltin(name, args, pos) {
    const result = this.newTemp();
    this.emit({ op: "call", operands: args, result, attrs: { callee: name }, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "unknown");
  }
  callUser(name, args, pos) {
    const result = this.newTemp();
    this.emit({ op: "call_user", operands: args, result, attrs: { callee: name }, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "unknown");
  }
  return(value, pos) {
    this.emit({ op: "return", operands: value ? [value] : [], pos });
  }
  print(value, pos) {
    this.emit({ op: "print", operands: [value], pos });
  }
  makeList(items, pos) {
    const result = this.newTemp();
    this.emit({ op: "make_list", operands: items, result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "list");
  }
  index(object, i, pos) {
    const result = this.newTemp();
    this.emit({ op: "index", operands: [object, i], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "unknown");
  }
  lengthOf(value, pos) {
    const result = this.newTemp();
    this.emit({ op: "length", operands: [value], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "number");
  }
  // ----- app model ops -----
  appCreate(name, pos) {
    this.emit({ op: "app.create", operands: [makeValueRefConst(name)], pos });
  }
  dbEntity(name, fields, pos) {
    this.emit({
      op: "db.entity",
      operands: [makeValueRefConst(name)],
      attrs: {
        entity: name,
        fields: fields.map((f) => `${f.name}:${f.type}`)
      },
      pos
    });
  }
  uiPage(name, pos) {
    this.emit({ op: "ui.page", operands: [makeValueRefConst(name)], attrs: { page: name }, pos });
  }
  uiTitle(text, pos) {
    this.emit({ op: "ui.title", operands: [makeValueRefConst(text)], pos });
  }
  uiButton(label, pos) {
    this.emit({ op: "ui.button", operands: [makeValueRefConst(label)], attrs: { label }, pos });
  }
  uiShow(entity, pos) {
    this.emit({ op: "ui.show", operands: [makeValueRefConst(entity)], pos });
  }
  uiText(text, pos) {
    this.emit({ op: "ui.text", operands: [makeValueRefConst(text)], pos });
  }
  stateCreate(name, value, pos) {
    this.emit({ op: "state.create", operands: [makeValueRefConst(name), value], pos });
  }
  stateGet(name, pos) {
    const result = this.newTemp();
    this.emit({ op: "state.get", operands: [makeValueRefConst(name)], result, pos });
    this.attachTemp(result);
    return makeValueRefTemp(result, "unknown");
  }
  stateSet(name, value, pos) {
    this.emit({ op: "state.set", operands: [makeValueRefConst(name), value], pos });
  }
  eventClick(pos) {
    this.emit({ op: "event.click", operands: [], pos });
  }
  dbCreate(entity, pos) {
    this.emit({ op: "db.create", operands: [makeValueRefConst(entity)], pos });
  }
  // ----- form ops (v0.4) -----
  formCreate(label, entity, pos) {
    this.emit({
      op: "form.create",
      operands: [makeValueRefConst(label)],
      attrs: { label, entity },
      pos
    });
  }
  formField(name, type, pos) {
    this.emit({ op: "form.field", operands: [makeValueRefConst(name)], attrs: { name, type }, pos });
  }
  formSubmit(entity, fields, pos) {
    this.emit({ op: "form.submit", operands: [makeValueRefConst(entity)], attrs: { entity, fields }, pos });
  }
  // ----- internals -----
  emit(op) {
    this.currentOps.push(op);
  }
};
function typeOfConst(v) {
  if (v === null) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "list";
  return "unknown";
}
var OP_PRODUCES = {
  add: "number",
  sub: "number",
  mul: "number",
  div: "number",
  mod: "number",
  neg: "number",
  not: "boolean",
  eq: "boolean",
  ne: "boolean",
  gt: "boolean",
  lt: "boolean",
  ge: "boolean",
  le: "boolean",
  and: "boolean",
  or: "boolean",
  length: "number",
  join_text: "string",
  make_list: "list"
};

// src/pir/operations.ts
function binaryOpToOpcode(op) {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "%":
      return "mod";
    case "==":
      return "eq";
    case "!=":
      return "ne";
    case ">":
      return "gt";
    case "<":
      return "lt";
    case ">=":
      return "ge";
    case "<=":
      return "le";
    case "and":
      return "and";
    case "or":
      return "or";
    default:
      return null;
  }
}

// src/pir/lowering/ast-to-pir.ts
var FORMAT_PRODUCTIONS = {
  eq: "eq",
  ne: "ne",
  gt: "gt",
  lt: "lt",
  ge: "ge",
  le: "le"
};
var LoweringError = class extends PlainError {
  constructor(message, line, column, hint) {
    super(message, line, column, { code: ERROR_CODES.INVALID_OPERATION, hint });
  }
};
function lowerProgram(program) {
  const lowerer = new Lowerer(program);
  return lowerer.lower();
}
var Lowerer = class {
  constructor(program) {
    this.program = program;
    this.main = new PIRBuilder("main");
    this.current = this.main;
  }
  program;
  main;
  functions = [];
  entities = [];
  appName = null;
  current;
  fnStack = [];
  userFunctions = /* @__PURE__ */ new Map();
  /** Names declared via `state` — reads/writes lower to state.get/state.set. */
  stateVars = /* @__PURE__ */ new Set();
  lower() {
    for (const stmt of this.program.body) {
      this.execStmt(stmt);
    }
    this.current.return(null);
    const mainFn = {
      name: "main",
      parameters: [],
      blocks: [{ label: "entry", ops: this.main.currentBlock.ops }]
    };
    this.functions.unshift(mainFn);
    const module = {
      kind: "IRModule",
      version: "0.3",
      name: this.appName ?? "main",
      entities: this.entities,
      functions: this.functions
    };
    if (this.appName) module.app = { name: this.appName };
    return module;
  }
  // ----- statements -----
  execStmt(stmt) {
    switch (stmt.kind) {
      case "SayStmt": {
        const v = this.evalExpr(stmt.value);
        this.current.print(v, stmt.pos);
        return;
      }
      case "SetStmt": {
        const v = this.evalExpr(stmt.value);
        if (this.stateVars.has(stmt.name)) {
          this.current.stateSet(stmt.name, v, stmt.pos);
        } else {
          this.current.store(stmt.name, v, stmt.pos);
        }
        return;
      }
      case "IfStmt":
        this.lowerIf(stmt);
        return;
      case "ForEachStmt":
        this.lowerForEach(stmt);
        return;
      case "RepeatStmt":
        this.lowerRepeat(stmt);
        return;
      case "FunctionDecl":
        this.lowerFunction(stmt);
        return;
      case "ReturnStmt": {
        const v = stmt.value ? this.evalExpr(stmt.value) : null;
        this.current.return(v, stmt.pos);
        return;
      }
      case "ExprStmt": {
        this.evalExpr(stmt.expr);
        return;
      }
      // ----- app model -----
      case "AppStmt": {
        this.appName = stmt.name;
        this.current.appCreate(stmt.name, stmt.pos);
        return;
      }
      case "DatabaseStmt": {
        this.entities.push(makeEntity(stmt.name, stmt.fields));
        this.current.dbEntity(stmt.name, stmt.fields, stmt.pos);
        return;
      }
      case "PageStmt": {
        this.current.uiPage(stmt.name, stmt.pos);
        for (const s of stmt.body.body) this.execStmt(s);
        return;
      }
      case "TitleStmt":
        this.current.uiTitle(stmt.value, stmt.pos);
        return;
      case "ButtonStmt": {
        this.current.uiButton(stmt.label, stmt.pos);
        const handlerOps = this.lowerDetached(stmt.body.body, "event.click");
        this.current.currentOps.push({ op: "event.click", operands: [], attrs: { __body: handlerOps }, pos: stmt.pos });
        return;
      }
      case "ShowStmt":
        this.current.uiShow(stmt.entity, stmt.pos);
        return;
      case "StateStmt": {
        const v = this.evalExpr(stmt.value);
        this.stateVars.add(stmt.name);
        this.current.stateCreate(stmt.name, v, stmt.pos);
        return;
      }
      case "CreateStmt":
        this.current.dbCreate(stmt.entity, stmt.pos);
        return;
      case "FormStmt": {
        this.current.formCreate(stmt.label, stmt.entity, stmt.pos);
        for (const f of stmt.fields) this.current.formField(f.name, f.type, stmt.pos);
        this.current.formSubmit(stmt.entity, stmt.fields.map((f) => f.name), stmt.pos);
        return;
      }
    }
  }
  // ----- control flow -----
  lowerIf(stmt) {
    const cond = this.evalExpr(stmt.condition);
    const thenOps = this.lowerDetached(stmt.then.body, "if.then");
    this.current.currentOps.push({
      op: "jump_if_false",
      operands: [cond],
      attrs: { __body: thenOps },
      pos: stmt.pos
    });
    if (stmt.otherwise) {
      if (stmt.otherwise.kind === "IfStmt") {
        const elseOps = [];
        const prev = this.current;
        const detached = new PIRBuilder(this.current.moduleName);
        detached.setTempCount(prev.getTempCount());
        this.current = detached;
        this.lowerIf(stmt.otherwise);
        prev.setTempCount(detached.getTempCount());
        elseOps.push(...detached.currentBlock.ops);
        this.current = prev;
        const negated = this.negateRef(cond);
        this.current.currentOps.push({
          op: "jump_if_false",
          operands: [negated],
          attrs: { __body: elseOps, else: true },
          pos: stmt.pos
        });
      } else {
        const elseOps = this.lowerDetached(stmt.otherwise.body, "if.else");
        const negated = this.negateRef(cond);
        this.current.currentOps.push({
          op: "jump_if_false",
          operands: [negated],
          attrs: { __body: elseOps, else: true },
          pos: stmt.pos
        });
      }
    }
  }
  /** Emit a `not` op producing a fresh temp holding !ref. */
  negateRef(ref) {
    return this.current.unary("not", ref);
  }
  /** Lower statements into a detached builder, returning its ops. */
  lowerDetached(stmts, label) {
    const prev = this.current;
    const detached = new PIRBuilder(this.current.moduleName);
    detached.setTempCount(prev.getTempCount());
    this.current = detached;
    for (const s of stmts) this.execStmt(s);
    prev.setTempCount(detached.getTempCount());
    this.current = prev;
    return detached.currentBlock.ops;
  }
  lowerForEach(stmt) {
    const iterable = this.evalExpr(stmt.iterable);
    const bodyOps = this.lowerDetached(stmt.body.body, "loop.each");
    this.current.currentOps.push({
      op: "jump_if_true",
      operands: [iterable],
      attrs: { forEach: stmt.varName, __body: bodyOps },
      pos: stmt.pos
    });
  }
  lowerRepeat(stmt) {
    const count = this.evalExpr(stmt.count);
    const bodyOps = this.lowerDetached(stmt.body.body, "loop.repeat");
    this.current.currentOps.push({
      op: "jump_if_true",
      operands: [count],
      attrs: { repeat: true, __body: bodyOps },
      pos: stmt.pos
    });
  }
  lowerFunction(stmt) {
    this.userFunctions.set(stmt.name, { params: stmt.params });
    const builder = new PIRBuilder("main", stmt.name, stmt.params);
    const fnCtx = { name: stmt.name, parameters: stmt.params, builder, loopVars: [] };
    this.fnStack.push(fnCtx);
    const prev = this.current;
    this.current = builder;
    for (const s of stmt.body.body) this.execStmt(s);
    this.current.return(null);
    this.current = prev;
    this.fnStack.pop();
    this.functions.push({
      name: stmt.name,
      parameters: stmt.params,
      blocks: [{ label: "entry", ops: builder.currentBlock.ops }]
    });
  }
  // ----- expressions -----
  evalExpr(expr) {
    switch (expr.kind) {
      case "NumberLit":
        return this.current.const(expr.value, expr.pos);
      case "StringLit":
        return this.current.const(expr.value, expr.pos);
      case "BoolLit":
        return this.current.const(expr.value, expr.pos);
      case "ListLit":
        return this.current.makeList(expr.elements.map((e) => this.evalExpr(e)), expr.pos);
      case "Identifier":
        if (this.stateVars.has(expr.name)) {
          return this.current.stateGet(expr.name, expr.pos);
        }
        return this.current.load(expr.name, expr.pos);
      case "UnaryExpr": {
        const operand = this.evalExpr(expr.operand);
        return this.current.unary(expr.operator === "-" ? "neg" : "not", operand, expr.pos);
      }
      case "BinaryExpr":
        return this.lowerBinary(expr);
      case "CallExpr": {
        const args = expr.args.map((a) => this.evalExpr(a));
        if (expr.callee.kind === "Identifier") {
          const name = expr.callee.name;
          if (this.userFunctions.has(name)) {
            return this.current.callUser(name, args, expr.pos);
          }
          return this.current.callBuiltin(name, args, expr.pos);
        }
        throw new LoweringError(
          "Only direct function calls are supported in PIR v0.3.",
          expr.pos.line,
          expr.pos.column
        );
      }
      case "IndexExpr": {
        const obj = this.evalExpr(expr.object);
        const idx = this.evalExpr(expr.index);
        return this.current.index(obj, idx, expr.pos);
      }
      case "MemberExpr":
        throw new LoweringError(
          "Property access is not supported in PIR v0.3.",
          expr.pos.line,
          expr.pos.column
        );
    }
  }
  lowerBinary(expr) {
    const left = this.evalExpr(expr.left);
    const right = this.evalExpr(expr.right);
    const opcode = binaryOpToOpcode(expr.operator);
    if (!opcode) {
      throw new LoweringError(
        `Operator '${expr.operator}' cannot be lowered to PIR.`,
        expr.pos.line,
        expr.pos.column
      );
    }
    if (expr.operator === "and" || expr.operator === "or") {
      return this.current.binary(opcode, left, right, expr.pos);
    }
    if (expr.operator === "+") {
      return this.current.binary("add", left, right, expr.pos);
    }
    void FORMAT_PRODUCTIONS;
    return this.current.binary(opcode, left, right, expr.pos);
  }
};

// src/pir/index.ts
function compileToPir(source) {
  const ast = compileToAst(source);
  return lowerProgram(ast);
}

// src/index.ts
function diagnosticToError(d) {
  return new PlainError(d.message, d.pos.line, d.pos.column, {
    code: d.code,
    hint: d.hint,
    length: d.length
  });
}
function compileToAst(source) {
  const tokens = tokenize(source);
  return parse(tokens);
}
function checkSource(source) {
  const ast = compileToAst(source);
  const { diagnostics } = analyze(ast);
  return { ok: diagnostics.every((d) => d.severity !== "error"), diagnostics, ast };
}
function runSource(source, print, options) {
  if (!options?.skipAnalysis) {
    const check = checkSource(source);
    const errors = check.diagnostics.filter((d) => d.severity === "error");
    const warnings = check.diagnostics.filter((d) => d.severity === "warning");
    if (errors.length > 0) {
      throw diagnosticToError(errors[0]);
    }
    const program2 = check.ast;
    const output2 = [];
    const interpreter2 = new Interpreter((s) => {
      output2.push(s);
      print(s);
    });
    interpreter2.run(program2);
    return { output: output2, warnings };
  }
  const program = compileToAst(source);
  const output = [];
  const interpreter = new Interpreter((s) => {
    output.push(s);
    print(s);
  });
  interpreter.run(program);
  return { output, warnings: [] };
}
function formatError(err, source) {
  const lines = [];
  const where = `line ${err.line}, column ${err.column}`;
  lines.push(`${err.code} at ${where}: ${err.message}`);
  if (source) {
    const srcLines = source.split(/\r?\n/);
    const lineText = srcLines[err.line - 1];
    if (lineText !== void 0) {
      lines.push("");
      lines.push(`    ${lineText}`);
      const width = Math.max(1, err.length);
      lines.push(`    ${" ".repeat(Math.max(0, err.column - 1))}${"^".repeat(width)}`);
    }
  }
  if (err.hint) {
    lines.push(`Hint: ${err.hint}`);
  }
  return lines.join("\n");
}

// book/entry.ts
window.PlainlyBook = {
  runSource,
  checkSource,
  compileToPir,
  formatError,
  ERROR_CODES,
  STDLIB_DOCS
};
