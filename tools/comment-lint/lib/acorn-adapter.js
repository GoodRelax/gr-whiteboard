"use strict";

// Summary: The parser adapter: reads the comments and the function sites of JavaScript source with acorn.
// Why: Only this file depends on acorn, so a port to another parser or language replaces only this file.

const acorn = require("acorn");

class ParseError extends Error {
  // @purity pure
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

// Section: reading comments

// @purity pure
function styleOf(acornComment, source) {
  if (acornComment.start === 0 && source.startsWith("#!")) return "hashbang";
  if (acornComment.type === "Line") return "line";
  const value = acornComment.value;
  return value.startsWith("*") && !value.startsWith("**") ? "jsdoc" : "block";
}

// @purity pure
function readComments(source, acornComments) {
  return acornComments.map((acornComment) => {
    // @purity pure
    const lineStart = source.lastIndexOf("\n", acornComment.start - 1) + 1;
    return {
      line: acornComment.loc.start.line,
      column: acornComment.loc.start.column + 1,
      endLine: acornComment.loc.end.line,
      style: styleOf(acornComment, source),
      text: acornComment.value,
      isTrailing: source.slice(lineStart, acornComment.start).trim() !== "",
      start: acornComment.start,
      end: acornComment.end,
    };
  });
}

// Section: reading function sites

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

// @purity pure
function wraps(parent, child) {
  switch (parent.type) {
    case "VariableDeclarator": return parent.init === child;
    case "VariableDeclaration": return parent.declarations[0] === child;
    case "AssignmentExpression": return parent.right === child;
    case "ExpressionStatement": return parent.expression === child;
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition": return parent.value === child;
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration": return parent.declaration === child;
    default: return false;
  }
}

// @purity pure
function anchorOf(node, ancestors) {
  // Why: A comment above `const f = () => {}` or `key: function () {}` belongs to the function inside.
  let anchor = node;
  for (let index = ancestors.length - 1; index >= 0 && wraps(ancestors[index], anchor); index -= 1) anchor = ancestors[index];
  return anchor;
}

// @purity pure
function keyName(key, source) {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return source.slice(key.start, key.end);
}

// @purity pure
function nameOf(node, ancestors, source) {
  if (node.id) return node.id.name;
  const parent = ancestors[ancestors.length - 1];
  if (parent === undefined) return null;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
  if (parent.type === "AssignmentExpression") return source.slice(parent.left.start, parent.left.end);
  if (["Property", "MethodDefinition", "PropertyDefinition"].includes(parent.type)) return keyName(parent.key, source);
  return null;
}

// @purity pure
function isMethod(node, ancestors) {
  const parent = ancestors[ancestors.length - 1];
  if (parent === undefined || parent.value !== node) return false;
  return parent.type === "MethodDefinition" || (parent.type === "Property" && (parent.method || parent.kind !== "init"));
}

// @purity pure
function isSingleExpression(node, ancestors) {
  if (node.type === "FunctionDeclaration" || isMethod(node, ancestors)) return false;
  if (node.type === "ArrowFunctionExpression" && node.expression) return true;
  const statements = node.body.body;
  // Why: An empty body such as `() => {}` is shorter than any annotation, like a single expression.
  if (statements.length === 0) return true;
  if (statements.length !== 1) return false;
  return statements[0].type === "ExpressionStatement" || (statements[0].type === "ReturnStatement" && statements[0].argument !== null);
}

// @purity pure
function previousTokenEnd(tokens, offset) {
  let low = 0;
  let high = tokens.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tokens[middle].end <= offset) {
      found = tokens[middle].end;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// @purity pure
function attachedCommentIndexes(node, anchor, tokens, comments) {
  const gapStart = previousTokenEnd(tokens, anchor.start);
  const indexes = [];
  const body = node.body;
  const innerEnd = body.type === "BlockStatement" ? (body.body.length > 0 ? body.body[0].start : body.end) : -1;
  for (const [index, comment] of comments.entries()) {
    const isLeading = comment.start >= gapStart && comment.end <= anchor.start;
    const isInnerLeading = innerEnd >= 0 && comment.start > body.start && comment.end <= innerEnd;
    if (isLeading || isInnerLeading) indexes.push(index);
  }
  return indexes;
}

// @purity pure
function childNodes(node) {
  const children = [];
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item !== null && typeof item === "object" && typeof item.type === "string") children.push(item);
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
      children.push(value);
    }
  }
  return children;
}

// @purity pure
function readFunctionSites(ast, tokens, comments, source) {
  const sites = [];
  const stack = [{ node: ast, ancestors: [] }];
  while (stack.length > 0) {
    const { node, ancestors } = stack.pop();
    if (FUNCTION_TYPES.has(node.type)) {
      const anchor = anchorOf(node, ancestors);
      sites.push({
        line: anchor.loc.start.line,
        column: anchor.loc.start.column + 1,
        name: nameOf(node, ancestors, source),
        isSingleExpression: isSingleExpression(node, ancestors),
        commentIndexes: attachedCommentIndexes(node, anchor, tokens, comments),
      });
    }
    const nextAncestors = [...ancestors, node];
    for (const child of childNodes(node).reverse()) stack.push({ node: child, ancestors: nextAncestors });
  }
  return sites.sort((left, right) => left.line - right.line || left.column - right.column);
}

// Section: parsing

// @purity pure
function sourceTypesFor(extension) {
  if (extension === ".mjs") return ["module"];
  if (extension === ".cjs") return ["script"];
  return ["script", "module"];
}

// @purity pure
function parseOnce(source, sourceType) {
  const acornComments = [];
  const tokens = [];
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType,
    locations: true,
    allowHashBang: true,
    allowReturnOutsideFunction: sourceType === "script",
    onComment: acornComments,
    onToken: tokens,
  });
  return { ast, acornComments, tokens };
}

// @purity pure
function parseSource(source, extension) {
  let firstError = null;
  for (const sourceType of sourceTypesFor(extension)) {
    try {
      const { ast, acornComments, tokens } = parseOnce(source, sourceType);
      const comments = readComments(source, acornComments);
      return { comments, functions: readFunctionSites(ast, tokens, comments, source), sourceType };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      if (firstError === null) firstError = error;
    }
  }
  const loc = firstError.loc || { line: 1, column: 0 };
  throw new ParseError(firstError.message, loc.line, loc.column + 1);
}

module.exports = { ParseError, parseSource, readComments, readFunctionSites };
