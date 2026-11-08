"use strict";

// Summary: Matches a slash-separated relative path against globs with **, * and ?, with no dependency.

// @purity pure
function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

// @purity pure
function matchesAny(relativePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(relativePath));
}

module.exports = { globToRegExp, matchesAny };
