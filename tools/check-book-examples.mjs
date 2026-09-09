#!/usr/bin/env node
/**
 * Book example verifier.
 *
 * Every code block that appears in the book (book/index.html) is mirrored
 * here with its exact expected output. If a language change ever breaks a
 * book example, this script fails — the book can never silently lie.
 *
 * Run: node tools/check-book-examples.mjs   (after `npm run build`)
 */

import { runSource, formatError } from "../dist/index.js"

const examples = [
  // ---- Chapter: Hello, Plainly ----
  {
    id: "hello",
    src: 'say "Hello World"',
    expect: ["Hello World"],
  },
  {
    id: "recipe-steps",
    src: `# A program is a list of instructions.
# The computer reads them top to bottom, like a recipe.

say "Step 1: preheat the oven"
say "Step 2: mix the batter"
say "Step 3: bake for 30 minutes"`,
    expect: ["Step 1: preheat the oven", "Step 2: mix the batter", "Step 3: bake for 30 minutes"],
  },

  // ---- Chapter: say ----
  {
    id: "say-values",
    src: `say "text in quotes"
say 42
say 3.14
say true
say [1, 2, 3]`,
    expect: ["text in quotes", "42", "3.14", "true", '[1, 2, 3]'],
  },
  {
    id: "say-math",
    src: `say 2 + 2
say 10 - 3
say 4 * 5
say 10 / 4
say 10 % 3`,
    expect: ["4", "7", "20", "2.5", "1"],
  },

  // ---- Chapter: variables ----
  {
    id: "variables-basic",
    src: `set name = "Plainly"
set age = 23

say name
say age`,
    expect: ["Plainly", "23"],
  },
  {
    id: "variables-reuse",
    src: `set apples = 3
set oranges = 5

set fruit = apples + oranges
say "I have " + text(fruit) + " pieces of fruit"`,
    expect: ["I have 8 pieces of fruit"],
  },
  {
    id: "variables-update",
    src: `set score = 0
say score

set score = score + 10
say score

set score = score + 15
say score`,
    expect: ["0", "10", "25"],
  },

  // ---- Chapter: text ----
  {
    id: "text-join",
    src: `say "Hello " + "World"

set age = 23
say "Age: " + age`,
    expect: ["Hello World", "Age: 23"],
  },
  {
    id: "text-builtins",
    src: `say uppercase("quiet")
say lowercase("LOUD")
say trim("   padded   ")`,
    expect: ["QUIET", "loud", "padded"],
  },
  {
    id: "text-split-join",
    src: `set csv = "coffee,tea,cocoa"
set drinks = split(csv, ",")

say drinks
say join(drinks, " + ")`,
    expect: ['["coffee", "tea", "cocoa"]', "coffee + tea + cocoa"],
  },
  {
    id: "text-replace-contains",
    src: `say replace("i like pie", "pie", "cake")
say contains("hello", "ell")`,
    expect: ["i like cake", "true"],
  },

  // ---- Chapter: numbers ----
  {
    id: "numbers-order",
    src: `say 2 + 3 * 4
say (2 + 3) * 4`,
    expect: ["14", "20"],
  },
  {
    id: "numbers-tools",
    src: `say abs(-7)
say round(2.6)
say floor(2.9)
say ceil(2.1)
say min(3, 9)
say max(3, 9)`,
    expect: ["7", "3", "2", "3", "3", "9"],
  },
  {
    id: "numbers-compare",
    src: `say 5 > 3
say 5 <= 3
say 5 == 5
say 5 != 3`,
    expect: ["true", "false", "true", "true"],
  },

  // ---- Chapter: decisions ----
  {
    id: "if-otherwise",
    src: `set age = 20

if age >= 18:
  say "Adult"
otherwise:
  say "Minor"`,
    expect: ["Adult"],
  },
  {
    id: "if-chain",
    src: `set score = 85

if score >= 90:
  say "Grade: A"
otherwise if score >= 80:
  say "Grade: B"
otherwise if score >= 70:
  say "Grade: C"
otherwise:
  say "Grade: F"`,
    expect: ["Grade: B"],
  },
  {
    id: "if-and-or",
    src: `set age = 25
set hasTicket = true

if age >= 18 and hasTicket:
  say "Enjoy the movie!"

set day = "Sunday"
if day == "Saturday" or day == "Sunday":
  say "It's the weekend!"`,
    expect: ["Enjoy the movie!", "It's the weekend!"],
  },
  {
    id: "if-not",
    src: `set isRaining = false

if not isRaining:
  say "No umbrella needed"`,
    expect: ["No umbrella needed"],
  },

  // ---- Chapter: loops ----
  {
    id: "for-each",
    src: `set names = ["Aisha", "Ben", "Carlos"]

for each name in names:
  say "Hello " + name`,
    expect: ["Hello Aisha", "Hello Ben", "Hello Carlos"],
  },
  {
    id: "repeat",
    src: `repeat 3 times:
  say "Loop!"`,
    expect: ["Loop!", "Loop!", "Loop!"],
  },
  {
    id: "for-each-text",
    src: `for each letter in "abc":
  say letter`,
    expect: ["a", "b", "c"],
  },
  {
    id: "loop-total",
    src: `set prices = [5, 3, 12]

set total = 0
for each price in prices:
  set total = total + price

say total`,
    expect: ["20"],
  },
  {
    id: "evens",
    src: `set numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
set evens = []

for each n in numbers:
  if n % 2 == 0:
    set evens = evens + [n]

say evens`,
    expect: ["[2, 4, 6, 8, 10]"],
  },

  // ---- Chapter: lists ----
  {
    id: "lists-basic",
    src: `set colors = ["red", "green", "blue"]

say colors
say colors[0]
say colors[2]
say length(colors)`,
    expect: ['["red", "green", "blue"]', "red", "blue", "3"],
  },
  {
    id: "lists-push-combine",
    src: `set cart = []

push(cart, "apples")
push(cart, "bread")

say cart

set more = ["milk"]
say cart + more`,
    expect: ['["apples", "bread"]', '["apples", "bread", "milk"]'],
  },
  {
    id: "lists-find",
    src: `set fruits = ["apple", "banana", "cherry"]

say contains(fruits, "banana")
say fruits[1]`,
    expect: ["true", "banana"],
  },
  {
    id: "lists-of-lists",
    src: `set grid = [[1, 2], [3, 4]]

say grid
say grid[0]
say grid[1][0]`,
    expect: ["[[1, 2], [3, 4]]", "[1, 2]", "3"],
  },

  // ---- Chapter: functions ----
  {
    id: "functions-basic",
    src: `function add(a, b):
  return a + b

say add(2, 3)
say add(10, 20)`,
    expect: ["5", "30"],
  },
  {
    id: "functions-greet",
    src: `function greet(name):
  return "Hello, " + name + "!"

say greet("Plainly")`,
    expect: ["Hello, Plainly!"],
  },
  {
    id: "functions-recursion",
    src: `function factorial(n):
  if n <= 1:
    return 1
  return n * factorial(n - 1)

say factorial(5)`,
    expect: ["120"],
  },
  {
    id: "functions-double",
    src: `function double(n):
  return n * 2

set numbers = [1, 2, 3, 4]
set doubled = []

for each n in numbers:
  set doubled = doubled + [double(n)]

say doubled`,
    expect: ["[2, 4, 6, 8]"],
  },

  // ---- Chapter: builtins tour ----
  {
    id: "builtins-conversions",
    src: `set age = number("23")
say age + 1

set label = text(99)
say "Room " + label`,
    expect: ["24", "Room 99"],
  },
  {
    id: "builtins-list",
    src: `say list(1, 2, 3)
set xs = []
push(xs, 10)
push(xs, 20)
say xs`,
    expect: ["[1, 2, 3]", "[10, 20]"],
  },

  // ---- Mini projects ----
  {
    id: "project-shopping-cart",
    src: `# --- The menu (prices) ---
set prices = [5, 3, 12]

# --- The shopping cart ---
set cart = []

# A customer picks two things:
push(cart, prices[0])
push(cart, prices[2])

# --- The bill ---
set total = 0
for each price in cart:
  set total = total + price

say "Items: " + text(length(cart))
say "Total: $" + text(total)`,
    expect: ["Items: 2", "Total: $17"],
  },
  {
    id: "project-times-table",
    src: `set sizes = [1, 2, 3, 4, 5]

for each s in sizes:
  say text(s) + " x 7 = " + text(s * 7)`,
    expect: ["1 x 7 = 7", "2 x 7 = 14", "3 x 7 = 21", "4 x 7 = 28", "5 x 7 = 35"],
  },
  {
    id: "project-name-badge",
    src: `function badge(name, age):
  set line = uppercase(name) + " (" + text(age) + ")"
  return line

say badge("plainly", 23)
say badge("aisha", 31)`,
    expect: ["PLAINLY (23)", "AISHA (31)"],
  },
  {
    id: "project-password-check",
    src: `function checkPassword(password):
  if length(password) >= 8:
    return "strong enough"
  otherwise:
    return "too short"

say checkPassword("hunter2")
say checkPassword("a-very-long-password")`,
    expect: ["too short", "strong enough"],
  },

  // ---- Error tour ----
  {
    id: "error-typo",
    src: `set greeting = "hi"
say greting`,
    expect: null, // error case
    errorContains: ["PL-002", "'greeting'"],
  },
  {
    id: "error-bad-subtract",
    src: `say [1] - [1]`,
    expect: null,
    errorContains: ["PL-009", "need numbers"],
  },
  {
    id: "error-divzero",
    src: `say 1 / 0`,
    expect: null,
    errorContains: ["PL-008", "divide by zero"],
  },
]

