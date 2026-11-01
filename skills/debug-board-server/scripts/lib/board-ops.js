"use strict";

// BoardOps (Entity). The rules for Operations by Claude (spec 4.11, FR-087 to FR-104):
// checks `draw` Skeletons, `edit` Changes, and `delete` requests; makes deleted Elements and
// undo Elements; chooses the Origin; filters Job results. Pure functions: the caller passes
// the clock value and the random versionNonce.

const { AppError } = require("./app-error");
const { CLAUDE_MARK, isElement, boundsOf } = require("./board-store");
const { anchorPoint } = require("./answer-placement");

const SHAPE_TYPES = Object.freeze(["rectangle", "ellipse", "diamond"]);
const LINEAR_TYPES = Object.freeze(["arrow", "line"]);
const SKELETON_TYPES = Object.freeze([...SHAPE_TYPES, "text", ...LINEAR_TYPES]);
// Types and fields that `draw` never takes (NFR-014).
const FORBIDDEN_TYPES = Object.freeze(["image", "freedraw", "frame", "magicframe", "embeddable", "iframe"]);
const FORBIDDEN_FIELDS = Object.freeze([
  "link", "customData", "version", "versionNonce", "isDeleted", "boundElements", "containerId", "groupIds", "frameId",
]);
// Element types that a Job result may never add, also for Mermaid.
const NEVER_IN_RESULT = Object.freeze(["frame", "magicframe", "embeddable", "iframe"]);
// Board Item types that an arrow may bind to (4.11.1 `start`, `end`).
const BIND_TARGET_TYPES = Object.freeze([...SHAPE_TYPES, "text", "image"]);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|transparent)$/;
const MAX_COORD = 100000;
const MAX_SIZE = 20000;
const MAX_ANGLE = 6.3;
const MAX_SKELETONS = 500;
const MAX_CHANGES = 200;
const MAX_DELETE_IDS = 2000;
const MAX_POINTS = 100;
const MAX_RESULT_ELEMENTS = 5000;
// FR-101: a larger deletion needs `confirm: true`.
const CONFIRM_ABOVE = 20;
const EMPTY_BOARD_ORIGIN = Object.freeze({ x: 100, y: 100 });
const ORIGIN_GAP_PX = 40;
const FONT_FAMILIES = Object.freeze([1, 2, 3, 5, 6, 7, 8]);
const FILL_STYLES = Object.freeze(["hachure", "cross-hatch", "solid", "zigzag"]);
const STROKE_STYLES = Object.freeze(["solid", "dashed", "dotted"]);
const TEXT_ALIGNS = Object.freeze(["left", "center", "right"]);
const VERTICAL_ALIGNS = Object.freeze(["top", "middle", "bottom"]);
const ARROWHEADS = Object.freeze([null, "arrow", "bar", "dot", "triangle"]);

