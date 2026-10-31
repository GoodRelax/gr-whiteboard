"use strict";

// BoardFiles: the checks for image files (FR-080, FR-083).

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkFile, addFiles, MAX_FILE_CHARS, MAX_TOTAL_CHARS } = require("../../skills/whiteboard-server/scripts/lib/board-files");

// @purity pure
function png(id, extraChars = 0) {
  return { id, mimeType: "image/png", dataURL: "data:image/png;base64," + "A".repeat(4 + extraChars), created: 1 };
}

test("a PNG, JPEG, GIF, or WebP file passes; other types and bad data do not", () => {
  assert.ok(checkFile(png("abcdefgh")).file);
  assert.ok(checkFile({ id: "abcdefgh", mimeType: "image/jpeg", dataURL: "data:image/jpeg;base64,AAAA" }).file);
  assert.match(checkFile({ id: "abcdefgh", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,AAAA" }).reason, /not allowed/);
  assert.equal(checkFile({ ...png("abcdefgh"), mimeType: "image/jpeg" }).reason, "dataURL does not match the type");
  assert.equal(checkFile(png("../../evil")).reason, "bad id");
  assert.equal(checkFile(png("short")).reason, "bad id");
  assert.equal(checkFile(null).reason, "not an object");
  assert.equal(checkFile(png("abcdefgh", MAX_FILE_CHARS)).reason, "file is too large");
});

test("checkFile keeps only the known fields", () => {
  const { file } = checkFile({ ...png("abcdefgh"), extra: "x" });
  assert.deepEqual(Object.keys(file).sort(), ["created", "dataURL", "id", "mimeType"]);
});

test("addFiles adds new files once, and stops at the total limit", () => {
  const files = new Map();
  const first = addFiles(files, [png("aaaaaaaa"), png("aaaaaaaa"), { id: "bbbbbbbb", mimeType: "text/html" }]);
  assert.deepEqual(first.added.map((f) => f.id), ["aaaaaaaa"]);
  assert.deepEqual(first.rejected.map((r) => r.id), ["bbbbbbbb"]);
  assert.equal(addFiles(files, [png("aaaaaaaa")]).added.length, 0);

  const big = Math.floor(MAX_FILE_CHARS / 2);
  const full = new Map();
  let i = 0;
  while (true) {
    const result = addFiles(full, [png(`big${String(i).padStart(5, "0")}`, big)]);
    if (result.rejected.length > 0) {
      assert.equal(result.rejected[0].reason, "the Board has too many images");
      break;
    }
    i += 1;
  }
  assert.ok(i * big <= MAX_TOTAL_CHARS);
  assert.equal(addFiles(full, "not a list").added.length, 0);
});
