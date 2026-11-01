"use strict";

// JsonSchema (Entity). Checks a value against the small part of JSON Schema that the tools use:
// type, required, properties, additionalProperties false, enum, minimum, maximum, minLength, maxLength,
// minItems, maxItems, items, pattern. Pure. Returns null, or { field, message } for the first wrong field (FR-141).

// @purity pure
function typeOk(type, value) {
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    default: return true;
  }
}

// @purity pure
function check(schema, value, field) {
  if (schema.type && !typeOk(schema.type, value)) return { field, message: `${field} must be ${schema.type === "integer" ? "an integer" : `a ${schema.type}`}` };
  if (schema.enum && !schema.enum.includes(value)) return { field, message: `${field} must be one of ${schema.enum.join(", ")}` };
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return { field, message: `${field} must be at least ${schema.minimum}` };
    if (schema.maximum !== undefined && value > schema.maximum) return { field, message: `${field} must be at most ${schema.maximum}` };
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return { field, message: `${field} must have at least ${schema.minLength} characters` };
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { field, message: `${field} must have at most ${schema.maxLength} characters` };
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return { field, message: `${field} must match ${schema.pattern}` };
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return { field, message: `${field} must have at least ${schema.minItems} items` };
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return { field, message: `${field} must have at most ${schema.maxItems} items` };
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        const wrong = check(schema.items, value[i], `${field}[${i}]`);
        if (wrong) return wrong;
      }
    }
  }
  if (schema.type === "object" && value !== null && typeof value === "object") {
    for (const name of schema.required || []) {
      if (value[name] === undefined) return { field: field ? `${field}.${name}` : name, message: `${name} is required` };
    }
    const properties = schema.properties || {};
    for (const [name, inner] of Object.entries(value)) {
      const path = field ? `${field}.${name}` : name;
      if (!properties[name]) {
        if (schema.additionalProperties === false) return { field: path, message: `${path} is not a field of this tool` };
        continue;
      }
      const wrong = check(properties[name], inner, path);
      if (wrong) return wrong;
    }
  }
  return null;
}

// @purity pure
function validate(schema, value) {
  return check(schema, value, "");
}

module.exports = { validate };
