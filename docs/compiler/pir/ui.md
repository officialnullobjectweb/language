# The UI Dialect

The UI dialect names **concepts**, not widgets: a `ui.button` is not a React
button. Backends decide the implementation.

## Declaring

```
page "Home":
    title "My Todos"
    show Todo
    button "Add Todo":
        create Todo
```

```
ui.page "Home"
ui.title "My Todos"
ui.show "Todo"
ui.button "Add Todo":
  on click:
    db.create "Todo"
```

| Op | Attributes | Meaning |
|---|---|---|
| `ui.page` | `page` | A named page; its body lowers inline after it. |
| `ui.title` | — | The page's title text. |
| `ui.button` | `label` | A button; its handler body follows as `event.click`. |
| `ui.show` | — | Display the records of an entity (entity in operand). |
| `ui.text` | — | Static text (reserved for future source syntax). |

## Events

A button's body lowers to an `event.click` op carrying the handler ops inline
as `__body`. The PIR interpreter **simulates one click at declaration time** so
handler side effects (`say`, `db.create`) are observable in console runs; the
AST interpreter mirrors this for parity. Real event wiring belongs to backends
(React `onClick`, etc.).

## State

```
page "Home":
    state count = 0
    button "Up":
        set count = count + 1
```

| Op | Operands | Meaning |
|---|---|---|
| `state.create` | name, initial value | Declares a state slot (also binds it as a variable). |
| `state.get` | name | Reads state → temp. |
| `state.set` | name, value | Writes state. |

Reads/writes of state names lower to `state.get`/`state.set` (not `load`/
`store`), keeping the concept explicit for backends — React maps them to
`useState`, Flutter to setState, a backend to a database column.

## Why this matters

The same PIR above can become:

- **React**: a component with `useState` and `onClick`
- **Flutter**: a `StatefulWidget` with a callback
- **Server-rendered HTML**: a form post + redirect

The concept compiles once; implementations differ per target. That is the
entire point of the app dialect.
