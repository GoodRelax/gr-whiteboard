"use strict";

// Brief (Entity). Chooses the few fields that the Agent needs from MessagesSent and from the Items of the Board,
// and writes them as JSON (the CLI) or as short text lines (the MCP Server). See spec 4.12.4 and FR-152.

// Old texts are cut to this many characters; a Message is cut at MESSAGE_MAX_CHARS.
const OLD_TEXT_MAX_CHARS = 80;
const MESSAGE_MAX_CHARS = 500;
// Fields of an Item that `board --fields` and `board_read` may choose (the names of GET /v1/board).
const ITEM_FIELDS = Object.freeze([
  "id", "type", "text", "x", "y", "width", "height", "angle", "containerId", "updatedMs", "isAnswer", "byClaude",
  "strokeColor", "backgroundColor", "startId", "endId", "points",
]);
const DEFAULT_READ_FIELDS = Object.freeze(["id", "type", "text"]);
const NEAR_PX = 600;
// Kinds of change that a drawing gets, so the Agent should look at it (FR-055).
const DRAWING_TYPES = Object.freeze(["freedraw", "image", "rectangle", "ellipse", "diamond", "arrow", "line"]);

// @purity pure
function cut(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max)}...(+${value.length - max})` : value;
}

// @purity pure
function round(value) {
  return Math.round(Number(value) || 0);
}

// One change with only the fields that matter (FR-121, FR-152).
// @purity pure
function briefChange(change) {
  const out = { id: change.id, kind: change.kind, type: change.type };
  if (change.kind === "edited" && typeof change.text === "string") out.text = change.text;
  if (change.kind === "edited" && typeof change.oldText === "string") out.old = cut(change.oldText, OLD_TEXT_MAX_CHARS);
  if (Array.isArray(change.what) && change.what.length > 0) out.what = change.what;
  if (change.from && Number.isFinite(change.x) && Number.isFinite(change.y)) {
    out.by = [round(change.x - change.from.x), round(change.y - change.from.y)];
  }
  if (Array.isArray(change.style) && change.style.length > 0) out.style = change.style;
  if (change.kind === "added") {
    out.at = [round(change.x), round(change.y)];
    out.size = [round(change.width), round(change.height)];
  }
  if (change.byClaude) out.byClaude = true;
  if (["added", "changed"].includes(change.kind) && DRAWING_TYPES.includes(change.type)) out.shot = true;
  return out;
}

// MessagesSent with the chosen fields (FR-121): the new texts, and the short form of each change.
// @purity pure
function briefSent(event) {
  const messages = (Array.isArray(event.messages) ? event.messages : []).map((m) => ({ id: m.id, text: m.text }));
  const changes = (Array.isArray(event.changes) ? event.changes : []).map(briefChange);
  return { v: 1, event: "MessagesSent", atMs: event.atMs, messages, changes };
}

// Board text as one JSON string: quotes, line breaks, and control characters are escaped,
// so it can never make a line of its own (FR-143).
// @purity pure
function quoted(text) {
  return JSON.stringify(String(text));
}

// An id or a type from the Board in a text line (FR-143). The Board takes any 1 to 64 characters as an id,
// so an id with a line break could make a line of its own. A plain id stays as it is; any other becomes a JSON string.
// @purity pure
function safeWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(text) ? text : JSON.stringify(text);
}

// Board text for a tab-separated column: tabs and line breaks become spaces (FR-143).
// @purity pure
function cell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/[\t\r\n]+/g, " ");
}

// The text lines of a brief MessagesSent (5.2 of the design; spec 4.12.4).
// @purity pure
function sentLines(event) {
  const brief = briefSent(event);
  const head = `sent atMs=${brief.atMs} messages=${brief.messages.length} changes=${brief.changes.length} untrusted=true`;
  const lines = brief.messages.map((m) => `msg ${safeWord(m.id)} ${quoted(cut(m.text, MESSAGE_MAX_CHARS))}`);
  for (const c of brief.changes) {
    const kind = c.kind === "changed" && c.what ? c.what.join("+") : c.kind;
    const parts = [`chg ${safeWord(kind)} ${safeWord(c.type)} ${safeWord(c.id)}`];
    if (c.by) parts.push(`by=(${c.by[0]},${c.by[1]})`);
    if (c.text !== undefined) parts.push(`text=${quoted(cut(c.text, MESSAGE_MAX_CHARS))}`);
    if (c.old !== undefined) parts.push(`old=${quoted(c.old)}`);
    if (c.style) parts.push(`fields=${c.style.map(safeWord).join(",")}`);
    if (c.at) parts.push(`at=(${c.at[0]},${c.at[1]}) size=${c.size[0]}x${c.size[1]}`);
    if (c.byClaude) parts.push("byClaude");
    if (c.shot) parts.push("shot=yes");
    lines.push(parts.join(" "));
  }
  return { head, lines };
}

// The board reply with only `fields` of each Item (FR-122). An Item without a field leaves it out.
// @purity pure
function pickFields(reply, fields) {
  const items = (Array.isArray(reply.items) ? reply.items : []).map((item) => {
    const out = {};
    for (const field of fields) if (Object.prototype.hasOwnProperty.call(item, field)) out[field] = item[field];
    return out;
  });
  return { ...reply, items };
}

// @purity pure
function centerOf(item) {
  return [Number(item.x) + Number(item.width) / 2, Number(item.y) + Number(item.height) / 2];
}

// The Items that `board_read` shows (spec 4.12.4): filters, then at most `limit`.
// options: { near, byClaude, type, answers, limit }. Returns { items, shown, filter } or { error }.
// @purity pure
function filterItems(items, options) {
  let list = items.filter((item) => options.answers || !item.isAnswer);
  const filter = [];
  if (options.near) {
    const center = items.find((item) => item.id === options.near);
    if (!center) return { error: `no item with id ${safeWord(options.near)}` };
    const [cx, cy] = centerOf(center);
    list = list.filter((item) => {
      const [x, y] = centerOf(item);
      return Math.hypot(x - cx, y - cy) <= NEAR_PX;
    });
    filter.push(`near:${safeWord(options.near)}`);
  }
  if (typeof options.byClaude === "boolean") {
    list = list.filter((item) => Boolean(item.byClaude) === options.byClaude);
    filter.push(`byClaude:${options.byClaude}`);
  }
  if (options.type) {
    list = list.filter((item) => item.type === options.type);
    filter.push(`type:${safeWord(options.type)}`);
  }
  if (options.answers) filter.push("answers:true");
  return { items: list.slice(0, options.limit), matched: list.length, filter };
}

// The text lines of `board_read` (spec 4.12.4): a header row, then one tab-separated row per Item.
// @purity pure
function itemLines(reply, options) {
  const all = Array.isArray(reply.items) ? reply.items : [];
  const fields = options.fields && options.fields.length > 0 ? options.fields : DEFAULT_READ_FIELDS;
  const chosen = filterItems(all, options);
  if (chosen.error) return chosen;
  const filterText = chosen.filter.length > 0 ? ` filter=${chosen.filter.join(",")}` : "";
  // The column names are part of the head, so every page has them.
  const head = `items=${all.length} matched=${chosen.matched} shown=${chosen.items.length}${filterText} untrusted=true\n${fields.join("\t")}`;
  const lines = [];
  for (const item of chosen.items) {
    lines.push(fields.map((field) => {
      const value = item[field];
      if (field === "text" && typeof value === "string") {
        const flat = cell(value);
        return flat.length > options.textMax ? `${flat.slice(0, options.textMax)}...` : flat;
      }
      if (typeof value === "number") return String(Math.round(value * 10) / 10);
      return cell(value);
    }).join("\t"));
  }
  return { head, lines };
}

// Cuts `lines` into pages that fit `budget` characters with `head` (NFR-015).
// Returns the text of page `page` (from 1); a page with more after it ends with `more=N page=P`.
// @purity pure
function paged(head, lines, budget, page = 1) {
  const pages = [];
  let current = [];
  let size = head.length + 1;
  const tailRoom = 24;
  for (const line of lines) {
    const length = line.length + 1;
    if (current.length > 0 && size + length + tailRoom > budget) {
      pages.push(current);
      current = [];
      size = head.length + 1;
    }
    current.push(line.length + head.length + tailRoom + 2 > budget ? line.slice(0, Math.max(0, budget - head.length - tailRoom - 6)) + "..." : line);
    size += length;
  }
  pages.push(current);
  const index = Math.min(Math.max(1, page), pages.length) - 1;
  const left = pages.slice(index + 1).reduce((sum, p) => sum + p.length, 0);
  const out = [head, ...pages[index]];
  if (left > 0) out.push(`more=${left} page=${index + 2}`);
  return out.join("\n");
}

module.exports = {
  ITEM_FIELDS, DEFAULT_READ_FIELDS, briefChange, briefSent, sentLines, pickFields, filterItems, itemLines, paged, quoted, cell, cut, safeWord,
};
