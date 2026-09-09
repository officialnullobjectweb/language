# The API & Auth Dialects

Defined in v0.3 for the PIR surface and validation; emitted by source syntax in
Phase 4. They exist now so backends can be designed against a stable contract.

## `api.route`

| Attribute | Meaning |
|---|---|
| `method` | GET / POST / PUT / DELETE |
| `path` | URL path |
| `__body` | handler ops |

Planned source form:

```
api get "/todos":
    return all Todo
```

Planned PIR:

```
api.route method=GET path="/todos":
  db.query "Todo"
  return %0
```

## `auth.require`

```
require login
```

lowers to:

```
auth.require
```

**The key principle: Plainly describes the requirement, the backend chooses
the implementation.** `auth.require` can become a session cookie check in
Express, middleware in FastAPI, or a Supabase RLS policy. The PIR never names
an implementation.

## Why define these now?

1. The validator already reserves and checks the op namespace.
2. Golden tests will pin the app-model lowering before backends exist.
3. Backend authors (Phase 4) can code against the documented contract instead
   of reverse-engineering lowering output.
