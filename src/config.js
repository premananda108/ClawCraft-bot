/**
 * config.js — Loading and validation of configuration from .env
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

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

const config = {
  // Minecraft Server
  mc: {
    host: process.env.MC_HOST || 'localhost',
    port: parseIntSafe(process.env.MC_PORT, 25565),
    username: process.env.MC_USERNAME || 'ClawBot',
    auth: process.env.MC_AUTH || 'offline',
    version: process.env.MC_VERSION || undefined,  // undefined = auto-detect
  },

  // Bridge API
  bridge: {
    host: process.env.BRIDGE_HOST || '127.0.0.1',
    port: parseIntSafe(process.env.BRIDGE_PORT, 3001),
  },

  // Behaviour
  debug: process.env.DEBUG === 'true',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelay: parseIntSafe(process.env.RECONNECT_DELAY, 5000),
  maxReconnectAttempts: parseIntSafe(process.env.MAX_RECONNECT_ATTEMPTS, 10),
};

// Validation
if (!config.mc.username) {
  throw new Error('[Config] MC_USERNAME is required');
}
if (config.bridge.host !== '127.0.0.1' && config.bridge.host !== 'localhost') {
  console.warn('[Config] ⚠️  BRIDGE_HOST is not localhost — this exposes the API to the network!');
}

module.exports = config;
