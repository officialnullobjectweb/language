# Optimization Passes

## The framework

A pass is `{ name, run(module) }` returning the (possibly new) module plus an
optional note. The pass manager runs them in order and collects the report:

```ts
runPasses(module, [constantFolding, constantPropagation, deadCodeElimination])
// → { module, report: ["constant folding: 1 op(s) folded", …], changed: true }
```

The default pipeline (`DEFAULT_PASSES`) is exactly that trio. `plainly optimize`
runs it and prints each note; `plainly inspect` shows the pipeline status.

**Safety rule:** every transformation must preserve behavior. Parity tests run
programs before and after optimization and require identical output.

Passes fully traverse inline `__body` blocks (guards, loops, click handlers) —
no dead code hides inside an `if`.

## Pass 1: Constant folding

Replaces value-producing ops whose operands are all known constants with a
single `const` op.

```
%0 = const 10
%1 = const 20
%2 = add %0, %1        →   %2 = const 30
```

Folds arithmetic, comparisons, `not`, list/string concatenation. Division and
mod by a zero constant are *not* folded (that would delete a runtime error).
Short-circuit `and`/`or` fold only when safe. Folding works recursively inside
guard bodies.

## Pass 2: Constant propagation

Replaces `load`s of variables known to hold constants with a `const` op, and
tracks constants that flow through temps (the lowering's store-through-temp
pattern):

```
%0 = const 7
store x, %0
%1 = load x            →   %1 = const 7
```

Conservative invalidation: any `store` of a non-constant, and any `call`/
`call_user` (builtins can mutate lists), wipes the known-constant table.
State vars are not propagated (handlers can re-run).

## Pass 3: Dead code elimination

Removes **pure** ops whose result temp is never referenced — consts, loads,
arithmetic, comparisons, list ops. Iterated to a fixpoint (removing one op may
make its operands dead).

```
set used = 1
say used
set unused = 99      →   the const+store for `unused` disappears
```

Never removed (they have effects): `print`, `store` of live values, calls,
`return`, all app ops (`ui.*`, `db.*`, `state.*`, `event.*`), guards, loops.

## Adding a pass (the extension contract)

```ts
export const myPass: PirPass = {
  name: "my pass",
  run(module) {
    // transform; return { module, note: "N op(s) transformed" } or note: null
  },
}
```

Register it in `DEFAULT_PASSES` (or a target-specific list). Later passes from
the plan — async lowering, UI optimization, database optimization — plug in here
without touching the compiler core.
