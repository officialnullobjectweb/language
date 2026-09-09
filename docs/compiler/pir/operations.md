# Core Operations

Every operation with its signature. "Produces" is the temp type; `—` means the
op produces no value. Printed forms come from the human-readable printer.

## Values

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `const` | inline value | value | Defines its result temp as the constant. |
| `load` | var | value | Reads a variable. |
| `store` | var, value | — | Writes a variable. |

```
%0 = const 100
store total, %0
%2 = load total
```

## Arithmetic

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `add` | number, number | number | Sum. `+` with any string operand lowers to `join_text` instead. |
| `sub` | number, number | number | Difference. |
| `mul` | number, number | number | Product. |
| `div` | number, number | number | Quotient; zero divisor is a runtime error. |
| `mod` | number, number | number | Remainder; zero divisor is a runtime error. |
| `neg` | number | number | Arithmetic negation. |

## Comparison & logic

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `eq` / `ne` | any, any | boolean | Deep equality (lists compared element-wise). |
| `gt` `lt` `ge` `le` | numbers or strings | boolean | Ordering; mixed kinds are runtime errors. |
| `not` | boolean | boolean | Logical negation. |
| `and` / `or` | any, any | any | Truthiness-based, result is one of the operands (like the interpreter). |

## Lists & text

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `make_list` | values… | list | Builds a list from evaluated elements. |
| `index` | list-or-string, number | value | 0-based indexing; out of range is a runtime error. |
| `length` | list-or-string | number | Element/character count. |
| `join_text` | any, any | string | Text concatenation (`+` with a string operand). |

## Calls

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `call` | values… | value | Calls a builtin; callee name in `attrs.callee`. |
| `call_user` | values… | value | Calls a module function; arity checked statically. |

## Effects

| Op | Operands | Produces | Semantics |
|---|---|---|---|
| `print` | value | — | Sends the formatted value to output (`say`). |
| `return` | value? | — | Exits the function with a value (or nothing). |

## Control

| Op | Operands | Semantics |
|---|---|---|
| `jump_if_false` | boolean | Guard: runs inline `__body` when the value is true; `else: true` attr marks else-branches. |
| `jump_if_true` | any | Loop: iterates inline `__body` (`forEach` var or `repeat: true`). |
| `jump` | — | Structural marker for closed blocks (no runtime effect). |

## Value formatting (`print`)

Numbers print plainly (`500`), strings raw, booleans `true`/`false`,
`null` as `nothing`, lists as `[1, 2, 3]` (strings inside quoted), functions as
`<function name>`.
