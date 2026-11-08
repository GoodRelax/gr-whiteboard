// Why: A .cjs file is parsed as a script, so a top-level return is allowed.
"use strict";

// @purity pure
module.exports = function one() {
  return 1;
};

return;
