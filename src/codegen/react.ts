/**
 * PIR → React + TypeScript frontend generator (v0.4).
 *
 * Reads the app model from PIR (pages, entities, forms, buttons, state) and
 * emits a small Vite + React + TypeScript project:
 *   - one page component per Plainly page
 *   - a shared api.ts client (fetch wrappers per entity)
 *   - forms render labeled inputs and POST to the generated API
 *   - show renders a live list from the API
 *
 * The generated code is deliberately boring: plain fetch, plain React.
 * Boring code is dependable code.
 */

import type { IRModule, IROperation } from "../pir/ir.js"
import { toSnakeCase } from "./sql.js"

export interface CodegenFile {
  path: string
  content: string
}

interface PageWidget {
  kind: "show" | "form" | "button" | "state"
  entity?: string
  label?: string
  stateName?: string
  stateValue?: string
}

interface PageInfo {
  name: string
  title: string | null
  widgets: PageWidget[]
}

interface PageAnalysis {
  pages: PageInfo[]
  /** Buttons at page level whose handlers do client-side work (say/state). */
  entitiesUsed: Set<string>
}

function analyzePages(module: IRModule): PageAnalysis {
  const pages: PageInfo[] = []
  const entitiesUsed = new Set<string>()
  const main = module.functions[0]
  if (!main) return { pages, entitiesUsed }

  let current: PageInfo | null = null
  const visit = (ops: IROperation[]): void => {
    for (const op of ops) {
      switch (op.op) {
        case "ui.page":
          current = { name: String(op.attrs?.page ?? "Page"), title: null, widgets: [] }
          pages.push(current)
          break
        case "ui.title":
          if (current) current.title = String(op.operands[0]?.value ?? "")
          break
        case "ui.show": {
          const entity = String(op.attrs?.entity ?? op.operands[0]?.value ?? "")
          if (current) current.widgets.push({ kind: "show", entity })
          entitiesUsed.add(entity)
          break
        }
        case "ui.button":
          if (current) current.widgets.push({ kind: "button", label: String(op.attrs?.label ?? "Button") })
          break
        case "state.create":
          if (current)
            current.widgets.push({
              kind: "state",
              stateName: String(op.operands[0]?.value ?? "value"),
              stateValue: String(op.operands[1]?.value ?? ""),
            })
          break
        case "form.create": {
          const entity = String(op.attrs?.entity ?? "")
          if (current) current.widgets.push({ kind: "form", entity, label: String(op.attrs?.label ?? "Form") })
          entitiesUsed.add(entity)
          break
        }
        default: {
          const body = op.attrs?.__body as IROperation[] | undefined
          if (body) visit(body)
        }
      }
    }
  }
  visit(main.blocks[0]?.ops ?? [])
  return { pages, entitiesUsed }
}

function entityInfo(module: IRModule) {
  return module.entities.map((e) => ({
    name: e.name,
    route: toSnakeCase(e.name).replace(/_/g, "-"),
    fields: e.fields.map((f) => ({ name: f.name, type: f.type })),
  }))
}

