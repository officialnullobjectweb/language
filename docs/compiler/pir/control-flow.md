# Control Flow in PIR

## The one guard rule

Every conditional in PIR compiles to a single rule:

> A `jump_if_false` op with an inline `__body` runs that body **when its
> operand is true**.

That reads backwards for a "jump if false", so the lowering normalizes
everything into this shape:

- **then-branch**: guard on the condition itself.
- **else-branch**: guard on a `not` of the condition (op is marked `else: true`).
- **otherwise-if chains**: nested — the else-body contains the lowered next `if`.

## If / otherwise — source to PIR

```
if age >= 18:
    say "Adult"
otherwise:
    say "Minor"
```

```
%2 = load age
%3 = const 18
%4 = ge %2, %3
  if %4 then:
    print "Adult"
%5 = not %4
  if %5 otherwise:
    print "Minor"
```

The interpreter executes each guard independently; because the second condition
is the negation, exactly one body runs. Parity tests verify this against the AST
interpreter for every if/else example.

## Loops

**repeat N times** — `jump_if_true` with `repeat: true`; the body runs N times
in the *same* environment, so writes inside the body persist.

**for each x in items** — `jump_if_true` with `forEach: "x"`; the body runs once
per item. The loop variable is set in the environment (so accumulator writes
persist — this matches Phase 1 AST semantics where `set` inside a loop updates
outer variables); the previous binding of `x` is restored afterwards.

```
set doubled = []
for each n in numbers:
    set doubled = doubled + [n * 2]
```

Both interpreters produce `[2, 4, 6]` — covered by a dedicated parity test.

## Recursion

Functions lower to module-level `IRFunction`s; `call_user` re-enters the
interpreter with fresh locals. Recursion depth is bounded (900) with a friendly
runtime error, matching the AST interpreter.
