# PIR Types

PIR carries a small, closed set of types. Simplicity is a feature: every op's
signature is checkable at a glance.

| Type | Meaning | From source |
|---|---|---|
| `number` | 64-bit float used as int/decimal | `42`, `3.14` |
| `string` | text | `"hello"` |
| `boolean` | true/false | `true`, comparisons |
| `null` | absence | nothing / missing value |
| `list` | ordered values | `[1, 2, 3]` |
| `function` | callable closure | user functions, builtins |
| `unknown` | inference hasn't reached it | load results, builtin returns |

## Inference rules

- Literals are typed directly (`const 5` → number).
- Arithmetic ops (`add/sub/mul/div/mod`) produce `number`.
- `not` produces `boolean`; comparisons produce `boolean`.
- `make_list` produces `list`; `join_text` produces `string`.
- `load`/`state.get`/`call` results start `unknown` — the validator allows
  `unknown` everywhere and only rejects *known* mismatches (e.g. `string` into
  `mul`).

## The validator and `unknown`

The type check is intentionally **sound, not complete**: it rejects modules
where a *known* type contradicts an operation's signature, and permits anything
it cannot prove wrong. This matches the AST analyzer's dynamic typing while
still catching corrupted or ill-lowered modules.

## Application field types

Database field annotations map to PIR types:

| Source | PIR type |
|---|---|
| `text`, `money`, `email`, `date` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |

## Future types (reserved, not yet emitted)

`list<T>` (element-typed), `object`, `date`, `money` (numeric cents), `email`,
`url`, `file`, `image` — and app-level record types (`User`, `Product`, `Order`).
