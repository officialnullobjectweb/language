import { describe, expect, it } from "vitest"
import { buildProject, generateSqlSchema, generateBackend, generateFrontend, compileToPir } from "../../src/index.js"

const SHOP = `app "Shop"

database Product:
    name: text
    price: number

page "Products":
    title "Catalog"
    show Product
    form "Add Product" from Product:
        field name: text
        field price: number
`

describe("SQL generator", () => {
  it("creates a table per entity with snake_case names (quoted for reserved words)", () => {
    const module = compileToPir(SHOP)
    const files = generateSqlSchema(module)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe("database/schema.sql")
    expect(files[0].content).toContain('CREATE TABLE IF NOT EXISTS "product" (')
    expect(files[0].content).toContain('"name" TEXT,')
    expect(files[0].content).toContain('"price" NUMERIC(12,2),')
    expect(files[0].content).toContain("id SERIAL PRIMARY KEY,")
    expect(files[0].content).toContain("created_at TIMESTAMPTZ")
  })

  it("maps field types to SQL types", () => {
    const module = compileToPir('app "T"\ndatabase Task:\n    done: boolean\n    due: date\n    cost: money')
    const [file] = generateSqlSchema(module)
    expect(file.content).toContain('"done" BOOLEAN NOT NULL DEFAULT FALSE')
    expect(file.content).toContain('"due" DATE')
    expect(file.content).toContain('"cost" NUMERIC(12,2)')
  })

  it("quotes SQL reserved words like order and user", () => {
    const module = compileToPir('app "S"\ndatabase Order:\n    total: number\ndatabase User:\n    name: text')
    const [file] = generateSqlSchema(module)
    expect(file.content).toContain('CREATE TABLE IF NOT EXISTS "order"')
    expect(file.content).toContain('CREATE TABLE IF NOT EXISTS "user"')
  })
})

describe("Node backend generator", () => {
  it("emits a runnable server with CRUD routes", () => {
    const module = compileToPir(SHOP)
    const files = generateBackend(module)
    const server = files.find((f) => f.path === "server/server.mjs")!
    expect(server).toBeDefined()
    expect(server.content).toContain('app.get("/api/health"')
    expect(server.content).toContain('app.get("/api/product"')
    expect(server.content).toContain('app.post("/api/product"')
    expect(server.content).toContain('app.delete("/api/product/:id"')
    expect(server.content).toContain('req.body["name"]')
    // No syntax errors: quotes inside SQL use template literals
    expect(server.content).not.toContain('r.name AS "name"')
  })

  it("uses template literals for SQL (valid JS)", () => {
    const module = compileToPir(SHOP)
    const files = generateBackend(module)
    const server = files.find((f) => f.path === "server/server.mjs")!
    expect(server.content).toContain("`SELECT id,")
  })
})

describe("React frontend generator", () => {
  it("emits one component per page with form + show", () => {
    const module = compileToPir(SHOP)
    const files = generateFrontend(module)
    const paths = files.map((f) => f.path)
    expect(paths).toContain("client/src/pages/products.tsx")
    expect(paths).toContain("client/src/api.ts")
    expect(paths).toContain("client/src/App.tsx")
    const page = files.find((f) => f.path === "client/src/pages/products.tsx")!
    expect(page.content).toContain("productApi.list()")
    expect(page.content).toContain("submitProduct")
    expect(page.content).toContain('type="number"')
    expect(page.content).toContain("Add Product")
  })

  it("renders boolean fields as selects", () => {
    const module = compileToPir('app "T"\ndatabase Task:\n    done: boolean\npage "Home":\n    form "New" from Task:\n        field done: boolean')
    const files = generateFrontend(module)
    const page = files.find((f) => f.path.startsWith("client/src/pages/"))!
    expect(page.content).toContain("<select")
  })
})

describe("project generator (plainly build)", () => {
  it("assembles a complete project", () => {
    const result = buildProject(SHOP)
    const paths = result.files.map((f) => f.path)
    expect(paths).toContain("README.md")
    expect(paths).toContain("database/schema.sql")
    expect(paths).toContain("server/server.mjs")
    expect(paths).toContain("client/src/App.tsx")
    expect(result.summary.join("\n")).toContain("Shop")
  })

  it("handles apps with no pages (plain programs)", () => {
    const result = buildProject('set x = 1\nsay x')
    expect(result.files.length).toBeGreaterThan(5)
  })
})
