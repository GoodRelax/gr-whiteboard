"use strict";
// Every SKILL.md must have a frontmatter that a YAML parser accepts, or Claude Code skips the skill.
// The descriptions are plain (unquoted) scalars, so ": " or " #" inside one breaks the parse.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SKILLS_DIR = path.join(__dirname, "..", "..", "skills");

function frontmatterLines(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${file} has no frontmatter`);
  return match[1].split("\n");
}

for (const name of fs.readdirSync(SKILLS_DIR)) {
  const file = path.join(SKILLS_DIR, name, "SKILL.md");
  if (!fs.existsSync(file)) continue;
  test(`the frontmatter of ${name} parses as plain YAML`, () => {
    const lines = frontmatterLines(file);
    const keys = lines.map((line) => /^([a-z-]+): /.exec(line)).filter(Boolean).map((m) => m[1]);
    assert.ok(keys.includes("name"), "name is missing");
    assert.ok(keys.includes("description"), "description is missing");
    for (const line of lines) {
      const value = line.replace(/^[a-z-]+: /, "");
      if (/^["']/.test(value)) continue;
      assert.ok(!value.includes(": "), `": " in a plain value breaks YAML: ${line.slice(0, 60)}`);
      assert.ok(!value.includes(" #"), `" #" in a plain value starts a comment: ${line.slice(0, 60)}`);
    }
  });
}
