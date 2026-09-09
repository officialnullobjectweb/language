# The Data Dialect

## Entities

```
database Todo:
    title: text
    completed: boolean
```

Produces two things:

1. **Module metadata** — `module.entities` gains an `IREntity`:
   ```json
   { "name": "Todo", "fields": [
       { "name": "title", "type": "text", "pirType": "string" },
       { "name": "completed", "type": "boolean", "pirType": "boolean" }
   ] }
   ```
2. **An op in main** — `db.entity Todo { title:text, completed:boolean }`

Note there is **no SQL**. An entity is the *concept* of a stored kind of thing;
the backend chooses Postgres, SQLite, localStorage, or anything else.

## Field types

| Source annotation | PIR type |
|---|---|
| `text`, `money`, `email`, `date` | string |
| `number` | number |
| `boolean` | boolean |

## Records

| Op | Operands | Meaning |
|---|---|---|
| `db.create` | entity | Creates a new record of that entity. |
| `db.query` | entity | Returns the stored list of records. |

Entity references are validated (PIR008): creating or querying an undeclared
entity is a static error. The PIR interpreter stores records per entity and
`db.create` appends a tagged record value.

## Runtime note

In v0.3, `create Todo` inside a click handler appends an empty record — fields
come from future form/input syntax (Phase 4). The concept, validation, and
pipeline are complete; richer field population rides on top.

## Later

`db.insert`, `db.update`, `db.delete`, `db.all`, `db.find` — plus relations,
indexes, and migrations — are reserved names in the dialect for Phase 4.
