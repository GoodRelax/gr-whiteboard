"use strict";

// Spec: FR-999
// @purity pure
function missing() {
  return [];
}

// Spec: { shape, prefix } (see BUILDERS)
// @purity pure
function noId() {
  return [];
}

module.exports = { missing, noId };
