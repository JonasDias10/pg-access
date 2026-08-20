/**
 * Quotes a SQL identifier (table name, column name, policy name, role name).
 * Never interpolate identifiers into SQL without this. Doubling embedded
 * double quotes is what prevents identifier-based SQL injection.
 */
export function quoteIdent(identifier: string): string {
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new Error("Cannot quote an empty SQL identifier.");
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Quotes a SQL string literal. Never interpolate arbitrary values into SQL
 * without this. Doubling embedded single quotes is what prevents
 * string-literal SQL injection.
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * PostgreSQL's `PUBLIC` in `CREATE POLICY ... TO PUBLIC` is a keyword, not a
 * role identifier. Quoting it (`"public"`) would instead reference an
 * actual role named "public", which is a different thing. Every other role
 * is a real identifier and must be quoted like one.
 */
export function quoteRole(role: string): string {
  return role.toLowerCase() === "public" ? "public" : quoteIdent(role);
}
