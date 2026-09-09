# Functions in PIR

## Shape

A function is an `IRFunction`: name, parameters, and one entry block of ops.
The module's function 0 is always `main` — top-level statements lower there.

## Declaration

```
function add(a, b):
    return a + b
```

```
function add(a, b):
  entry:
  %0 = load a
  %1 = load b
  %2 = add %0, %1
  return %2
  return
```

(Parameters are locals; the trailing `return` is the implicit one. A static
PIR005 fires if a user function has no `return` op at all.)

## Calls

Direct calls only in v0.3. Name resolution order:

1. Module functions → `call_user` (arity checked statically by the validator).
2. Otherwise → builtins → `call` (name in `attrs.callee`).

```
say add(2, 3)
```

```
%0 = const 2
%1 = const 3
%2 = call add(%0, %1)
print %2
```

## Builtins

PIR uses the same builtin set as the AST interpreter (see the stdlib docs).
The validator keeps an arity table (`BUILTIN_IMPLS`) mirroring `src/stdlib.ts`;
mismatches are PIR003, unknown names PIR004.

## Recursion

`call_user` re-enters `callFunction` with fresh parameter locals, so recursion
works naturally (see `fact(5)` in the parity tests). Depth is capped at 900.

## Closures

Plainly v0.3 functions capture their defining environment in the AST
interpreter. In PIR, closures are represented by the function table index plus a
captured environment map (`PirClosure`); full closure semantics through `call`
are a documented v0.4 target — current parity covers top-level functions.
