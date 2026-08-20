import type { AuthNode, ExpressionNode, Operation, RowPolicyNode, TableNode } from "./nodes.js";
import { OPERATIONS } from "./nodes.js";

export type RowPolicyMap = Partial<Record<Operation, ExpressionNode>>;

export interface TableConfig {
  readonly rows?: RowPolicyMap;
}

export type AuthConfig = Record<string, TableConfig>;

function buildRowPolicies(rows: RowPolicyMap | undefined): RowPolicyNode[] {
  if (!rows) {
    return [];
  }

  const policies: RowPolicyNode[] = [];
  for (const operation of OPERATIONS) {
    const expression = rows[operation];
    if (expression !== undefined) {
      policies.push({ type: "rowPolicy", operation, expression });
    }
  }
  return policies;
}

function buildTable(name: string, config: TableConfig): TableNode {
  return {
    type: "table",
    name,
    rowPolicies: buildRowPolicies(config.rows),
  };
}

export function buildAuthNode(config: AuthConfig): AuthNode {
  const tables = Object.entries(config).map(([name, tableConfig]) => buildTable(name, tableConfig));
  return { type: "auth", tables };
}
