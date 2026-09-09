# Plainly Language Specification (v0.1)

Plainly is a **human-first programming language**. Its goal: describe software using
concepts non-programmers naturally understand, and compile it deterministically.

This document defines the v0.1 core language: what is valid, what each construct means,
and how it executes.

---

## 1. Source files

- Extension: `.pl`
- Encoding: UTF-8 text
- Statements are **line-oriented**. One statement per line.
- Comments start with `#` and run to end of line. They are ignored by the lexer.
- Blank lines are allowed anywhere.

## 2. Keywords

| Keyword      | Purpose                              |
|--------------|--------------------------------------|
| `say`        | Print a value to output              |
| `set`        | Declare/assign a variable            |
| `if`         | Conditional execution                |
| `otherwise`  | Else branch of `if`                  |
| `for each`   | Iterate over a list or text          |
| `in`         | Part of `for each ... in ...`        |
| `repeat`     | Repeat a block N times               |
| `times`      | Part of `repeat N times`             |
| `otherwise if` | Else-if branch                     |
| `function`   | Define a function                    |
| `return`     | Return from a function               |

## 3. Values and types

| Type    | Literals                | Example           |
|---------|-------------------------|-------------------|
| Number  | Integers & decimals     | `42`, `3.14`      |
| Text    | Double-quoted strings   | `"Hello"`         |
| Boolean | `true`, `false`         | `true`            |
| List    | `[a, b, c]`             | `[1, 2, 3]`       |
| Nothing | —                       | —                 |

Operators: `+  -  *  /  %  (  )  >  <  >=  <=  ==  !=  and  or  not`

## 4. Statements

### 4.1 say
```
say "Hello World"
say name
say "Hello " + name
```

### 4.2 set
```
set name = "Plainly"
set age = 23
set total = price * quantity
```

### 4.3 if / otherwise
```
if age >= 18:
    say "Adult"
otherwise if age > 12:
    say "Teen"
otherwise:
    say "Minor"
```
The colon after the condition opens a block. Indented lines belong to the block.
`otherwise if` chains are supported.

### 4.4 for each
```
for each user in users:
    say user
```
Iterates over a list. Iterating over text yields each character.

### 4.5 repeat
```
repeat 10 times:
    say "Hello"
```

### 4.6 function
```
function add(a, b):
    return a + b

say add(2, 3)
```

## 5. Semantics

- Variables are dynamically typed. Re-declaration with `set` rebinds.
- Reading an undefined variable is an error: `Undefined variable 'x'`
- `+` on two numbers adds; if either operand is text, both sides are converted to text.
- Number formatting: integers print without decimal point; decimals keep precision.
- Functions are first-class values; calling with wrong count is an error.
- `return` outside a function is an error.

## 6. Error philosophy

Errors must be **beginner-friendly**: plain language, position included.

```
Error at line 5, column 3: You tried to use 'x', but it doesn't exist yet.
Create it first with: set x = ...
```

## 7. Future (not in v0.1)

`app`, `page`, `database`, `button` blocks, PIR, code generation. See ROADMAP.
