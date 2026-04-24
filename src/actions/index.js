/**
 * actions/index.js — Local registry of all actions + routing
 */
const { createInfoActions } = require('./info');
const { createNavigationActions } = require('./navigation');
const { createChatActions } = require('./chat');
const { createCombatActions } = require('./combat');
const { createWorldActions } = require('./world');
const { createItemActions } = require('./items');

/**
 * Create a registry of all actions for the bot
 * @param {import('mineflayer').Bot} bot
 */
function createActions(bot) {
  const info = createInfoActions(bot);
  const navigation = createNavigationActions(bot);
  const chat = createChatActions(bot);
  const combat = createCombatActions(bot);
  const world = createWorldActions(bot);
  const items = createItemActions(bot);

  // --- Queued actions (via job queue, one at a time) ---
  const queuedActions = {
    // Navigation
    goto: navigation.goto,
    follow: navigation.followPlayer,

    // Chat
    chat: chat.chat,
    whisper: chat.whisper,

    // Combat
    attack: combat.attack,
    protect: combat.protect,

    // World
    digBlock: world.digBlock,
    collectBlock: world.collectBlock,
    activateBlock: world.activateBlock,
    placeBlock: world.placeBlock,

    // Items
    equipItem: items.equipItem,
    unequipItem: items.unequipItem,
    craftItem: items.craftItem,
    consume: items.consume,
    tossItem: items.tossItem,
    setHotbarSlot: items.setHotbarSlot,
    respawn: items.respawn,
    creativeItem: items.creativeItem,
  };

  // --- Immediate actions (executed instantly, bypassing the queue) ---
  const immediateActions = {
    stop: navigation.stopAll,
  };

  // --- Read-only actions (no side effects, bypassing the queue) ---
  const readOnlyActions = {
    status: info.status,
    position: info.position,
    inventory: info.inventory,
    nearby: info.nearbyEntities,
    scan: info.scanNearbyBlocks,
    findBlock: world.findBlock,
  };

  return { queuedActions, immediateActions, readOnlyActions };
}

module.exports = { createActions };
