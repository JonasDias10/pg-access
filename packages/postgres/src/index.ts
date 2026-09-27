export { compile } from "./compiler/compiler.js";
export type { CompileOptions, CompileResult } from "./compiler/compiler.js";

export { compileExpression } from "./compiler/expressions.js";

export {
  compilePolicy,
  policyName,
  renderAlterPolicy,
  renderCreatePolicy,
  renderDropPolicy,
  renderDropPolicyIfExists,
} from "./compiler/policies.js";
export type { CompiledPolicy } from "./compiler/policies.js";

export { quoteIdent, quoteLiteral, quoteRole } from "./compiler/identifiers.js";

export { postgresDialect } from "./dialect/postgres.js";
export type { Dialect } from "./dialect/postgres.js";

export { generateMigration, toMigrationFile } from "./migrations/generator.js";
export type { Migration, MigrationOptions } from "./migrations/generator.js";

export { renderRollback } from "./migrations/rollback.js";
export type { Rollback, RollbackInput } from "./migrations/rollback.js";

export { listManagedPolicies } from "./introspect/list-managed-policies.js";
export type { ManagedPolicy, PgQueryable } from "./introspect/list-managed-policies.js";

export { diffPolicies } from "./diff/diff-policies.js";
export type { PolicyDiffResult, PolicyRef } from "./diff/diff-policies.js";

export { planPolicyChanges } from "./diff/plan-policy-changes.js";
export type {
  PlanPolicyChangesOptions,
  PolicyChange,
  PolicyChangeKind,
  PolicyChangePlan,
} from "./diff/plan-policy-changes.js";
