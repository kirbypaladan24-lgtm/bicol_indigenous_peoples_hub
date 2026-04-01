import { badRequest } from "./api-error.js";

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const HEX_COLOR_PATTERN = /^#?[0-9a-f]{3,8}$/i;

export function ensureObject(input, label = "payload") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest(`A valid ${label} object is required.`);
  }
  return input;
}

export function parseRequiredString(value, field, options = {}) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw badRequest(`${field} is required.`);
  }
  if (options.minLength && trimmed.length < options.minLength) {
    throw badRequest(`${field} must be at least ${options.minLength} characters long.`);
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw badRequest(`${field} must be at most ${options.maxLength} characters long.`);
  }
  return trimmed;
}

export function parseOptionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (options.minLength && trimmed.length < options.minLength) {
    throw badRequest(`${field} must be at least ${options.minLength} characters long.`);
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw badRequest(`${field} must be at most ${options.maxLength} characters long.`);
  }
  return trimmed;
}

export function parseBoolean(value, field, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;

  throw badRequest(`${field} must be true or false.`);
}

export function parseInteger(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw badRequest(`${field} is required.`);
    }
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${field} must be a whole number.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw badRequest(`${field} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw badRequest(`${field} must be at most ${options.max}.`);
  }
  return parsed;
}

export function parseNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw badRequest(`${field} is required.`);
    }
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${field} must be a valid number.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw badRequest(`${field} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw badRequest(`${field} must be at most ${options.max}.`);
  }
  return parsed;
}

export function parseLatitude(value, field = "latitude", required = true) {
  return parseNumber(value, field, { required, min: -90, max: 90 });
}

export function parseLongitude(value, field = "longitude", required = true) {
  return parseNumber(value, field, { required, min: -180, max: 180 });
}

export function parseUrl(value, field, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw badRequest(`${field} is required.`);
    }
    return null;
  }

  const trimmed = String(value).trim();
  if (!URL_PATTERN.test(trimmed)) {
    throw badRequest(`${field} must be a valid http or https URL.`);
  }
  return trimmed;
}

export function parseEnum(value, field, allowedValues, options = {}) {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw badRequest(`${field} is required.`);
    }
    return null;
  }

  const normalized = String(value).trim();
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${field} must be one of: ${allowedValues.join(", ")}.`);
  }
  return normalized;
}

export function parseColor(value, field = "color") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = String(value).trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw badRequest(`${field} must be a valid color value.`);
  }
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function parseMediaItems(input) {
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw badRequest("media must be an array.");
  }

  if (input.length > 12) {
    throw badRequest("media cannot contain more than 12 items.");
  }

  return input
    .map((item, index) => {
      if (!item) return null;
      if (typeof item === "string") {
        return {
          media_url: parseUrl(item, `media[${index}]`, true),
          media_type: "image",
          sort_order: index,
        };
      }

      return {
        media_url: parseUrl(item.media_url || item.url, `media[${index}].media_url`, true),
        media_type: parseOptionalString(item.media_type || item.type, `media[${index}].media_type`, {
          maxLength: 30,
        }) || "image",
        sort_order: parseInteger(item.sort_order, `media[${index}].sort_order`, {
          min: 0,
        }) ?? index,
      };
    })
    .filter(Boolean);
}

export function coerceUserId(value, field = "user_id") {
  return parseInteger(value, field, { required: true, min: 1 });
}

export function pickDisplayName(user) {
  if (!user) return "Unknown User";
  return user.display_name || user.username || user.email || `User ${user.id}`;
}
