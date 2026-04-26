/**
 * tests/validation.test.js — Unit tests for validation helpers
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseIntSafe,
  parseRequiredNumber,
  parseOptionalNumber,
  parsePositiveInt,
  parseNonNegativeInt,
} = require('../src/validation');

// ── parseIntSafe ────────────────────────────────────────

describe('parseIntSafe', () => {
  it('parses valid integer strings', () => {
    assert.equal(parseIntSafe('42', 0), 42);
    assert.equal(parseIntSafe('3001', 80), 3001);
  });

  it('returns defaultValue for undefined/null', () => {
    assert.equal(parseIntSafe(undefined, 99), 99);
    assert.equal(parseIntSafe(null, 99), 99);
  });

  it('returns defaultValue for non-numeric strings', () => {
    assert.equal(parseIntSafe('abc', 5), 5);
    assert.equal(parseIntSafe('', 5), 5);
  });

  it('handles zero correctly (not falling through to default)', () => {
    assert.equal(parseIntSafe('0', 999), 0);
  });

  it('handles negative numbers', () => {
    assert.equal(parseIntSafe('-1', 0), -1);
  });

  it('truncates floats to integer', () => {
    assert.equal(parseIntSafe('3.14', 0), 3);
    assert.equal(parseIntSafe('99.9', 0), 99);
  });
});

// ── parseRequiredNumber ─────────────────────────────────

describe('parseRequiredNumber', () => {
  it('parses valid numbers', () => {
    assert.equal(parseRequiredNumber(42, 'x'), 42);
    assert.equal(parseRequiredNumber('3.14', 'x'), 3.14);
    assert.equal(parseRequiredNumber(0, 'x'), 0);
    assert.equal(parseRequiredNumber(-5, 'x'), -5);
  });

  it('parses string numbers', () => {
    assert.equal(parseRequiredNumber('100', 'y'), 100);
    assert.equal(parseRequiredNumber('-2.5', 'y'), -2.5);
  });

  it('throws on undefined', () => {
    assert.throws(() => parseRequiredNumber(undefined, 'z'), /Required: z/);
  });

  it('throws on null', () => {
    assert.throws(() => parseRequiredNumber(null, 'z'), /Required: z/);
  });

  it('throws on NaN-producing values', () => {
    assert.throws(() => parseRequiredNumber('abc', 'w'), /Invalid number: w/);
    assert.throws(() => parseRequiredNumber(NaN, 'w'), /Invalid number: w/);
  });
});

// ── parseOptionalNumber ─────────────────────────────────

describe('parseOptionalNumber', () => {
  it('parses valid numbers', () => {
    assert.equal(parseOptionalNumber(42, 0), 42);
    assert.equal(parseOptionalNumber('3.14', 0), 3.14);
  });

  it('returns defaultVal for undefined/null', () => {
    assert.equal(parseOptionalNumber(undefined, 10), 10);
    assert.equal(parseOptionalNumber(null, 10), 10);
  });

  it('returns undefined as default when not specified', () => {
    assert.equal(parseOptionalNumber(undefined), undefined);
  });

  it('returns defaultVal for NaN-producing values', () => {
    assert.equal(parseOptionalNumber('abc', 7), 7);
  });

  it('handles zero correctly', () => {
    assert.equal(parseOptionalNumber(0, 99), 0);
    assert.equal(parseOptionalNumber('0', 99), 0);
  });
});

// ── parsePositiveInt ────────────────────────────────────

describe('parsePositiveInt', () => {
  it('parses positive integers', () => {
    assert.equal(parsePositiveInt(5, 0), 5);
    assert.equal(parsePositiveInt('10', 0), 10);
  });

  it('rejects zero (not positive)', () => {
    assert.equal(parsePositiveInt(0, 99), 99);
    assert.equal(parsePositiveInt('0', 99), 99);
  });

  it('rejects negative numbers', () => {
    assert.equal(parsePositiveInt(-3, 99), 99);
    assert.equal(parsePositiveInt('-1', 99), 99);
  });

  it('returns defaultVal for undefined/null', () => {
    assert.equal(parsePositiveInt(undefined, 1), 1);
    assert.equal(parsePositiveInt(null, 1), 1);
  });

  it('returns defaultVal for non-numeric', () => {
    assert.equal(parsePositiveInt('abc', 42), 42);
  });

  it('truncates floats', () => {
    assert.equal(parsePositiveInt('3.9', 0), 3);
  });
});

// ── parseNonNegativeInt ─────────────────────────────────

describe('parseNonNegativeInt', () => {
  it('parses positive integers', () => {
    assert.equal(parseNonNegativeInt(5, 99), 5);
  });

  it('accepts zero (non-negative)', () => {
    assert.equal(parseNonNegativeInt(0, 99), 0);
    assert.equal(parseNonNegativeInt('0', 99), 0);
  });

  it('rejects negative numbers', () => {
    assert.equal(parseNonNegativeInt(-1, 99), 99);
    assert.equal(parseNonNegativeInt('-5', 99), 99);
  });

  it('returns defaultVal for undefined/null', () => {
    assert.equal(parseNonNegativeInt(undefined), undefined);
    assert.equal(parseNonNegativeInt(null, 0), 0);
  });

  it('returns defaultVal for non-numeric', () => {
    assert.equal(parseNonNegativeInt('xyz', 0), 0);
  });
});
