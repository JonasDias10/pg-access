export { defineAuth } from "./define-auth.js";

export { and } from "./expressions/and.js";
export { authenticated } from "./expressions/authenticated.js";
export { not } from "./expressions/not.js";
export { or } from "./expressions/or.js";
export { owner } from "./expressions/owner.js";
export { publicAccess } from "./expressions/public.js";
export { role } from "./expressions/role.js";

export { isOperation, OPERATIONS } from "./policy/operations.js";
export { validate } from "./policy/policy.js";
export type { ValidationError, ValidationResult } from "./policy/policy.js";
export type {
  AuthConfig,
  ExpressionNode,
  Operation,
  RowPolicyMap,
  TableConfig,
} from "./policy/types.js";

export type {
  AndExpressionNode,
  AuthenticatedExpressionNode,
  AuthNode,
  NotExpressionNode,
  OrExpressionNode,
  OwnerExpressionNode,
  PublicExpressionNode,
  RoleExpressionNode,
  RowPolicyNode,
  TableNode,
} from "./ast/nodes.js";
