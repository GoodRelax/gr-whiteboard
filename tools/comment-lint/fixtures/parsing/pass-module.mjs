// Why: An .mjs file is parsed as a module.
import { readFileSync } from "node:fs";

// @purity semi-pure-mutable
export function read(file) {
  const text = readFileSync(file, "utf8");
  return text;
}

// @purity pure
export default function (value) {
  const copy = value;
  return copy;
}
