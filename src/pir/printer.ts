/**
 * PIR Printer (v0.3).
 *
 * Renders a module as readable text:
 *
 *   module main
 *
 *   function main():
 *     entry:
 *       %0 = const 100
 *       %1 = const 5
 *       %2 = mul %0, %1
 *       store total, %2
 *       %3 = load total
 *       print %3
 *       return
 *
 * Also renders JSON (the machine form used by golden tests).
 */

import type { IRModule, IRFunction, IROperation, IRBlock } from "./ir.js"
import { OP_MNEMONIC } from "./operations.js"
import type { PirValueRef } from "./ir.js"

export function printModule(module: IRModule): string {
  const lines: string[] = []
  lines.push(`module ${module.name}`)
  if (module.app) lines.push(`app "${module.app.name}"`)
  for (const entity of module.entities) {
    lines.push("")
    lines.push(`db.entity ${entity.name}:`)
    for (const f of entity.fields) {
      lines.push(`  field ${f.name}: ${f.type}`)
    }
  }
  for (const fn of module.functions) {
    lines.push("")
    lines.push(`function ${fn.name}(${fn.parameters.join(", ")}):`)
    for (const block of fn.blocks) {
      printBlock(lines, block, 1)
    }
  }
  return lines.join("\n")
}

function printBlock(lines: string[], block: IRBlock, depth: number): void {
  const pad = "  ".repeat(depth)
  lines.push(`${pad}${block.label}:`)
  for (const op of block.ops) {
    // Inline body blocks (if/loops/event handlers)
    const body = op.attrs?.__body as IROperation[] | undefined
    if (body) {
      printGuarded(lines, op, body, depth + 1)
      continue
    }
    lines.push(`${pad}${printOp(op)}`)
  }
}

function printGuarded(lines: string[], op: IROperation, body: IROperation[], depth: number): void {
  const pad = "  ".repeat(depth)
  if (op.op === "jump_if_false") {
    lines.push(`${pad}if ${printRef(op.operands[0])} ${op.attrs?.else ? "otherwise:" : "then:"}`)
  } else if (op.op === "jump_if_true" && op.attrs?.forEach) {
    lines.push(`${pad}for each ${op.attrs.forEach} in ${printRef(op.operands[0])}:`)
  } else if (op.op === "jump_if_true" && op.attrs?.repeat) {
    lines.push(`${pad}repeat ${printRef(op.operands[0])} times:`)
  } else if (op.op === "event.click") {
    lines.push(`${pad}on click:`)
  } else {
    lines.push(`${pad}${printOp(op)}`)
  }
  for (const inner of body) {
    const innerBody = inner.attrs?.__body as IROperation[] | undefined
    if (innerBody) {
      printGuarded(lines, inner, innerBody, depth + 1)
    } else {
      lines.push(`${"  ".repeat(depth + 1)}${printOp(inner)}`)
    }
  }
}

function printRef(ref: PirValueRef): string {
  if (ref.kind === "const") {
    const v = ref.value
    if (typeof v === "string") return JSON.stringify(v)
    if (Array.isArray(v)) return JSON.stringify(v)
    return String(v)
  }
  return ref.name ?? "?"
}

export function printOp(op: IROperation): string {
  const mnemonic = OP_MNEMONIC[op.op] ?? op.op

  // Structural markers
  if (op.attrs?.__block === true) {
    return `endblock ${op.attrs.label ?? ""}`.trimEnd()
  }

  switch (op.op) {
    case "jump_if_false": {
      const cond = printRef(op.operands[0])
      return op.attrs?.forEach
        ? `for_each ${cond} → ${op.attrs.forEach}`
        : op.attrs?.repeat
          ? `repeat_times ${cond}`
          : `jump_if_false ${cond} → ${op.attrs?.then ?? "?"}`
    }
    case "jump_if_true":
      return op.op // unreachable in practice (forEach/repeat handled above)
    case "jump":
      return `jump ${op.attrs?.target ?? "?"}`
    case "call":
    case "call_user": {
      const callee = op.attrs?.callee ?? "?"
      const args = op.operands.map(printRef).join(", ")
      return op.result
        ? `${op.result} = ${mnemonic} ${callee}(${args})`
        : `${mnemonic} ${callee}(${args})`
    }
    case "const":
      return `${op.result ?? "%_"} = const ${printRef(op.operands[0])}`.replace(/%_ = /, "")
    case "db.entity": {
      const fields = (op.attrs?.fields as string[] | undefined) ?? []
      const rendered = fields.length > 0 ? ` { ${fields.join(", ")} }` : ""
      return `db.entity ${op.attrs?.entity ?? printRef(op.operands[0])}${rendered}`
    }
    case "ui.button":
      return `ui.button "${op.attrs?.label ?? printRef(op.operands[0])}":`
    case "app.create":
      return `app.create ${op.attrs?.label ? JSON.stringify(op.attrs.label) : printRef(op.operands[0])}`
    case "form.create":
      return `form.create ${JSON.stringify(String(op.attrs?.label ?? ""))} → ${op.attrs?.entity ?? "?"}:`
    case "form.field":
      return `  form.field ${op.attrs?.name ?? "?"}: ${op.attrs?.type ?? "?"}`
    case "form.submit":
      return `  form.submit → db.create ${op.attrs?.entity ?? "?"}`
    default: {
      const args = op.operands.map(printRef).join(", ")
      if (op.result) {
        return `${op.result} = ${mnemonic}${args ? " " + args : ""}`
      }
      return `${mnemonic}${args ? " " + args : ""}`
    }
  }
}

/** Machine form: plain JSON (used by golden tests). */
export function moduleToJSON(module: IRModule): string {
  return JSON.stringify(module, null, 2)
}

/** Strip volatile fields (positions) for stable snapshots. */
export function moduleToStableJSON(module: IRModule): string {
  const stable = JSON.parse(JSON.stringify(module)) as IRModule
  for (const fn of stable.functions) {
    for (const block of fn.blocks) {
      for (const op of block.ops) {
        delete op.pos
      }
    }
  }
  return JSON.stringify(stable, null, 2)
}

export function printFunction(fn: IRFunction): string {
  const lines: string[] = []
  lines.push(`function ${fn.name}(${fn.parameters.join(", ")}):`)
  for (const block of fn.blocks) printBlock(lines, block, 1)
  return lines.join("\n")
}
