/**
 * config.js — Loading and validation of configuration from .env
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { parseIntSafe } = require('./validation');

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
    apiKey: process.env.API_KEY || '',  // empty = no auth
  },

  // Behaviour
  debug: process.env.DEBUG === 'true',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelay: parseIntSafe(process.env.RECONNECT_DELAY, 5000),
  maxReconnectAttempts: parseIntSafe(process.env.MAX_RECONNECT_ATTEMPTS, 10),
};

// Validation
if (config.bridge.host !== '127.0.0.1' && config.bridge.host !== 'localhost') {
  console.warn('[Config] ⚠️  BRIDGE_HOST is not localhost — this exposes the API to the network!');
}

module.exports = config;
