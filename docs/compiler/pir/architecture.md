# PIR Architecture

## Data model

```
IRModule
├── kind: "IRModule"
├── version: "0.3"
├── name: "main" | appName
├── app?: { name }                    // set when source declares `app "..."`
├── entities: IREntity[]              // from `database` declarations
└── functions: IRFunction[]           // functions[0] is always `main`
     ├── name, parameters[]
     └── blocks: IRBlock[]            // entry block always present
          ├── label
          └── ops: IROperation[]
               ├── op        opcode ("add", "ui.page", …)
               ├── operands  PirValueRef[]
               ├── result?   temp name ("%3")
               ├── attrs?    labels, entities, inline bodies
               └── pos?      source position (line, column)
```

A whole program is one module. `main` is always function 0; user functions follow
in declaration order.

## The lowering pipeline

```
lowerProgram(program: Program): IRModule
```

1. A `PIRBuilder` is created for `main`.
2. Each top-level statement is walked in order:
   - Expressions evaluate to `PirValueRef`s (temps or constants).
   - Statements emit one or more ops through the builder.
3. `main` ends with an implicit `return`.
4. User functions each get their own builder and IRFunction.

## Structured control flow

PIR v0.3 does **not** use raw jump targets. Guards and loops are emitted as a
single op carrying its body inline:

```
%4 = ge %2, %3
jump_if_false %4, __body = [ …then ops… ]
```

- `jump_if_false` + `__body` → "run body when the guard value is true" (if/loops)
- `jump_if_false` + `else: true` → the else branch (condition pre-negated)
- `jump_if_true` + `forEach` attr → for-each iteration
- `jump_if_true` + `repeat: true` → repeat-N iteration
- `event.click` + `__body` → click handler

Why inline bodies instead of basic blocks with branch targets?

- The IR stays tree-structured and trivially printable.
- Validators, optimizers, and interpreters recurse instead of solving CFGs.
- Backends that *do* want basic blocks can flatten `__body` lists mechanically.

The trade-off is documented honestly: this is not maximally optimizable IR. It is
deliberately the simplest IR that supports Plainly v0.3 semantics end to end.

## Temp numbering

Temps are numbered `%0, %1, …` per function. Detached sub-builders (guard bodies,
click handlers) **inherit the counter** from their parent, so no two ops in the
same function ever share a temp name — required by parity tests and stable JSON.

## Determinism

`moduleToStableJSON(module)` deep-clones the module and removes nothing but
`undefined` — key order follows insertion order, which lowering makes
deterministic. Golden tests compare this JSON byte-for-byte (see
`tests/golden/*.pir.json`).
