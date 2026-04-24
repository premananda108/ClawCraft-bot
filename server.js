/**
 * server.js — Entry point: launches bot + bridge API
 */

// mineflayer calls console.warn() directly (not process.emitWarning) when a plugin
// subscribes to the deprecated 'physicTick' event. We filter only that specific message.
const _origWarn = console.warn;
console.warn = function (...args) {
  if (typeof args[0] === 'string' && args[0].includes('physicTick')) return;
  _origWarn.apply(console, args);
};
// ============================================================================

const config = require('./src/config');
const BotCore = require('./src/bot-core');
const { loadPlugins } = require('./src/plugins');
const { createActions } = require('./src/actions');
const JobQueue = require('./src/job-queue');
const { createBridgeAPI } = require('./src/bridge-api');

async function main() {
  console.log('='.repeat(50));
  console.log('  ClawCraft-bot MVP');
  console.log('='.repeat(50));
  console.log(`[Config] MC: ${config.mc.host}:${config.mc.port} (${config.mc.username})`);
  console.log(`[Config] Auth: ${config.mc.auth}`);
  console.log(`[Config] Bridge: ${config.bridge.host}:${config.bridge.port}`);
  console.log(`[Config] Auto-reconnect: ${config.autoReconnect}`);
  console.log('='.repeat(50));

  // --- Create components ---
  const botCore = new BotCore(config);
  const jobQueue = new JobQueue();

  // actions will be initialized after spawn
  let actions = null;

  // --- Event: bot appeared in the world ---
  botCore.on('spawned', (bot) => {
    // Load plugins
    loadPlugins(bot, config);

    // Create actions
    actions = createActions(bot);

    console.log('[Server] 🎮 Bot is ready to work!');
  });

  // --- Event logging ---
  botCore.on('kicked', ({ reason }) => {
    console.log(`[Server] ⛔ Bot was kicked: ${reason}`);
    jobQueue.cancelAll();
  });

  botCore.on('ended', ({ reason }) => {
    console.log(`[Server] 🔌 Bot disconnected: ${reason}`);
    jobQueue.cancelAll();
  });

  botCore.on('botError', (err) => {
    console.error(`[Server] ❌ Bot error: ${err.message}`);
  });

  botCore.on('reconnectFailed', () => {
    console.error('[Server] 💀 All reconnect attempts exhausted');
  });

  botCore.on('chat', ({ username, message }) => {
    if (username !== config.mc.username) {
      console.log(`[Chat] ${username}: ${message}`);
    }
  });

  // --- Launch Bridge API ---
  // API starts immediately — /health will be available even while bot connects
  // Other endpoints return 503 until bot is ready (middleware requireBot)
  await createBridgeAPI({
    config,
    botCore,
    jobQueue,
    actions: {
      get readOnlyActions() {
        if (!actions) throw new Error('Bot not ready');
        return actions.readOnlyActions;
      },
      get queuedActions() {
        if (!actions) throw new Error('Bot not ready');
        return actions.queuedActions;
      },
      get immediateActions() {
        if (!actions) throw new Error('Bot not ready');
        return actions.immediateActions;
      },
    },
  });

  // --- Connect the bot ---
  botCore.connect();

  // --- Graceful shutdown ---
  process.on('SIGINT', () => {
    console.log('\n[Server] 👋 Shutting down...');
    jobQueue.destroy();
    botCore.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Server] 👋 Shutting down (SIGTERM)...');
    jobQueue.destroy();
    botCore.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Server] 💥 Critical error:', err);
  process.exit(1);
});