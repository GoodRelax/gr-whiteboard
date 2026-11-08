"use strict";

// Summary: When called, a shall return 1. When called twice, a shall return 1 again.
// @purity pure
function a() {
  return 1;
}

// Summary: One. Two. Three. Four.
// Temporary: Long. Until: Split.
// @purity pure
function b() {
  return 2;
}

// Summary: When called, c shall return 3. When called again, c shall return 3.
//
// Temporary: Not next. Until: Moved.
// @purity pure
function c() {
  return 3;
}

module.exports = { a, b, c };