// @purity pure
function isNumberIn(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

// @purity pure
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// @purity pure
function isGoodText(value, maxTextChars) {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxTextChars;
}

// One rule per field: which Skeleton types may have it, and whether its value is good.
// @purity pure
function fieldRules(maxTextChars) {
  const all = SKELETON_TYPES;
  const notText = [...SHAPE_TYPES, ...LINEAR_TYPES];
  const textOnly = ["text"];
  const labelRules = {
    text: (v) => isGoodText(v, maxTextChars),
    fontSize: (v) => isNumberIn(v, 8, 200),
    strokeColor: (v) => typeof v === "string" && COLOR_PATTERN.test(v),
    textAlign: (v) => TEXT_ALIGNS.includes(v),
    verticalAlign: (v) => VERTICAL_ALIGNS.includes(v),
  };
  return {
    type: { types: all, ok: () => true },
    id: { types: all, ok: (v) => typeof v === "string" && ID_PATTERN.test(v) },
    x: { types: all, ok: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD) },
    y: { types: all, ok: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD) },
    width: { types: notText, ok: (v) => isNumberIn(v, 0, MAX_SIZE) },
    height: { types: notText, ok: (v) => isNumberIn(v, 0, MAX_SIZE) },
    angle: { types: [...SHAPE_TYPES, "text"], ok: (v) => isNumberIn(v, -MAX_ANGLE, MAX_ANGLE) },
    strokeColor: { types: all, ok: labelRules.strokeColor },
    backgroundColor: { types: all, ok: labelRules.strokeColor },
    fillStyle: { types: SHAPE_TYPES, ok: (v) => FILL_STYLES.includes(v) },
    strokeWidth: { types: notText, ok: (v) => isNumberIn(v, 0.5, 16) },
    strokeStyle: { types: notText, ok: (v) => STROKE_STYLES.includes(v) },
    roughness: { types: notText, ok: (v) => [0, 1, 2].includes(v) },
    opacity: { types: all, ok: (v) => Number.isInteger(v) && v >= 0 && v <= 100 },
    text: { types: textOnly, ok: labelRules.text },
    fontSize: { types: textOnly, ok: labelRules.fontSize },
    fontFamily: { types: textOnly, ok: (v) => FONT_FAMILIES.includes(v) },
    textAlign: { types: textOnly, ok: labelRules.textAlign },
    verticalAlign: { types: textOnly, ok: labelRules.verticalAlign },
    label: {
      types: [...SHAPE_TYPES, "arrow"],
      ok: (v) => isPlainObject(v) && labelRules.text(v.text)
        && Object.keys(v).every((key) => labelRules[key] && labelRules[key](v[key])),
    },
    points: {
      types: LINEAR_TYPES,
      ok: (v) => Array.isArray(v) && v.length >= 2 && v.length <= MAX_POINTS
        && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => isNumberIn(n, -MAX_COORD, MAX_COORD))),
    },
    start: { types: ["arrow"], ok: (v) => isPlainObject(v) && Object.keys(v).join() === "id" && typeof v.id === "string" },
    end: { types: ["arrow"], ok: (v) => isPlainObject(v) && Object.keys(v).join() === "id" && typeof v.id === "string" },
    startArrowhead: { types: LINEAR_TYPES, ok: (v) => ARROWHEADS.includes(v) },
    endArrowhead: { types: LINEAR_TYPES, ok: (v) => ARROWHEADS.includes(v) },
  };
}

// @purity pure
function invalid(code, index, field, message) {
  return new AppError(code, 400, message, { index, field });
}

// Checks a `draw` body (4.11.1). `elements`: Map id -> Element (the Board).
// Returns { skeletons, at, boardTargets } or throws AppError
// (InvalidElements 400, InvalidAt 400, DuplicateId 409).
// `boardTargets`: the IDs of Board Items that an arrow binds to (FR-090).
// @purity pure
function checkDraw(body, elements, maxTextChars) {
  const list = body && body.elements;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SKELETONS) {
    throw invalid("InvalidElements", null, "elements", `elements must be a list of 1 to ${MAX_SKELETONS} Skeletons`);
  }
  const at = checkAt(body.at);
  const rules = fieldRules(maxTextChars);
  const listIds = new Map();
  list.forEach((skeleton, index) => {
    if (!isPlainObject(skeleton)) throw invalid("InvalidElements", index, null, "a Skeleton must be a JSON object");
    if (!SKELETON_TYPES.includes(skeleton.type)) {
      const why = FORBIDDEN_TYPES.includes(skeleton.type) ? "is not allowed" : "is unknown";
      throw invalid("InvalidElements", index, "type", `type ${JSON.stringify(skeleton.type)} ${why}`);
    }
    for (const field of Object.keys(skeleton)) {
      const rule = rules[field];
      if (FORBIDDEN_FIELDS.includes(field) || !rule) throw invalid("InvalidElements", index, field, `field ${field} is not allowed`);
      if (!rule.types.includes(skeleton.type)) throw invalid("InvalidElements", index, field, `field ${field} is not for type ${skeleton.type}`);
      if (!rule.ok(skeleton[field])) throw invalid("InvalidElements", index, field, `field ${field} has a bad value`);
    }
    for (const field of ["x", "y"]) {
      if (skeleton[field] === undefined) throw invalid("InvalidElements", index, field, `field ${field} is required`);
    }
    if (skeleton.type === "text" && skeleton.text === undefined) throw invalid("InvalidElements", index, "text", "field text is required");
    if (skeleton.id !== undefined) {
      if (listIds.has(skeleton.id)) throw invalid("InvalidElements", index, "id", `id ${skeleton.id} is twice in the list`);
      listIds.set(skeleton.id, skeleton.type);
    }
  });
  const taken = [...listIds.keys()].filter((id) => elements.has(id));
  if (taken.length > 0) throw new AppError("DuplicateId", 409, `ids already on the Board: ${taken.join(", ")}`, { ids: taken });
  const boardTargets = new Set();
  list.forEach((skeleton, index) => {
    for (const end of ["start", "end"]) {
      if (!skeleton[end]) continue;
      const id = skeleton[end].id;
      if (listIds.has(id)) {
        if (![...SHAPE_TYPES, "text"].includes(listIds.get(id))) throw invalid("InvalidElements", index, end, `${id} is not a shape`);
        continue;
      }
      const target = elements.get(id);
      if (!target || target.isDeleted || !BIND_TARGET_TYPES.includes(target.type)) {
        throw invalid("InvalidElements", index, end, `${id} is not a shape in the list or on the Board`);
      }
      boardTargets.add(id);
    }
  });
  return { skeletons: list, at, boardTargets: [...boardTargets] };
}

