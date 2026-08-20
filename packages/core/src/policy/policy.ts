import type { AuthNode, ExpressionNode, TableNode } from "../ast/nodes.js";

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

/**
 * PostgreSQL truncates identifiers longer than this (NAMEDATALEN=64, minus
 * 1 byte for the internal terminator) without warning, on the default
 * build. Two differently-named columns/tables/roles that only differ after
 * byte 63 would silently collide once compiled. Measured in UTF-8 bytes,
 * not characters, since that's what NAMEDATALEN actually counts.
 */
const POSTGRES_MAX_IDENTIFIER_BYTES = 63;

const utf8Encoder = new TextEncoder();

function validateIdentifierLength(name: string, path: string): ValidationError[] {
  const byteLength = utf8Encoder.encode(name).length;
  return byteLength > POSTGRES_MAX_IDENTIFIER_BYTES
    ? [
        {
          path,
          message: `"${name}" is ${byteLength} bytes long; PostgreSQL silently truncates identifiers over ${POSTGRES_MAX_IDENTIFIER_BYTES} bytes.`,
        },
      ]
    : [];
}

function validateExpression(expression: ExpressionNode, path: string): ValidationError[] {
  switch (expression.type) {
    case "owner":
      return expression.column.trim().length === 0
        ? [{ path, message: "owner(column) requires a non-empty column name." }]
        : validateIdentifierLength(expression.column, path);
    case "role":
      return expression.role.trim().length === 0
        ? [{ path, message: "role(name) requires a non-empty role name." }]
        : validateIdentifierLength(expression.role, path);
    case "authenticated":
    case "public":
      return [];
    case "and":
    case "or":
      return expression.expressions.length < 2
        ? [{ path, message: `${expression.type}(...) requires at least two expressions.` }]
        : expression.expressions.flatMap((child, index) =>
            validateExpression(child, `${path}.${expression.type}[${index}]`),
          );
    case "not":
      return validateExpression(expression.expression, `${path}.not`);
  }
}

function validateTable(table: TableNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (table.name.trim().length === 0) {
    errors.push({ path: "table", message: "Table name must not be empty." });
  } else {
    errors.push(...validateIdentifierLength(table.name, "table"));
  }

  for (const policy of table.rowPolicies) {
    errors.push(...validateExpression(policy.expression, `${table.name}.rows.${policy.operation}`));
  }

  return errors;
}

/**
 * Structural validation of the AST: malformed expressions, empty
 * identifiers, and similar authoring mistakes. This does not (and cannot,
 * from `@pg-access/core` alone) check that referenced tables or columns
 * actually exist in a database. That belongs to a compiler or CLI step
 * with schema access.
 */
export function validate(auth: AuthNode): ValidationResult {
  const errors = auth.tables.flatMap((table) => validateTable(table));
  return { valid: errors.length === 0, errors };
}
