# Plainly

**A human-first programming language.**

```plainly
set name = "Plainly"
set age = 23

if age >= 18:
  say "Hello " + name + ", you are an adult."
otherwise:
  say "Hello " + name + ", you are a minor."
```

This is **v0.4** — the language compiles to real software: lexer → parser →
**semantic analyzer** → **PIR (Plainly Intermediate Representation)** →
validation → optimization passes → **`plainly build` generates a full-stack app
(PostgreSQL schema + Node/Express API + React/TypeScript frontend)**, with a
coded error system (`PL-001…022` + `PIR001…009`), an 18-function standard
library, a tree-sitter grammar, **a visual-first book**, **exhaustive reference
documentation**, and local **HTTPS serving** (`plainly serve`).

## 📖 Learn Plainly

| Resource | What it is |
| --- | --- |
| **[Start here — 5-minute guide](docs/start.html)** | Never coded before? This gets you from zero to your first program and first website, step by step. |
| **[The Plainly Book](book/index.html)** | Visual-first tutorial: 17 chapters, diagrams, charts, and 40 live-runnable examples. |
| **[Reference Documentation](docs/index.html)** | Exhaustive spec: every rule, operator, builtin, error code, the CLI, and the formal grammar. |

Both sites run the **real compiler in your browser** — every `▶ Run` button
executes the actual code. Serve them locally:

```bash
npm run serve:book    # http://localhost:3000 — the book
npm run serve:docs    # http://localhost:3000 — the reference
```

## Quick start

```bash
npm install
npm run build
node dist/cli.js run examples/hello.pl

# Build a complete full-stack app from one .pl file:
node dist/cli.js build examples/shop.pl -o my-shop
# → my-shop/database/schema.sql + my-shop/server/ + my-shop/client/

# Serve the book over local HTTPS (auto-generated self-signed certificate):
npm run serve:book    # → https://localhost:3443
```

## The language in one screen

```plainly
# Variables
set name = "Plainly"
set age = 23

# Output
say "Hello " + name

# Conditions
if age >= 18:
  say "Adult"
otherwise if age > 12:
  say "Teen"
otherwise:
  say "Minor"

# Loops
set names = ["Aisha", "Ben"]
for each name in names:
  say name

repeat 3 times:
  say "Hello"

# Functions
function add(a, b):
  return a + b
say add(2, 3)

# Lists
set numbers = [1, 2, 3]
say numbers[0]
say length(numbers)
```

## CLI

```
plainly run <file.pl>              Check, then run a file
plainly check <file.pl>            Static analysis — reports ALL problems
plainly ast <file.pl>              Print the AST as JSON
plainly compile <f.pl> --emit pir  Compile to human-readable PIR
plainly compile <f.pl> --emit json Compile to stable PIR JSON
plainly build <file.pl> [-o DIR]   Generate a full-stack app (SQL + API + React)
plainly serve [DIR] [-p PORT]       Serve a folder over local HTTPS (or --http)
plainly optimize <file.pl>         Run optimization passes, show the result
plainly inspect <file.pl>          Compiler pipeline status report
plainly explain <file.pl>          Step-by-step "what does this program mean?"
plainly explain PL-002             Explain any error code
plainly explain split               Explain any builtin
plainly repl                        Interactive prompt
```

## Architecture

```
app.pl
   ↓
Lexer        src/lexer.ts        source → tokens (INDENT/DEDENT, positions)
   ↓
Parser       src/parser.ts       tokens → AST (precedence climbing)
   ↓
Analyzer     src/analyzer.ts     AST → all diagnostics (one pass)
   ↓
Lowering     src/pir/lowering    AST → PIR (SSA-flavored ops via PIRBuilder)
   ↓
Validator    src/pir/validator   PIR001…009 static checks
   ↓
Passes       src/pir/passes      constant folding → propagation → DCE
   ↓
Execution    two independent engines:
             src/interpreter.ts (AST) and src/pir/interpreter.ts (PIR)
             — parity tests prove they agree
```

The application model (`app`, `database`, `page`, `button`, `state`, `show`,
`create`) lowers to the PIR app dialect — `ui.*`, `db.*`, `state.*`,
`event.*` — platform-neutral ops that Phase 4 backends will compile to React
and Node.

Full PIR documentation: [`docs/compiler/pir/`](docs/compiler/pir/README.md).
Error system lives in `src/errors.ts` (codes, suggestions, formatter),
stdlib in `src/stdlib.ts`, and a tree-sitter grammar in
`grammar/tree-sitter-plainly/` for future editor tooling.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (140 tests — incl. PIR parity, golden & codegen)
npm run build       # dist/ + browser bundle for book & docs
npm run check:book  # verify every book example against the compiler
```

## Error philosophy

Errors speak human — code, location, plain English, hint, caret:

```
PL-002 at line 2, column 5: You tried to use 'agge', but it doesn't exist yet.

    say agge
        ^^^^
Hint: Did you mean 'age'?
```

## The first full-stack app — one file in, a real project out

```plainly
app "Shop"

database Product:
    name: text
    price: money
    in_stock: boolean

page "Products":
    title "Our Products"
    show Product
    form "Add Product" from Product:
        field name: text
        field price: number
        field in_stock: boolean

page "About":
    title "About This Shop"
```

```bash
node dist/cli.js build examples/shop.pl -o my-shop
```

```
my-shop/
├── README.md             how to run everything
├── database/schema.sql   PostgreSQL tables (product: id, name, price, in_stock)
├── server/               Express API — full CRUD + form endpoint, static hosting
└── client/               Vite + React + TS — 2 pages, api client, form with inputs
```

Run it: load `schema.sql` into Postgres, `npm run dev` in `server/`, then in
`client/` — and you have a working web app that was described in 16 lines of
Plainly. The generated app has **zero Plainly dependencies**.

## Roadmap

- ~~**Phase 1** — Interpreter (done)~~
- ~~**Phase 2** — Language made solid: analyzer, errors, stdlib, book, docs (done)~~
- ~~**Phase 3** — PIR: lowering, validator, passes, parity, golden tests (done)~~
- ~~**Phase 4** — `plainly build`: PIR → SQL + Node API + React frontend (done)~~
- **Phase 5** — Polish the generated stack: auth IR, queries (`all Todo`), deployment
- **Phase 6** — Developer experience: formatter, VS Code extension
- **Phase 7** — AI layer: natural language → Plainly
- **Phase 8** — PIR → Flutter, Swift, Python, Rust

Full language spec: `docs/language.md`.
