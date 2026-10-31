"use strict";

// BoardFiles (Entity). Checks the image files that pages put on the Board (FR-080 to FR-084).
// Excalidraw keeps an image as an "image" Element with a fileId, and the picture itself as a
// file { id, mimeType, dataURL, created }. Pure functions.

// SVG is left out: an SVG file can hold scripts and links.
const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
// Length of the dataURL text. Base64 is 4/3 of the bytes, so this is about 6 MB of image.
const MAX_FILE_CHARS = 8 * 1024 * 1024;
// All files on the Board together.
const MAX_TOTAL_CHARS = 200 * 1024 * 1024;

// Returns { file } for a good file, or { reason } for a bad one.
// @purity pure
function checkFile(file) {
  if (!file || typeof file !== "object") return { reason: "not an object" };
  if (typeof file.id !== "string" || !FILE_ID_PATTERN.test(file.id)) return { reason: "bad id" };
  if (!IMAGE_TYPES.includes(file.mimeType)) return { reason: `type ${String(file.mimeType)} is not allowed` };
  if (typeof file.dataURL !== "string" || !file.dataURL.startsWith(`data:${file.mimeType};base64,`)) {
    return { reason: "dataURL does not match the type" };
  }
  if (file.dataURL.length > MAX_FILE_CHARS) return { reason: "file is too large" };
  const created = Number.isFinite(file.created) ? file.created : 0;
  return { file: Object.freeze({ id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created }) };
}

// @purity pure
function totalChars(files) {
  let sum = 0;
  for (const file of files.values()) sum += file.dataURL.length;
  return sum;
}

// Adds the good new files of `list` to `files` (Map id -> file), within the total limit.
// A file id is the hash of the picture, so a known id is the same picture and is skipped.
// Returns { added, rejected: [{ id, reason }] }.
// @purity semi-pure-a
function addFiles(files, list) {
  const added = [];
  const rejected = [];
  let total = totalChars(files);
  for (const raw of Array.isArray(list) ? list : []) {
    const checked = checkFile(raw);
    const id = raw && typeof raw.id === "string" ? raw.id.slice(0, 128) : "";
    if (!checked.file) {
      rejected.push({ id, reason: checked.reason });
      continue;
    }
    if (files.has(checked.file.id)) continue;
    if (total + checked.file.dataURL.length > MAX_TOTAL_CHARS) {
      rejected.push({ id, reason: "the Board has too many images" });
      continue;
    }
    files.set(checked.file.id, checked.file);
    total += checked.file.dataURL.length;
    added.push(checked.file);
  }
  return { added, rejected };
}

module.exports = { checkFile, addFiles, totalChars, IMAGE_TYPES, MAX_FILE_CHARS, MAX_TOTAL_CHARS };
