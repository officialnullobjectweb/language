/**
 * Plainly CLI (v0.3).
 *
 *   plainly run file.pl              Run a Plainly file (AST interpreter)
 *   plainly check file.pl            Analyze without running — reports ALL problems
 *   plainly ast file.pl              Print the parsed AST as JSON
 *   plainly compile f.pl --emit pir  Compile to PIR (human-readable or JSON)
 *   plainly optimize file.pl         Run optimization passes over PIR
 *   plainly inspect file.pl          Show the compiler pipeline status
 *   plainly explain <file|code|name>  Explain a program, error code, or builtin
 *   plainly repl                      Interactive Plainly prompt
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import {
  compileToAst,
  checkSource,
  runSource,
  formatError,
  PlainError,
  compileToPir,
  validateModule,
  optimizeSource,
  printModule,
  moduleToJSON,
  explainSteps,
  buildProject,
} from "./index.js"
import { ERROR_CODES, formatDiagnostic, type Diagnostic } from "./errors.js"
import { getStdlibDoc } from "./stdlib.js"
import { analyze } from "./analyzer.js"
import type { Program } from "./ast.js"
import { serve } from "./serve.js"

const VERSION = "v0.3.0"

const ERROR_GUIDES: Record<string, { title: string; how: string[] }> = {
  [ERROR_CODES.UNDEFINED_VARIABLE]: {
    title: "Using a name that doesn't exist yet",
    how: [
      "Check the spelling — did you mean a name you already created?",
      "Create it first with:  set name = ...",
      "If it's a loop variable, it only exists inside the loop.",
    ],
  },
  [ERROR_CODES.WRONG_ARG_COUNT]: {
    title: "Giving a function the wrong number of values",
    how: [
      "Count the values you pass and the ones the function asks for.",
      "Use 'plainly explain <function>' to see the correct shape.",
    ],
  },
  [ERROR_CODES.RETURN_OUTSIDE_FUNCTION]: {
    title: "'return' used outside a function",
    how: ["Move the 'return' line inside a function block.", "Top-level code doesn't return; just use 'say' to show a value."],
  },
  [ERROR_CODES.DIVIDE_BY_ZERO]: {
    title: "Dividing by zero",
    how: ["Check the value on the right side of '/'.", "If it can be zero, check it first:  if divider != 0:"],
  },
  [ERROR_CODES.TYPE_MISMATCH]: {
    title: "Using a value of the wrong kind",
    how: [
      "Numbers add and compare with numbers; text joins with text.",
      "Use number(...) or text(...) to convert between them.",
    ],
  },
  [ERROR_CODES.INDEX_OUT_OF_RANGE]: {
    title: "Reaching past the end of a list or text",
    how: ["Positions start at 0, so the last one is length(...) - 1.", "Check with:  if position < length(items):"],
  },
  [ERROR_CODES.NOT_A_FUNCTION]: {
    title: "Calling something that isn't a function",
    how: ["You can only call functions — builtins like length(...) or ones you make with function ...:"],
  },
  [ERROR_CODES.BAD_INDENTATION]: {
    title: "Indentation doesn't line up",
    how: ["Use 2 spaces per level, consistently.", "Every line in a block must align exactly with the line above it."],
  },
  [ERROR_CODES.MISSING_QUOTE]: {
    title: "A string is missing its closing quote",
    how: ['Add a " at the end of the text.'],
  },
  [ERROR_CODES.UNKNOWN_CHARACTER]: {
    title: "A character Plainly doesn't know",
    how: ["Remove it or check for a typo."],
  },
  [ERROR_CODES.BAD_ESCAPE]: {
    title: "Unknown escape sequence in a string",
    how: ['Valid escapes: \\n (newline), \\t (tab), \\" (quote), \\\\ (backslash).'],
  },
  [ERROR_CODES.UNEXPECTED_TOKEN]: {
    title: "Unexpected text",
    how: ["Read the line carefully — something is missing or out of place.", "Blocks need a colon at the end of the first line."],
  },
  [ERROR_CODES.EMPTY_BLOCK]: {
    title: "An empty block",
    how: ["Add at least one indented line after the colon."],
  },
  [ERROR_CODES.DUPLICATE_PARAMETER]: {
    title: "Two parameters with the same name",
    how: ["Give each parameter a different name."],
  },
  [ERROR_CODES.UNUSED_VARIABLE]: {
    title: "A value that is set but never used",
    how: ["Use it somewhere below, or remove the line.", "It's only a warning — your program still runs."],
  },
  [ERROR_CODES.INVALID_OPERATION]: {
    title: "An operation that doesn't work on these values",
    how: ["Numbers add, text joins, lists combine with lists."],
  },
  [ERROR_CODES.RESERVED_NAME]: {
    title: "Using a reserved word as a name",
    how: ["Words like if, set, say and for are reserved. Pick another name."],
  },
  // ----- PIR diagnostics (Phase 3) -----
  PIR001: {
    title: "A PIR operation received the wrong value kind",
    how: ["Check what kind of value reaches the operation (number, text, true/false).", "This usually means a compiler bug — please report it."],
  },
  PIR002: {
    title: "An unknown PIR operation",
    how: ["The module contains an operation Plainly doesn't know.", "This usually means a compiler bug — please report it."],
  },
  PIR003: {
    title: "A builtin got the wrong number of values in PIR",
    how: ["Count the values passed to the function."],
  },
  PIR004: {
    title: "A call to something that doesn't exist in PIR",
    how: ["Check the function name spelling."],
  },
  PIR005: {
    title: "A PIR function never returns",
    how: ["Add a return statement at the end of the function."],
  },
  PIR007: {
    title: "PIR reads a variable before it is stored",
    how: ["Make sure the variable is created before it is read."],
  },
  PIR008: {
    title: "A reference to an unknown database entity",
    how: ["Declare the entity with a database block before using it."],
  },
  PIR009: {
    title: "A PIR value is used before it is computed",
    how: ["Values must be produced before the operation that consumes them.", "This usually means a compiler bug — please report it."],
  },
}

function readSource(file: string): string {
  if (!fs.existsSync(file)) {
    console.error(`I couldn't find the file '${file}'. Check the path and try again.`)
    process.exit(1)
  }
  return fs.readFileSync(file, "utf-8")
}

function handlePlainError(err: unknown, source: string): void {
  if (err instanceof PlainError) {
    console.error(formatError(err, source))
    process.exit(1)
  }
  throw err
}

function printDiagnostics(diags: Diagnostic[], source: string): void {
  for (const d of diags) {
    console.log(formatDiagnostic(d, source))
    console.log()
  }
  const errors = diags.filter((d) => d.severity === "error").length
  const warnings = diags.filter((d) => d.severity === "warning").length
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`)
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`)
  if (parts.length > 0) {
    console.log(`Found ${parts.join(" and ")}.`)
  }
}

function main(): void {
  const [, , command = "help", ...rest] = process.argv

  switch (command) {
    case "run":
      return cmdRun(rest[0])
    case "check":
      return cmdCheck(rest[0])
    case "ast":
      return cmdAst(rest[0])
    case "compile":
      return cmdCompile(rest)
    case "build":
      return cmdBuild(rest)
    case "serve":
      return cmdServe(rest)
    case "optimize":
      return cmdOptimize(rest[0])
    case "inspect":
      return cmdInspect(rest[0])
    case "explain":
      return cmdExplain(rest[0])
    case "repl":
      return cmdRepl()
    case "version":
    case "--version":
      console.log(`Plainly ${VERSION}`)
      return
    case "help":
    case "--help":
    case undefined:
      return printHelp()
    default:
      console.error(`I don't know the command '${command}'. Try 'plainly help'.`)
      process.exit(1)
  }
}

function cmdRun(file: string | undefined): void {
  if (!file) {
    console.error("The 'run' command needs a file. Try: plainly run app.pl")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    const { warnings } = runSource(source, (s) => console.log(s))
    for (const w of warnings) {
      console.error(formatDiagnostic(w, source))
    }
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdCheck(file: string | undefined): void {
  if (!file) {
    console.error("The 'check' command needs a file. Try: plainly check app.pl")
    process.exit(1)
  }
  const source = readSource(file)
  let ast: Program
  try {
    ast = compileToAst(source)
  } catch (err) {
    handlePlainError(err, source)
    process.exit(1)
  }
  try {
    const { diagnostics } = analyze(ast)
    if (diagnostics.length === 0) {
      const stmtCount = ast.body.length
      console.log(
        `All good! No problems found (${stmtCount} statement${stmtCount === 1 ? "" : "s"}).`,
      )
      return
    }
    printDiagnostics(diagnostics, source)
    const hasErrors = diagnostics.some((d) => d.severity === "error")
    process.exit(hasErrors ? 1 : 0)
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdAst(file: string | undefined): void {
  if (!file) {
    console.error("The 'ast' command needs a file. Try: plainly ast app.pl")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    console.log(JSON.stringify(compileToAst(source), null, 2))
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdBuild(args: string[]): void {
  const file = args.find((a) => !a.startsWith("-"))
  const outIdx = args.indexOf("-o")
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null
  if (!file) {
    console.error("The 'build' command needs a file. Try: plainly build app.pl -o my-app")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    const result = buildProject(source)
    const dir = outDir ?? (result.module.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "plainly-app")
    for (const f of result.files) {
      const target = path.join(dir, f.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, f.content)
    }
    console.log(`Built ${result.module.app?.name ?? result.module.name} → ${dir}/`)
    for (const line of result.summary.slice(1)) console.log(`  ${line}`)
    console.log(`\nNext steps:`)
    console.log(`  1. psql -d your_db -f ${dir}/database/schema.sql`)
    console.log(`  2. cd ${dir}/server && npm install && npm run dev`)
    console.log(`  3. cd ${dir}/client && npm install && npm run dev`)
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdServe(args: string[]): void {
  const dir = args.find((a) => !a.startsWith("-")) ?? "."
  const portIdx = args.indexOf("-p")
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 3443
  const insecure = args.includes("--http")
  serve({ root: dir, port, insecure })
}

function cmdCompile(args: string[]): void {
  const file = args.find((a) => !a.startsWith("--"))
  const emit = (args.find((a) => a.startsWith("--emit"))?.split("=")[1] ??
    (args.includes("--emit") ? args[args.indexOf("--emit") + 1] : "pir")) as "ast" | "pir" | "json"
  const pretty = args.includes("--pretty")
  if (!file) {
    console.error("The 'compile' command needs a file. Try: plainly compile app.pl --emit pir")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    if (emit === "ast") {
      console.log(JSON.stringify(compileToAst(source), null, 2))
      return
    }
    const module = compileToPir(source)
    if (emit === "json") {
      console.log(pretty ? JSON.stringify(JSON.parse(moduleToJSON(module)), null, 2) : moduleToJSON(module))
    } else {
      console.log(printModule(module))
    }
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdOptimize(file: string | undefined): void {
  if (!file) {
    console.error("The 'optimize' command needs a file. Try: plainly optimize app.pl")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    const { module, passes } = optimizeSource(source)
    console.log(printModule(module))
    console.log()
    for (const note of passes.report) console.log(`  ✓ ${note}`)
    if (passes.report.length === 0) console.log("  (nothing to optimize — already optimal)")
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdInspect(file: string | undefined): void {
  if (!file) {
    console.error("The 'inspect' command needs a file. Try: plainly inspect app.pl")
    process.exit(1)
  }
  const source = readSource(file)
  try {
    const ast = compileToAst(source)
    const module = compileToPir(source)
    const pirValidation = validateModule(module)
    const { passes } = optimizeSource(source)
    const appEntity = module.app?.name
    console.log(`Source
  ✓ Parsed (${ast.body.length} statement${ast.body.length === 1 ? "" : "s"})

AST
  ✓ Valid

PIR
  ✓ Valid (module '${module.name}'${appEntity ? `, app "${appEntity}"` : ""}, ${module.functions.length} function${module.functions.length === 1 ? "" : "s"}, ${module.entities.length} entit${module.entities.length === 1 ? "y" : "ies"})

Optimization
${passes.report.length > 0 ? passes.report.map((r) => `  ✓ ${r}`).join("\n") : "  ✓ No changes needed"}

Ready for target compilation.`)
    void pirValidation
  } catch (err) {
    handlePlainError(err, source)
  }
}

function cmdExplain(name: string | undefined): void {
  // `plainly explain program.pl` — explain what a program means, step by step.
  if (name && name.endsWith(".pl")) {
    const source = readSource(name)
    try {
      const steps = explainSteps(source)
      if (steps.length === 0) {
        console.log("This program is empty — add some statements to see what it means.")
        return
      }
      console.log(`Your program, step by step:\n`)
      for (const step of steps) console.log(`  ${step}`)
      console.log(`\nThat's what Plainly understands by '${name}'.`)
    } catch (err) {
      handlePlainError(err, source)
    }
    return
  }
  if (!name) {
    console.log(`What should I explain?

  plainly explain PL-002      Explain an error code
  plainly explain length       Explain a builtin function
  plainly explain              (you're here)`)
    return
  }

  const code = name.toUpperCase()
  const guide = ERROR_GUIDES[code]
  if (guide) {
    console.log(`${code} — ${guide.title}`)
    console.log("")
    for (const h of guide.how) console.log(`  - ${h}`)
    return
  }

  const doc = getStdlibDoc(name)
  if (doc) {
    console.log(`${doc.signature}`)
    console.log(`  ${doc.summary}`)
    console.log(`  Example: ${doc.example}`)
    return
  }

  console.log(`I don't know '${name}' as an error code or a function.
Try a code like PL-002, or a function like length, uppercase or push.`)
  process.exit(1)
}

function cmdRepl(): void {
  console.log(`Plainly ${VERSION} — interactive mode`)
  console.log('Type an expression or statement. Ctrl+C to exit.\n')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "plainly> ",
  })
  rl.prompt()
  rl.on("line", (line) => {
    const input = line.trim()
    if (input === "") {
      rl.prompt()
      return
    }
    try {
      const { output } = runSource(input, (s) => console.log(s), { skipAnalysis: false })
      void output
    } catch (err) {
      if (err instanceof PlainError) {
        console.error(formatError(err, input))
      } else {
        throw err
      }
    }
    rl.prompt()
  })
}

function printHelp(): void {
  console.log(`Plainly ${VERSION} — a human-first programming language

Usage:
  plainly run <file.pl>              Run a Plainly file
  plainly check <file.pl>            Analyze without running — reports ALL problems
  plainly ast <file.pl>              Print the parsed AST as JSON
  plainly compile <file.pl>          Compile to PIR (default) or AST
      --emit pir|json|ast           Choose the output form
      --pretty                      Indent JSON output
  plainly build <file.pl> [-o DIR]   Generate a full-stack app (SQL + API + React)
  plainly serve [DIR] [-p PORT]       Serve a folder over local HTTPS (auto-certificate)
                                    add --http for plain http
  plainly optimize <file.pl>         Run optimization passes and show the result
  plainly inspect <file.pl>          Show the compiler pipeline status
  plainly explain [<file.pl>|<code>] Explain a program, error code (PL-002) or builtin (length)
  plainly repl                        Interactive prompt
  plainly version                     Show the version
  plainly help                        Show this help`)
}

main()
