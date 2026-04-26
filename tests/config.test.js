/**
 * tests/config.test.js — Unit tests for config module
 *
 * Tests that config.js correctly reads environment variables
 * and applies defaults via parseIntSafe.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

// We need to test config with different env vars each time.
// Since require() caches modules, we must clear the cache before each test.
function loadFreshConfig(envOverrides = {}) {
  // Save original env
  const saved = {};
  const keysToClean = [
    'MC_HOST', 'MC_PORT', 'MC_USERNAME', 'MC_AUTH', 'MC_VERSION',
    'BRIDGE_HOST', 'BRIDGE_PORT', 'API_KEY',
    'DEBUG', 'AUTO_RECONNECT', 'RECONNECT_DELAY', 'MAX_RECONNECT_ATTEMPTS',
  ];

  for (const key of keysToClean) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  // Apply overrides
  for (const [key, val] of Object.entries(envOverrides)) {
    process.env[key] = val;
  }

  // Clear require cache for config and validation
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/validation')];

  const config = require('../src/config');

  // Restore original env
  for (const key of keysToClean) {
    if (saved[key] !== undefined) {
      process.env[key] = saved[key];
    } else {
      delete process.env[key];
    }
  }

  return config;
}

// ── Defaults ─────────────────────────────────────────────

describe('config — defaults', () => {
  it('has correct MC defaults', () => {
    const config = loadFreshConfig();
    assert.equal(config.mc.host, 'localhost');
    assert.equal(config.mc.port, 25565);
    assert.equal(config.mc.username, 'ClawBot');
    assert.equal(config.mc.auth, 'offline');
    assert.equal(config.mc.version, undefined);
  });

  it('has correct bridge defaults', () => {
    const config = loadFreshConfig();
    assert.equal(config.bridge.host, '127.0.0.1');
    assert.equal(config.bridge.port, 3001);
    assert.equal(config.bridge.apiKey, '');
  });

  it('has correct behaviour defaults', () => {
    const config = loadFreshConfig();
    assert.equal(config.debug, false);
    assert.equal(config.autoReconnect, true);
    assert.equal(config.reconnectDelay, 5000);
    assert.equal(config.maxReconnectAttempts, 10);
  });
});

// ── Env overrides ────────────────────────────────────────

describe('config — env overrides', () => {
  it('reads MC_HOST from env', () => {
    const config = loadFreshConfig({ MC_HOST: '192.168.1.100' });
    assert.equal(config.mc.host, '192.168.1.100');
  });

  it('parses MC_PORT as integer', () => {
    const config = loadFreshConfig({ MC_PORT: '25566' });
    assert.equal(config.mc.port, 25566);
  });

  it('falls back to default for invalid MC_PORT', () => {
    const config = loadFreshConfig({ MC_PORT: 'not-a-number' });
    assert.equal(config.mc.port, 25565);
  });

  it('reads DEBUG flag', () => {
    const configTrue = loadFreshConfig({ DEBUG: 'true' });
    assert.equal(configTrue.debug, true);

    const configFalse = loadFreshConfig({ DEBUG: 'false' });
    assert.equal(configFalse.debug, false);

    const configEmpty = loadFreshConfig({});
    assert.equal(configEmpty.debug, false);
  });

  it('reads AUTO_RECONNECT (defaults true, only false when explicitly "false")', () => {
    const configDefault = loadFreshConfig({});
    assert.equal(configDefault.autoReconnect, true);

    const configFalse = loadFreshConfig({ AUTO_RECONNECT: 'false' });
    assert.equal(configFalse.autoReconnect, false);

    const configAnything = loadFreshConfig({ AUTO_RECONNECT: 'yes' });
    assert.equal(configAnything.autoReconnect, true);
  });

  it('reads API_KEY', () => {
    const config = loadFreshConfig({ API_KEY: 'my-secret-key' });
    assert.equal(config.bridge.apiKey, 'my-secret-key');
  });

  it('parses BRIDGE_PORT as integer', () => {
    const config = loadFreshConfig({ BRIDGE_PORT: '8080' });
    assert.equal(config.bridge.port, 8080);
  });

  it('handles MC_PORT=0 correctly (not falling to default)', () => {
    const config = loadFreshConfig({ MC_PORT: '0' });
    assert.equal(config.mc.port, 0);
  });
});
