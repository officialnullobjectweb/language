# PIR Value References

Every operand in PIR is a `PirValueRef` — one of three kinds:

## 1. Temp references — `%n`

```json
{ "kind": "temp", "name": "%3", "type": "number" }
```

Produced by value-computing ops. Temps are SSA-flavored: each is assigned
exactly once, by the op whose `result` names it. Reference **before** definition
is diagnostic PIR009.

## 2. Variable references — `name`

```json
{ "kind": "var", "name": "total", "type": "unknown" }
```

Used by `store` (target) and `load` (source). Variables are mutable slots;
`store` overwrites, `load` reads. Reading an never-stored name is PIR007.

## 3. Constant references — inline data

```json
{ "kind": "const", "value": 100, "type": "number" }
```

Data embedded directly in the operand. Lowering actually routes even literals
through a `const` op (giving them a temp) so the interpreter tracks them
uniformly; pass output may inline constants back.

## Value kinds at runtime

The PIR interpreter's runtime values mirror the AST interpreter exactly:

| Kind | Shape |
|---|---|
| number | JS number |
| string | JS string |
| boolean | JS boolean |
| null | `null` |
| list | JS array |
| record | object tagged `__pir_record: entityName` |
| closure | object tagged `__pir_function: true` |

## Truthiness

Shared with the AST interpreter: `null`/`false`/`0`/`""`/empty list are falsy;
everything else is truthy. Used by guards, `and`/`or`, and `if`.