// @purity pure
function checkAt(at) {
  if (at === undefined || at === null) return null;
  if (!(isPlainObject(at) && Number.isFinite(at.x) && Number.isFinite(at.y))) {
    throw new AppError("InvalidAt", 400, "at must be {\"x\": number, \"y\": number}");
  }
  return { x: at.x, y: at.y };
}

// Mermaid diagram types that the Server lets through (FR-093a, R-022): the first word of the source.
const MERMAID_TYPES = Object.freeze([
  "graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram", "pie",
]);
// Statements that set styles, links, or classes. Mermaid 11.13.0 has open advisories there (FR-093a, A.3).
const MERMAID_REFUSED_WORDS = Object.freeze(["classDef", "class", "cssClass", "style", "linkStyle", "click"]);
const MERMAID_DIRECTIVE = "%%{";
// The short form that puts a classDef class on a node, for example `A:::foo`.
const MERMAID_CLASS_SHORTHAND = ":::";

// Refuses a Mermaid source with a type or a statement outside FR-093a.
// A statement ends at a newline, ";", "{", or "}", so a refused word right after a brace is a statement too.
// @purity pure
function checkMermaidSource(source) {
  if (source.includes(MERMAID_DIRECTIVE)) {
    throw new AppError("InvalidSource", 400, "source must not contain a %%{ directive");
  }
  if (source.includes(MERMAID_CLASS_SHORTHAND)) {
    throw new AppError("InvalidSource", 400, "source must not use \":::\"; set colors with edit");
  }
  const statements = source.split(/[\n;{}]/).map((s) => s.trim()).filter((s) => s !== "" && !s.startsWith("%%"));
  const type = statements.length > 0 ? statements[0].split(/\s/)[0] : "";
  if (!MERMAID_TYPES.includes(type)) {
    throw new AppError("InvalidSource", 400, `diagram type must be one of: ${MERMAID_TYPES.join(", ")}`);
  }
  for (const statement of statements.slice(1)) {
    const word = statement.split(/\s/)[0].toLowerCase();
    const refused = MERMAID_REFUSED_WORDS.find((w) => w.toLowerCase() === word);
    if (refused) {
      throw new AppError("InvalidSource", 400, `source must not use "${refused}"; set colors with edit`);
    }
  }
}

// Checks a `mermaid` body (FR-093, FR-093a). Returns { source, at }.
// @purity pure
function checkMermaid(body) {
  const source = body && body.source;
  if (typeof source !== "string" || source.trim() === "" || source.length > 20000) {
    throw new AppError("InvalidSource", 400, "source must be 1 to 20000 characters and not blank");
  }
  checkMermaidSource(source);
  return { source, at: checkAt(body.at) };
}

// The not-deleted text bound to `container` (its label), or null.
// @purity pure
function boundTextOf(elements, containerId) {
  for (const element of elements.values()) {
    if (!element.isDeleted && element.type === "text" && element.containerId === containerId) return element;
  }
  return null;
}

// Change fields that need a look at the Element, as types of 4.11.1.
const CHANGE_STYLE_TYPES = Object.freeze({
  fillStyle: SHAPE_TYPES,
  strokeWidth: "notText",
  strokeStyle: "notText",
  roughness: "notText",
});
const CHANGE_TEXT_FIELDS = Object.freeze(["text", "fontSize", "fontFamily", "textAlign"]);

