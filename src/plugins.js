/**
 * plugins.js — Layer 2: loading and configuring extensions
 */

let viewerRunning = false;

/**
 * Load mandatory and optional plugins
 * @param {import('mineflayer').Bot} bot
 * @param {object} config
 */
function loadPlugins(bot, config) {
  // --- Mandatory: pathfinder ---
  try {
    const { pathfinder, Movements } = require('mineflayer-pathfinder');
    bot.loadPlugin(pathfinder);

    // Initialize global movements right after loading the plugin
    const movements = new Movements(bot);
    movements.canOpenDoors = false; // Doors are unreliable
    bot.pathfinder.setMovements(movements);

    console.log('[Plugins] ✅ mineflayer-pathfinder loaded');
  } catch (err) {
    console.error('[Plugins] ❌ Failed to load pathfinder:', err.message);
    throw err; // pathfinder is mandatory — MVP won't work without it
  }

  // --- PVP ---
  try {
    const { plugin: pvp } = require('mineflayer-pvp');
    bot.loadPlugin(pvp);
    console.log('[Plugins] ✅ mineflayer-pvp loaded');
  } catch (err) {
    console.warn('[Plugins] ⚠️  mineflayer-pvp failed to load:', err.message);
  }

  // --- CollectBlock + Tool ---
  try {
    const toolPlugin = require('mineflayer-tool').plugin;
    if (toolPlugin) {
      bot.loadPlugin(toolPlugin);
      console.log('[Plugins] ✅ mineflayer-tool loaded');
    }

    const collectBlockPlugin = require('mineflayer-collectblock').plugin;
    if (collectBlockPlugin) {
      bot.loadPlugin(collectBlockPlugin);
      console.log('[Plugins] ✅ mineflayer-collectblock loaded');
    }
  } catch (err) {
    console.warn('[Plugins] ⚠️  Error loading collectblock/tool:', err.message);
  }
}

module.exports = { loadPlugins };
