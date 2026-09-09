# PIR — Plainly Intermediate Representation

PIR is the bridge between the Plainly a human writes and the software a machine runs.

```
app.pl
   ↓  lexer → parser
AST
   ↓  semantic analysis
AST (valid)
   ↓  lowering            ← you are here
PIR
   ↓  validation
   ↓  optimization passes
Backend (interpreter today, React/Node tomorrow)
```

**Why an intermediate representation?** One frontend (Plainly → PIR) plus many
backends (PIR → React, PIR → Node, PIR → Python, …) scales linearly. Without PIR,
every new target would need its own full compiler. This is the same shape LLVM and
MLIR use: a stable middle representation that frontends lower into and backends
lower out of.

## The two worlds

PIR is split into two dialect families:

| Dialect | Represents | Example ops |
|---|---|---|
| **Core** | computation | `const`, `load`, `store`, `add`, `mul`, `eq`, `jump_if_false`, `call`, `print` |
| **App** | software products | `app.create`, `db.entity`, `db.create`, `ui.page`, `ui.button`, `state.get`, `event.click`, `api.route`, `auth.require` |

The app dialect is deliberately platform-neutral. `ui.button` does not mean a React
button; it means *the concept* of a button. Each backend decides how to implement it.

## See it yourself

```bash
plainly compile examples/app-todo.pl --emit pir      # human-readable PIR
plainly compile examples/app-todo.pl --emit json     # machine-readable PIR
plainly optimize examples/showcase.pl                # run optimization passes
plainly inspect examples/app-todo.pl                 # full pipeline status
plainly explain examples/price.pl                    # what does this program mean?
```

## Documentation map

| File | Contents |
|---|---|
| [architecture.md](architecture.md) | Data model, module structure, control-flow design |
| [types.md](types.md) | The PIR type system and inference rules |
| [values.md](values.md) | Value references: temps, variables, inline constants |
| [operations.md](operations.md) | Every core op: signature, semantics, example |
| [control-flow.md](control-flow.md) | Guards, loops, and inline body blocks |
| [functions.md](functions.md) | Function definitions, calls, recursion, closures |
| [ui.md](ui.md) | The UI dialect: pages, buttons, state, events |
| [database.md](database.md) | The data dialect: entities, fields, records |
| [api.md](api.md) | The API dialect: routes and auth requirements |
| [passes.md](passes.md) | The optimization pass framework and each pass |
| [validation.md](validation.md) | PIR001–PIR009 diagnostics and how to fix them |

## Design principles

1. **Small.** PIR v0.3 has ~45 operations. It is not LLVM, and should not try to be.
2. **Typed.** Every op declares operand and result types; the validator rejects
   ill-typed modules before any backend sees them.
3. **SSA-flavored.** Computed values live in numbered temps (`%0`, `%1`, …) so data
   flow is explicit — ready for optimization and code generation.
4. **Deterministic.** Same source in, byte-identical stable JSON out. Golden tests
   enforce it.
5. **Concept-first.** App ops name *concepts* (page, button, state, entity), never
   implementations (useState, SQL, Express).