// Checks an `edit` body (4.11.2). `busyIds`: Items a Person is typing in.
// Returns the list of Changes or throws AppError (InvalidChanges 400, UnknownItem 409, ItemBusy 409).
// @purity pure
function checkEdit(body, elements, busyIds, maxTextChars) {
  const list = body && body.changes;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CHANGES) {
    throw invalid("InvalidChanges", null, "changes", `changes must be a list of 1 to ${MAX_CHANGES} Changes`);
  }
  const rules = fieldRules(maxTextChars);
  const value = {
    x: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD),
    y: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD),
    dx: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD),
    dy: (v) => isNumberIn(v, -MAX_COORD, MAX_COORD),
    width: (v) => isNumberIn(v, 1, MAX_SIZE),
    height: (v) => isNumberIn(v, 1, MAX_SIZE),
    angle: rules.angle.ok,
    text: rules.text.ok,
    strokeColor: rules.strokeColor.ok,
    backgroundColor: rules.backgroundColor.ok,
    fillStyle: rules.fillStyle.ok,
    strokeWidth: rules.strokeWidth.ok,
    strokeStyle: rules.strokeStyle.ok,
    roughness: rules.roughness.ok,
    opacity: rules.opacity.ok,
    fontSize: rules.fontSize.ok,
    fontFamily: rules.fontFamily.ok,
    textAlign: rules.textAlign.ok,
  };
  const seen = new Set();
  list.forEach((change, index) => {
    if (!isPlainObject(change)) throw invalid("InvalidChanges", index, null, "a Change must be a JSON object");
    if (typeof change.id !== "string" || change.id === "") throw invalid("InvalidChanges", index, "id", "field id is required");
    if (seen.has(change.id)) throw invalid("InvalidChanges", index, "id", `id ${change.id} is twice in the list`);
    seen.add(change.id);
    const fields = Object.keys(change).filter((field) => field !== "id");
    if (fields.length === 0) throw invalid("InvalidChanges", index, null, "a Change needs at least one field besides id");
    for (const field of fields) {
      if (!value[field]) throw invalid("InvalidChanges", index, field, `field ${field} cannot be changed`);
      if (!value[field](change[field])) throw invalid("InvalidChanges", index, field, `field ${field} has a bad value`);
    }
    const moves = ["dx", "dy"].find((field) => field in change);
    if (moves && ("x" in change || "y" in change)) throw invalid("InvalidChanges", index, moves, "use x/y or dx/dy, not both");
  });
  const unknown = list.map((change) => change.id).filter((id) => {
    const element = elements.get(id);
    return !element || element.isDeleted;
  });
  if (unknown.length > 0) throw new AppError("UnknownItem", 409, `not on the Board: ${unknown.join(", ")}`, { ids: unknown });
  list.forEach((change, index) => {
    const element = elements.get(change.id);
    const label = boundTextOf(elements, change.id);
    const isText = element.type === "text";
    for (const field of Object.keys(change)) {
      if ((field === "width" || field === "height") && isText) {
        throw invalid("InvalidChanges", index, field, "the size of a text follows its words");
      }
      if (CHANGE_TEXT_FIELDS.includes(field) && !isText && !label) {
        throw invalid("InvalidChanges", index, field, `${change.id} has no text`);
      }
      const types = CHANGE_STYLE_TYPES[field];
      if (types === "notText" && isText) throw invalid("InvalidChanges", index, field, `field ${field} is not for text`);
      if (Array.isArray(types) && !types.includes(element.type)) {
        throw invalid("InvalidChanges", index, field, `field ${field} is not for type ${element.type}`);
      }
    }
  });
  const busy = list.map((change) => change.id).filter((id) => isBusy(elements, id, busyIds));
  if (busy.length > 0) throw new AppError("ItemBusy", 409, `a person is typing in: ${busy.join(", ")}`, { ids: busy });
  return list;
}

// An Item is busy while a Person types in it or in its label.
// @purity pure
function isBusy(elements, id, busyIds) {
  if (busyIds.has(id)) return true;
  const label = boundTextOf(elements, id);
  return Boolean(label && busyIds.has(label.id));
}

// Checks a `delete` body (4.4). Returns { ids, all, confirm } or throws InvalidIds.
// @purity pure
function checkDeleteBody(body) {
  const hasIds = body && body.ids !== undefined;
  const all = Boolean(body && body.all === true);
  if (hasIds === all) throw new AppError("InvalidIds", 400, "give ids (1 to 2000) or all: true, not both");
  if (hasIds) {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_DELETE_IDS || !ids.every((id) => typeof id === "string" && id !== "")) {
      throw new AppError("InvalidIds", 400, `ids must be a list of 1 to ${MAX_DELETE_IDS} IDs`);
    }
  }
  return { ids: hasIds ? [...new Set(body.ids)] : null, all, confirm: Boolean(body && body.confirm === true) };
}

// A copy of `element` with `patch`, a new version, a new versionNonce, and `updated` now.
// @purity pure
function bump(element, patch, nowMs, nonce) {
  return { ...element, ...patch, version: element.version + 1, versionNonce: nonce, updated: nowMs };
}

