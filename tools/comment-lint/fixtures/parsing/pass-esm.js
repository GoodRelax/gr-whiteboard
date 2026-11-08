// Why: A .js file with import falls back to a module.
import { join } from "node:path";

// @purity pure
export const both = (left, right) => {
  const joined = join(left, right);
  return joined;
};