let failures = 0
let passed = 0

for (const ex of examples) {
  const output = []
  let error = null
  try {
    runSource(ex.src, (s) => output.push(s))
  } catch (err) {
    error = err
  }

  if (ex.expect === null) {
    if (!error) {
      console.error(`FAIL [${ex.id}] expected an error but the program ran`)
      failures++
      continue
    }
    const formatted = formatError(error, ex.src)
    const missing = (ex.errorContains ?? []).filter((s) => !formatted.includes(s))
    if (missing.length > 0) {
      console.error(`FAIL [${ex.id}] error output missing ${JSON.stringify(missing)}\n---\n${formatted}\n---`)
      failures++
    } else {
      passed++
    }
    continue
  }

  if (error) {
    console.error(`FAIL [${ex.id}] unexpected error:\n${formatError(error, ex.src)}`)
    failures++
    continue
  }
  if (JSON.stringify(output) !== JSON.stringify(ex.expect)) {
    console.error(`FAIL [${ex.id}]\n  expected: ${JSON.stringify(ex.expect)}\n  actual:   ${JSON.stringify(output)}`)
    failures++
  } else {
    passed++
  }
}

console.log(`\nBook examples: ${passed} passed, ${failures} failed, ${examples.length} total`)
process.exit(failures > 0 ? 1 : 0)
