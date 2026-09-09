/**
 * Plainly AST definitions.
 * The parser produces this tree; the interpreter walks it.
 *
 * v0.3 adds the application model: app / database / page / button /
 * state / show / create / title. These statements have AST-interpreter
 * behavior where meaningful (state, say inside buttons) and are lowered
 * to Application-PIR for the compiler pipeline.
 */

export interface Position {
  line: number // 1-based
  column: number // 1-based
}

export type BinaryOperator =
  | "+" | "-" | "*" | "/" | "%"
  | ">" | "<" | ">=" | "<=" | "==" | "!="
  | "and" | "or"

export type UnaryOperator = "not" | "-"

// ----- Expressions -----

export interface Identifier {
  kind: "Identifier"
  name: string
  pos: Position
}

export interface NumberLit {
  kind: "NumberLit"
  value: number
  pos: Position
}

export interface StringLit {
  kind: "StringLit"
  value: string
  pos: Position
}

export interface BoolLit {
  kind: "BoolLit"
  value: boolean
  pos: Position
}

export interface ListLit {
  kind: "ListLit"
  elements: Expr[]
  pos: Position
}

export interface BinaryExpr {
  kind: "BinaryExpr"
  left: Expr
  operator: BinaryOperator
  right: Expr
  pos: Position
}

export interface UnaryExpr {
  kind: "UnaryExpr"
  operator: UnaryOperator
  operand: Expr
  pos: Position
}

export interface CallExpr {
  kind: "CallExpr"
  callee: Expr
  args: Expr[]
  pos: Position
}

export interface MemberExpr {
  kind: "MemberExpr"
  object: Expr
  property: string
  pos: Position
}

export interface IndexExpr {
  kind: "IndexExpr"
  object: Expr
  index: Expr
  pos: Position
}

export type Expr =
  | Identifier
  | NumberLit
  | StringLit
  | BoolLit
  | ListLit
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | MemberExpr
  | IndexExpr

// ----- Statements -----

export interface SayStmt {
  kind: "SayStmt"
  value: Expr
  pos: Position
}

export interface SetStmt {
  kind: "SetStmt"
  name: string
  value: Expr
  pos: Position
}

export interface IfStmt {
  kind: "IfStmt"
  condition: Expr
  then: Block
  otherwise?: Block | IfStmt
  pos: Position
}

export interface ForEachStmt {
  kind: "ForEachStmt"
  varName: string
  iterable: Expr
  body: Block
  pos: Position
}

export interface RepeatStmt {
  kind: "RepeatStmt"
  count: Expr
  body: Block
  pos: Position
}

export interface FunctionDecl {
  kind: "FunctionDecl"
  name: string
  params: string[]
  body: Block
  pos: Position
}

export interface ReturnStmt {
  kind: "ReturnStmt"
  value?: Expr
  pos: Position
}

export interface ExprStmt {
  kind: "ExprStmt"
  expr: Expr
  pos: Position
}

// ----- Application model statements (v0.3) -----

export type FieldType = "text" | "number" | "boolean" | "money" | "email" | "date"

export interface EntityField {
  name: string
  type: FieldType
}

/** `app "Name"` — declares the application. Must be the first statement. */
export interface AppStmt {
  kind: "AppStmt"
  name: string
  pos: Position
}

/** `database Name: field: type …` — declares a data entity. */
export interface DatabaseStmt {
  kind: "DatabaseStmt"
  name: string
  fields: EntityField[]
  pos: Position
}

/** `title "…"` — sets the title of the enclosing page. */
export interface TitleStmt {
  kind: "TitleStmt"
  value: string
  pos: Position
}

/** `button "Label": …block…` — a clickable element with an event body. */
export interface ButtonStmt {
  kind: "ButtonStmt"
  label: string
  body: Block
  pos: Position
}

/** `show Entity` — display a list of the entity's records on a page. */
export interface ShowStmt {
  kind: "ShowStmt"
  entity: string
  pos: Position
}

/** `page "Name": …` — declares a page containing UI statements. */
export interface PageStmt {
  kind: "PageStmt"
  name: string
  body: Block
  pos: Position
}

/** `state count = 0` — declares a piece of UI state. */
export interface StateStmt {
  kind: "StateStmt"
  name: string
  value: Expr
  pos: Position
}

/** `create Entity` — adds a new record of the entity (button action). */
export interface CreateStmt {
  kind: "CreateStmt"
  entity: string
  pos: Position
}

/** `form "Label": field …` — declares a form that creates records of an entity. */
export interface FormStmt {
  kind: "FormStmt"
  label: string
  entity: string
  fields: EntityField[]
  pos: Position
}

export type Stmt =
  | SayStmt
  | SetStmt
  | IfStmt
  | ForEachStmt
  | RepeatStmt
  | FunctionDecl
  | ReturnStmt
  | ExprStmt
  | AppStmt
  | DatabaseStmt
  | PageStmt
  | TitleStmt
  | ButtonStmt
  | ShowStmt
  | StateStmt
  | CreateStmt
  | FormStmt

export interface Block {
  kind: "Block"
  body: Stmt[]
}

export interface Program {
  kind: "Program"
  body: Stmt[]
}

export type Node = Program | Stmt | Expr | Block