export function generateFrontend(module: IRModule): CodegenFile[] {
  const appName = module.app?.name ?? module.name
  const { pages } = analyzePages(module)
  const entities = entityInfo(module)
  const files: CodegenFile[] = []

  const tsxFor = (t: string) => `${t}
`

  // ---- package.json ----
  files.push({
    path: "client/package.json",
    content: JSON.stringify(
      {
        name: `${toSnakeCase(appName)}-client`,
        private: true,
        version: "0.4.0",
        type: "module",
        scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
        dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
        devDependencies: {
          "@types/react": "^18.3.12",
          "@types/react-dom": "^18.3.1",
          "@vitejs/plugin-react": "^4.3.4",
          typescript: "^5.6.0",
          vite: "^5.4.11",
        },
      },
      null,
      2,
    ),
  })

  files.push({
    path: "client/tsconfig.json",
    content: JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          useDefineForClassFields: true,
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
        },
        include: ["src"],
      },
      null,
      2,
    ),
  })

  files.push({
    path: "client/vite.config.ts",
    content: `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
})
`,
  })

  files.push({
    path: "client/index.html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  })

  files.push({
    path: "client/src/main.tsx",
    content: tsxFor(`import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`),
  })

  // ---- api.ts ----
  const apiLines: string[] = [
    `// API client — generated by Plainly v0.4`,
    `async function req<T>(method: string, url: string, body?: unknown): Promise<T> {`,
    `  const res = await fetch(url, {`,
    `    method,`,
    `    headers: body ? { "Content-Type": "application/json" } : undefined,`,
    `    body: body ? JSON.stringify(body) : undefined,`,
    `  })`,
    `  if (!res.ok) throw new Error(\`API \${method} \${url} failed: \${res.status}\`)`,
    `  return res.status === 204 ? (undefined as T) : res.json()`,
    `}`,
    ``,
  ]
  for (const e of entities) {
    const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    const pascal = camel.charAt(0).toUpperCase() + camel.slice(1)
    apiLines.push(`export interface ${pascal} { id: number; ${e.fields.map((f) => `${JSON.stringify(f.name)}: string | number | boolean`).join("; ")} }`)
    apiLines.push(`export const ${camel}Api = {`)
    apiLines.push(`  list: () => req<${pascal}[]>("GET", "/api/${camel}"),`)
    apiLines.push(`  create: (data: Omit<${pascal}, "id">) => req<${pascal}>("POST", "/api/${camel}", data),`)
    apiLines.push(`  remove: (id: number) => req<void>("DELETE", \`/api/${camel}/\${id}\`),`)
    apiLines.push(`}`)
    apiLines.push(``)
  }
  files.push({ path: "client/src/api.ts", content: apiLines.join("\n") })

  // ---- App.tsx ----
  const imports = pages.map((p, i) => `import Page${i} from "./pages/${toSnakeCase(p.name).replace(/_/g, "-")}"`).join("\n")
  const nav = pages.map((p, i) => `        <a href="#/${toSnakeCase(p.name).replace(/_/g, "-")}">${p.name}</a>`).join("\n")
  files.push({
    path: "client/src/App.tsx",
    content: tsxFor(`import { useState } from "react"
${imports}

export default function App() {
  const [page, setPage] = useState(window.location.hash || "#/${pages.length > 0 ? toSnakeCase(pages[0].name).replace(/_/g, "-") : "home"}")
  window.addEventListener("hashchange", () => setPage(window.location.hash))

  return (
    <div className="app">
      <header className="app-header">
        <h1>${appName}</h1>
        <nav>
${nav}
        </nav>
      </header>
      <main>
        {page.replace("#/", "") === "" && <Page0 />}
${pages
  .map(
    (p, i) =>
      `        {page.replace("#/", "") === "${toSnakeCase(p.name).replace(/_/g, "-")}" && <Page${i} />}`,
  )
  .join("\n")}
      </main>
    </div>
  )
}
`),
  })

  // ---- styles.css ----
  files.push({
    path: "client/src/styles.css",
    content: `/* Generated by Plainly v0.4 */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #fdf9f3; color: #2b2622; }
.app { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
.app-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
.app-header h1 { color: #e8590c; }
.app-header nav a { margin-left: 1rem; color: #6b5f55; text-decoration: none; }
.app-header nav a:hover { color: #e8590c; }
.card { background: white; border: 1px solid #e7dccd; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
.list-item { display: flex; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid #eee2d0; }
.list-item:last-child { border-bottom: none; }
button { background: #e8590c; color: white; border: none; border-radius: 8px; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
button:hover { background: #d24902; }
input, select { padding: 0.55rem 0.75rem; border: 1px solid #d9c9b2; border-radius: 8px; font-size: 1rem; width: 100%; }
label { display: block; margin: 0.75rem 0 0.3rem; font-weight: 500; }
.empty { color: #9b8d80; padding: 1rem 0; }
h2 { margin-bottom: 1rem; }
`,
  })

  // ---- one component per page ----
  pages.forEach((page, pageIndex) => {
    const usedEntities = entityInfo(module).filter((e) => page.widgets.some((w) => w.entity === e.name))
    const pageFile: string[] = [
      `// ${page.name} — generated from Plainly page "${page.name}"`,
      `import { useEffect, useState } from "react"`,
    ]
    for (const e of usedEntities) {
      const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      pageFile.push(`import { ${camel}Api, type ${camel.charAt(0).toUpperCase() + camel.slice(1)} } from "../api"`)
    }
    pageFile.push(``)
    pageFile.push(`export default function Page${pageIndex}() {`)

    // state hooks per show-entity and per Plainly state widget
    for (const e of usedEntities) {
      const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      const pascal = camel.charAt(0).toUpperCase() + camel.slice(1)
      pageFile.push(`  const [${camel}List, set${pascal}List] = useState<${pascal}[]>([])`)
    }
    for (const w of page.widgets.filter((x) => x.kind === "state")) {
      const raw = w.stateValue ?? ""
      const sv = raw === "true" || raw === "false" || raw === "" ? raw : /^-?\d+(\.\d+)?$/.test(raw) ? raw : JSON.stringify(raw)
      const stateCamel = toSnakeCase(w.stateName ?? "s").replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      const statePascal = stateCamel.charAt(0).toUpperCase() + stateCamel.slice(1)
      const stateType = /^-?\d/.test(sv) ? "number" : sv === "true" || sv === "false" ? "boolean" : "string | number | boolean"
      pageFile.push(`  const [${stateCamel}, set${statePascal}] = useState<${stateType}>(${sv === "" ? '""' : sv})`)
    }
    for (const e of usedEntities) {
      const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      pageFile.push(`  useEffect(() => { ${camel}Api.list().then(set${camel.charAt(0).toUpperCase() + camel.slice(1)}List).catch(() => {}) }, [])`)
    }

    // form state (one record draft per form)
    const forms = page.widgets.filter((w) => w.kind === "form")
    for (const f of forms) {
      const e = entities.find((x) => x.name === f.entity)!
      const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      const init = Object.fromEntries(e.fields.map((fd) => [fd.name, ""]))
      pageFile.push(`  const [${camel}Draft, set${camel.charAt(0).toUpperCase() + camel.slice(1)}Draft] = useState<Record<string, string>>(${JSON.stringify(init)})`)
      pageFile.push(`  const submit${camel.charAt(0).toUpperCase() + camel.slice(1)} = async (ev: React.FormEvent) => {`)
      pageFile.push(`    ev.preventDefault()`)
      pageFile.push(`    try {`)
      pageFile.push(`      const created = await ${camel}Api.create(${camel}Draft as never)`)
      pageFile.push(`      set${camel.charAt(0).toUpperCase() + camel.slice(1)}List((prev) => [created, ...prev])`)
      pageFile.push(`      set${camel.charAt(0).toUpperCase() + camel.slice(1)}Draft(${JSON.stringify(init)})`)
      pageFile.push(`    } catch { /* server error surfaces in console */ }`)
      pageFile.push(`  }`)
    }

    pageFile.push(``)
    pageFile.push(`  return (`)
    pageFile.push(`    <section>`)
    pageFile.push(`      <h2>${page.title ?? page.name}</h2>`)

    const renderWidgets = (list: PageWidget[]): string[] => {
      const out: string[] = []
      for (const w of list) {
        if (w.kind === "show" && w.entity) {
          const e = entities.find((x) => x.name === w.entity)!
          const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
          out.push(`      <div className="card">`)
          out.push(`        <h3>${e.name}</h3>`)
          out.push(`        {${camel}List.length === 0 && <p className="empty">Nothing here yet.</p>}`)
          out.push(`        {${camel}List.map((item) => (`)
          out.push(`          <div className="list-item" key={item.id}>`)
          out.push(`            <span>{String(item[${JSON.stringify(e.fields[0]?.name ?? "id")}])}</span>`)
          out.push(`            <small>{String(item[${JSON.stringify(e.fields[1]?.name ?? e.fields[0]?.name ?? "id")}])}</small>`)
          out.push(`          </div>`)
          out.push(`        ))}`)
          out.push(`      </div>`)
        } else if (w.kind === "form" && w.entity) {
          const e = entities.find((x) => x.name === w.entity)!
          const camel = toSnakeCase(e.name).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
          const P = camel.charAt(0).toUpperCase() + camel.slice(1)
          out.push(`      <form className="card" onSubmit={submit${P}} aria-label=${JSON.stringify(w.label ?? e.name)}>`)
          out.push(`        <h3>${w.label ?? "Add " + e.name}</h3>`)
          for (const fd of e.fields) {
            if (fd.type === "boolean") {
              out.push(`        <label>`)
              out.push(`          ${fd.name}`)
              out.push(`          <select value={String(${camel}Draft[${JSON.stringify(fd.name)}] ?? "")} onChange={(e) => set${P}Draft({ ...${camel}Draft, ${JSON.stringify(fd.name)}: e.target.value })}>`)
              out.push(`            <option value="">choose…</option>`)
              out.push(`            <option value="true">yes</option>`)
              out.push(`            <option value="false">no</option>`)
              out.push(`          </select>`)
              out.push(`        </label>`)
            } else {
              const inputType = fd.type === "number" || fd.type === "money" ? "number" : fd.type === "email" ? "email" : fd.type === "date" ? "date" : "text"
              out.push(`        <label>`)
              out.push(`          ${fd.name}`)
              out.push(`          <input type="${inputType}" value={${camel}Draft[${JSON.stringify(fd.name)}] ?? ""} onChange={(e) => set${P}Draft({ ...${camel}Draft, ${JSON.stringify(fd.name)}: e.target.value })} />`)
              out.push(`        </label>`)
            }
          }
          out.push(`        <button type="submit" style={{ marginTop: "1rem" }}>${w.label ?? "Save"}</button>`)
          out.push(`      </form>`)
        }
      }
      return out
    }
    pageFile.push(...renderWidgets(page.widgets))

    pageFile.push(`    </section>`)
    pageFile.push(`  )`)
    pageFile.push(`}`)
    files.push({
      path: `client/src/pages/${toSnakeCase(page.name).replace(/_/g, "-")}.tsx`,
      content: pageFile.join("\n") + "\n",
    })
  })

  if (pages.length === 0) {
    // Plain program (no app model): emit a friendly single page anyway.
    files.push({
      path: "client/src/pages/home.tsx",
      content: `export default function Home() {
  return (
    <section>
      <h2>${appName}</h2>
      <p className="empty">This Plainly program has no pages yet. Add a page block to build UI.</p>
    </section>
  )
}
`,
    })
  }

  return files
}
