/**
 * The AST is the single source of truth produced by the DSL. Nothing in this
 * module knows how to render SQL, that is the job of a compiler package
 * (e.g. `@pg-access/postgres`). Keeping the two separate is what lets the
 * same AST be validated, diffed, documented, or compiled for more than one
 * target in the future.
 */

export type Operation = "select" | "insert" | "update" | "delete";

export const OPERATIONS: readonly Operation[] = ["select", "insert", "update", "delete"];

export interface OwnerExpressionNode {
  readonly type: "owner";
  readonly column: string;
}

export interface AuthenticatedExpressionNode {
  readonly type: "authenticated";
}

export interface PublicExpressionNode {
  readonly type: "public";
}

export interface RoleExpressionNode {
  readonly type: "role";
  readonly role: string;
}

export interface AndExpressionNode {
  readonly type: "and";
  readonly expressions: readonly ExpressionNode[];
}

export interface OrExpressionNode {
  readonly type: "or";
  readonly expressions: readonly ExpressionNode[];
}

export interface NotExpressionNode {
  readonly type: "not";
  readonly expression: ExpressionNode;
}

export type ExpressionNode =
  | OwnerExpressionNode
  | AuthenticatedExpressionNode
  | PublicExpressionNode
  | RoleExpressionNode
  | AndExpressionNode
  | OrExpressionNode
  | NotExpressionNode;

export interface RowPolicyNode {
  readonly type: "rowPolicy";
  readonly operation: Operation;
  readonly expression: ExpressionNode;
}

export interface TableNode {
  readonly type: "table";
  readonly name: string;
  readonly rowPolicies: readonly RowPolicyNode[];
}

export interface AuthNode {
  readonly type: "auth";
  readonly tables: readonly TableNode[];
}
