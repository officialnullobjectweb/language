# PIR Validation

`validateModule(module)` statically checks a module before interpretation or
backend compilation. Diagnostics use `PIRnnn` codes (distinct from source-level
`PL-nnn` codes — PIR problems mean either invalid app-model use or a compiler
bug, never a user typo).

## Codes

### PIR001 — operand type mismatch
An operation received a known-wrong value kind (e.g. `mul` over `string`).
**Fix:** ensure the value reaching the op has the expected type. In compiled
modules this indicates a lowering or pass bug.

### PIR002 — unknown operation
The opcode isn't in the operation registry. **Fix:** only compiler code creates
ops; this means a bug or hand-corrupted module.

### PIR003 — wrong builtin argument count
A `call` passes a different number of values than the builtin accepts.
**Fix:** match the builtin's documented arity.

### PIR004 — unknown function/builtin
A `call` names a builtin that doesn't exist, or a `call_user` names a function
missing from the module. **Fix:** check spelling/registration.

### PIR005 — function never returns
A user function contains no `return` op. **Fix:** add a return at the end.
(`main` is exempt — it returns implicitly.)

### PIR006 — unbalanced block structure (reserved)
Held for the future basic-block form; not emitted by the v0.3 structured
lowering.

### PIR007 — undefined variable read
A `load` reads a name never stored in that function. **Fix:** store before
loading. Indicates a lowering bug if source passed semantic analysis.

### PIR008 — entity reference error
`db.create` / `db.query` / `ui.show` references an entity not declared in the
module, or an entity is declared twice. **Fix:** declare the `database` block
first.

### PIR009 — value used before definition
A temp reference appears in an op earlier than the op defining it.
**Fix:** compiler-side; a lowering/pass bug.

## Running it

```bash
plainly inspect app.pl        # includes PIR validity in the pipeline report
```

```ts
import { validateSource } from "plainly"
const { validation } = validateSource("set x = 1\nsay x")
// { ok: true, diagnostics: [] }
```

Every compiled module is validated inside `optimizeSource` before passes run,
so the optimizer and PIR interpreter only ever see provably well-formed IR.
