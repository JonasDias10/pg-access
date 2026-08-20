import type { Operation } from "../ast/nodes.js";
import { OPERATIONS } from "../ast/nodes.js";

export { OPERATIONS };

export function isOperation(value: string): value is Operation {
  return (OPERATIONS as readonly string[]).includes(value);
}