// @purity pure
function boundTo(binding) {
  return binding && typeof binding.elementId === "string" ? binding.elementId : null;
}

// Plans a `delete` (FR-100, FR-101). `request` is from checkDeleteBody. `nonce()` gives a random versionNonce.
// Returns { changed, ids, count }: `changed` = deleted Elements and Elements whose bindings lost a deleted ID;
// `ids` = every deleted Element (labels too); `count` = the Items counted for FR-101 (labels not counted).
// Throws UnknownItem, ItemBusy, or ConfirmNeeded.
// @purity pure
function planDelete(elements, request, busyIds, nowMs, nonce) {
  const live = (id) => {
    const element = elements.get(id);
    return element && !element.isDeleted ? element : null;
  };
  // A label is counted with its shape.
  const isLabel = (element) => element.type === "text" && element.containerId && live(element.containerId);
  let targets;
  if (request.all) {
    targets = [...elements.values()].filter((element) => !element.isDeleted && !isLabel(element)
      && !isBusy(elements, element.id, busyIds)).map((element) => element.id);
  } else {
    const unknown = request.ids.filter((id) => !live(id));
    if (unknown.length > 0) throw new AppError("UnknownItem", 409, `not on the Board: ${unknown.join(", ")}`, { ids: unknown });
    const busy = request.ids.filter((id) => isBusy(elements, id, busyIds));
    if (busy.length > 0) throw new AppError("ItemBusy", 409, `a person is typing in: ${busy.join(", ")}`, { ids: busy });
    targets = request.ids;
  }
  const targetSet = new Set(targets);
  const count = targets.filter((id) => {
    const element = live(id);
    return !(isLabel(element) && targetSet.has(element.containerId));
  }).length;
  if (count > CONFIRM_ABOVE && !request.confirm) {
    throw new AppError("ConfirmNeeded", 409, `this deletes ${count} items; ask the user, then repeat with confirm`, { count });
  }
  const gone = new Set(targetSet);
  for (const element of elements.values()) {
    if (!element.isDeleted && element.type === "text" && targetSet.has(element.containerId) && !busyIds.has(element.id)) {
      gone.add(element.id);
    }
  }
  const changed = [];
  for (const id of gone) changed.push(bump(live(id), { isDeleted: true }, nowMs, nonce()));
  for (const element of elements.values()) {
    if (element.isDeleted || gone.has(element.id)) continue;
    const patch = {};
    if (Array.isArray(element.boundElements) && element.boundElements.some((bound) => bound && gone.has(bound.id))) {
      patch.boundElements = element.boundElements.filter((bound) => !(bound && gone.has(bound.id)));
    }
    if (gone.has(boundTo(element.startBinding))) patch.startBinding = null;
    if (gone.has(boundTo(element.endBinding))) patch.endBinding = null;
    if (Object.keys(patch).length > 0) changed.push(bump(element, patch, nowMs, nonce()));
  }
  return { changed, ids: [...gone], count };
}

// The `changed` list of an Operation: each Element with its version after the Operation (FR-102).
// @purity pure
function changedList(list) {
  return list.map((element) => ({ id: element.id, version: element.version }));
}

// The IDs of the Operation's Elements that changed after it (FR-104).
// @purity pure
function undoConflicts(changed, elements) {
  return changed.filter((entry) => {
    const now = elements.get(entry.id);
    return now && now.version !== entry.version;
  }).map((entry) => entry.id);
}

// Plans an `undo` (FR-103): each Element of the Operation gets its state from the Snapshot
// (an added Element becomes deleted), with version = current version + 1.
// An Element that comes back keeps its `updated` from the Snapshot, so old texts do not look
// like the newest Message to the Answer placement (4.6); an added Element gets `updated` now.
// `snapshot`: Map id -> Element before the Operation. Returns { restored, restoredCount }.
// @purity pure
function planUndo(changed, snapshot, elements, nowMs, nonce) {
  const restored = [];
  for (const entry of changed) {
    const before = snapshot.get(entry.id);
    const now = elements.get(entry.id);
    if (!now && !before) continue;
    const version = (now ? now.version : before.version) + 1;
    const base = before ? { ...before } : { ...now, isDeleted: true, updated: nowMs };
    restored.push({ ...base, version, versionNonce: nonce() });
  }
  // Labels come back with their shape; count Items as delete counts them.
  const restoredCount = restored.filter((element) => !(element.type === "text" && element.containerId)).length;
  return { restored, restoredCount };
}

