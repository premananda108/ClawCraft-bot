/**
 * validation.js — Pure validation/parsing helpers
 *
 * Extracted for testability. Used by config.js and bridge-api.js.
 */

/**
 * Safe parseInt: returns defaultValue when the string is not a valid integer.
 * Unlike `parseInt(v) || default`, correctly handles NaN and the value 0.
 * @param {string|undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parseIntSafe(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a required number — throws if missing or NaN.
 * @param {*} val
 * @param {string} name — parameter name for error messages
 * @returns {number}
 */
function parseRequiredNumber(val, name) {
  if (val === undefined || val === null) throw new Error(`Required: ${name}`);
  const num = Number(val);
  if (Number.isNaN(num)) throw new Error(`Invalid number: ${name}`);
  return num;
}

/**
 * Parse an optional number — returns defaultVal if missing or NaN.
 * @param {*} val
 * @param {*} [defaultVal=undefined]
 * @returns {number|undefined}
 */
function parseOptionalNumber(val, defaultVal = undefined) {
  if (val === undefined || val === null) return defaultVal;
  const num = Number(val);
  if (Number.isNaN(num)) return defaultVal;
  return num;
}

/**
 * Parse a positive integer (> 0) — returns defaultVal if missing, NaN, or <= 0.
 * @param {*} val
 * @param {*} [defaultVal=undefined]
 * @returns {number|undefined}
 */
function parsePositiveInt(val, defaultVal = undefined) {
  if (val === undefined || val === null) return defaultVal;
  const num = parseInt(val, 10);
  if (Number.isNaN(num) || num <= 0) return defaultVal;
  return num;
}

/**
 * Parse a non-negative integer (>= 0) — returns defaultVal if missing, NaN, or < 0.
 * @param {*} val
 * @param {*} [defaultVal=undefined]
 * @returns {number|undefined}
 */
function parseNonNegativeInt(val, defaultVal = undefined) {
  if (val === undefined || val === null) return defaultVal;
  const num = parseInt(val, 10);
  if (Number.isNaN(num) || num < 0) return defaultVal;
  return num;
}

module.exports = {
  parseIntSafe,
  parseRequiredNumber,
  parseOptionalNumber,
  parsePositiveInt,
  parseNonNegativeInt,
};