// The Origin of a draw or mermaid Job (4.11.4). `items`: toItems of the Board. `ownIds`: IDs by Claude.
// @purity pure
function chooseOrigin(items, at, ownIds, indentPx) {
  if (at) return Object.freeze({ x: Math.round(at.x), y: Math.round(at.y) });
  if (items.length === 0) return EMPTY_BOARD_ORIGIN;
  const x = anchorPoint(items, ownIds, 0, indentPx).x;
  const bottom = Math.max(...items.map((item) => {
    const box = boundsOf(item);
    return box.y + box.height;
  }));
  return Object.freeze({ x: Math.round(x), y: Math.round(bottom + ORIGIN_GAP_PX) });
}

// The box around Elements (arrows and lines by their points).
// @purity pure
function boxOf(list) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of list) {
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const points = Array.isArray(element.points) && element.points.length > 0
      ? element.points.map((p) => [x + (Number(p[0]) || 0), y + (Number(p[1]) || 0)])
      : [[x, y], [x + (Number(element.width) || 0), y + (Number(element.height) || 0)]];
    for (const [px, py] of points) {
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  if (left === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

// @purity pure
function withMark(element, mark) {
  return { ...element, customData: { ...(element.customData || {}), grwbKind: mark } };
}

// Takes from a draw or mermaid result only the new Elements (marked "claudeItem", no link; FR-091, NFR-014)
// and the Board shapes that got a new arrow end (their mark stays). Throws JobFailed for a bad result.
// `boardTargets`: Board IDs that the Job's arrows bind to. `allowImage`: true for mermaid (FR-095).
// Returns { added, targets }.
// @purity pure
function filterDrawResult(list, elements, boardTargets, allowImage) {
  if (!Array.isArray(list) || list.length === 0) throw new AppError("JobFailed", 502, "the page made no elements");
  if (list.length > MAX_RESULT_ELEMENTS) throw new AppError("JobFailed", 502, `more than ${MAX_RESULT_ELEMENTS} elements`);
  const targetSet = new Set(boardTargets);
  const added = [];
  const targets = [];
  for (const element of list) {
    if (!isElement(element)) throw new AppError("JobFailed", 502, "the page sent a bad element");
    const current = elements.get(element.id);
    if (current) {
      if (targetSet.has(element.id)) targets.push({ ...element, customData: current.customData });
      continue;
    }
    if (NEVER_IN_RESULT.includes(element.type) || (element.type === "image" && !allowImage)) {
      throw new AppError("JobFailed", 502, `the page made an element of type ${element.type}`);
    }
    added.push({ ...withMark(element, CLAUDE_MARK), link: null });
  }
  if (added.length === 0) throw new AppError("JobFailed", 502, "the page made no new elements");
  return { added, targets };
}

// FR-099: from an edit result, only the listed Elements, their labels, and the arrows bound to them.
// The mark of each Element stays as it was.
// @purity pure
function filterEditResult(list, elements, changeIds) {
  if (!Array.isArray(list)) throw new AppError("JobFailed", 502, "the page sent no elements");
  if (list.length > MAX_RESULT_ELEMENTS) throw new AppError("JobFailed", 502, `more than ${MAX_RESULT_ELEMENTS} elements`);
  const listed = new Set(changeIds);
  const allowed = new Set(listed);
  for (const element of elements.values()) {
    if (element.isDeleted) continue;
    if (element.type === "text" && listed.has(element.containerId)) allowed.add(element.id);
    if (listed.has(boundTo(element.startBinding)) || listed.has(boundTo(element.endBinding))) allowed.add(element.id);
  }
  for (const id of listed) {
    const element = elements.get(id);
    for (const bound of (element && Array.isArray(element.boundElements) ? element.boundElements : [])) {
      if (bound && (bound.type === "arrow" || bound.type === "text")) allowed.add(bound.id);
    }
  }
  const out = [];
  for (const element of list) {
    if (!isElement(element) || !allowed.has(element.id)) continue;
    const current = elements.get(element.id);
    if (!current || current.isDeleted) continue;
    out.push({ ...element, customData: current.customData, isDeleted: false });
  }
  return out;
}

module.exports = {
  CONFIRM_ABOVE,
  checkDraw,
  checkMermaid,
  checkEdit,
  checkDeleteBody,
  planDelete,
  planUndo,
  undoConflicts,
  changedList,
  chooseOrigin,
  boxOf,
  bump,
  filterDrawResult,
  filterEditResult,
};
