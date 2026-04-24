/**
 * actions/items.js — Items: equip, craft, consume, toss, setHotbarSlot
 *
 * Based on API:
 *   bot.equip(item, destination)              — equip/hold item
 *   bot.unequip(destination)                  — unequip item
 *   bot.craft(recipe, count, craftingTable)   — craft item
 *   bot.recipesFor(itemType, meta, min, table)— crafting recipes
 *   bot.consume()                             — eat/drink held item
 *   bot.toss(itemType, metadata, count)       — toss item
 *   bot.setQuickBarSlot(slot)                 — select hotbar slot (0-8)
 *   bot.findBlock(options)                    — find crafting table/chest
 */

/**
 * @param {import('mineflayer').Bot} bot
 */
function createItemActions(bot) {

  let _mcData = null;
  function getMcData() {
    if (!_mcData) _mcData = require('minecraft-data')(bot.version);
    return _mcData;
  }

  return {
    /**
     * Equip an item from the inventory
     * @param {{ name: string, destination?: string }} params
     * destination: "hand" | "head" | "torso" | "legs" | "feet" | "off-hand"
     */
    async equipItem(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { name, destination = 'hand' } = params;
      if (!name) throw new Error('Required: name (item name)');

      const validDestinations = ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'];
      if (!validDestinations.includes(destination)) {
        throw new Error(`Invalid destination. Use one of: ${validDestinations.join(', ')}`);
      }

      const mcData = getMcData();
      const itemData = mcData.itemsByName[name];
      if (!itemData) throw new Error(`Unknown item: "${name}"`);

      // Look for the item in the inventory
      let item = bot.inventory.findInventoryItem(itemData.id, null, false);

      // If the item is missing but we are in creative mode, "pull" it from the infinite creative inventory
      if (!item && bot.game && bot.game.gameMode === 'creative') {
        const Item = require('prismarine-item')(bot.version);
        const newItem = new Item(itemData.id, 1);
        await bot.creative.setInventorySlot(36, newItem); // Put it in the first hotbar slot

        // Minecraft needs a few milliseconds (ticks) for the server to process the packet
        await new Promise(resolve => setTimeout(resolve, 500));

        item = bot.inventory.findInventoryItem(itemData.id, null, false);
      }

      if (!item) throw new Error(`Item "${name}" not found in inventory`);

      await bot.equip(item, destination);

      return {
        equipped: true,
        item: name,
        destination,
        slot: item.slot,
      };
    },

    /**
     * Unequip an item from the equipment slot
     * @param {{ destination: string }} params
     */
    async unequipItem(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { destination } = params;
      if (!destination) throw new Error('Required: destination (hand/head/torso/legs/feet/off-hand)');

      await bot.unequip(destination);

      return { unequipped: true, destination };
    },

    /**
     * Craft an item
     * @param {{ name: string, count?: number, useCraftingTable?: boolean }} params
     */
    async craftItem(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { name, count = 1, useCraftingTable = false } = params;
      if (!name) throw new Error('Required: name (item name)');

      const mcData = getMcData();
      const itemData = mcData.itemsByName[name];
      if (!itemData) throw new Error(`Unknown item: "${name}"`);

      let craftingTable = null;

      if (useCraftingTable) {
        // Find the nearest crafting table on a reachable level
        const tableBlock = bot.findBlock({
          matching: mcData.blocksByName['crafting_table'].id,
          maxDistance: 16,
          use: (block) => Math.abs(block.position.y - bot.entity.position.y) <= 3
        });
        if (!tableBlock) throw new Error('No crafting table found within 32 blocks');

        // Approach the crafting table if necessary
        const dist = tableBlock.position.distanceTo(bot.entity.position);
        if (dist > 4) {
          const { goals: { GoalBlock } } = require('mineflayer-pathfinder');
          await new Promise((resolve, reject) => {
            let onPathUpdate;
            let onGoalReached;

            const onAbort = () => {
              bot.pathfinder.setGoal(null);
              bot.removeListener('path_update', onPathUpdate);
              bot.removeListener('goal_reached', onGoalReached);
              reject(new Error('Cancelled'));
            };

            onGoalReached = () => {
              signal.removeEventListener('abort', onAbort);
              bot.removeListener('path_update', onPathUpdate);
              resolve();
            };

            onPathUpdate = (results) => {
              if (results.status === 'noPath') {
                signal.removeEventListener('abort', onAbort);
                bot.removeListener('goal_reached', onGoalReached);
                bot.pathfinder.setGoal(null);
                reject(new Error('No path found to crafting table'));
              }
            };

            signal.addEventListener('abort', onAbort, { once: true });
            bot.once('goal_reached', onGoalReached);
            bot.once('path_update', onPathUpdate);
            bot.pathfinder.setGoal(new GoalBlock(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z));
          });
        }
        craftingTable = tableBlock;
      }

      // Get recipes
      const recipes = bot.recipesFor(itemData.id, null, 1, craftingTable);
      if (!recipes || recipes.length === 0) {
        const allRecipes = bot.recipesAll(itemData.id, null, craftingTable);
        if (allRecipes.length === 0) {
          throw new Error(`No recipe found for "${name}"`);
        }
        throw new Error(`You don't have enough materials to craft "${name}"`);
      }

      const recipe = recipes[0];
      const yieldPerCraft = recipe.result.count || 1;
      const timesToCraft = Math.ceil(count / yieldPerCraft);

      console.log(`[Items] Crafting ${name}: need ${count}, yield per craft ${yieldPerCraft}, repeating ${timesToCraft} time(s)`);

      await bot.craft(recipe, timesToCraft, craftingTable);

      return {
        crafted: true,
        item: name,
        count,
        usedCraftingTable: !!craftingTable,
      };
    },

    /**
     * Eat/drink the item in hand
     */
    async consume(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      if (!bot.heldItem) throw new Error('Bot is not holding any item');

      const heldName = bot.heldItem.name;
      await bot.consume();

      return {
        consumed: true,
        item: heldName,
      };
    },

    /**
     * Toss items from the inventory
     * @param {{ name: string, count?: number }} params
     */
    async tossItem(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { name, count = 1 } = params;
      if (!name) throw new Error('Required: name (item name)');

      const mcData = getMcData();
      const itemData = mcData.itemsByName[name];
      if (!itemData) throw new Error(`Unknown item: "${name}"`);

      // Check availability in the inventory
      const item = bot.inventory.findInventoryItem(itemData.id, null, false);
      if (!item) throw new Error(`Item "${name}" not found in inventory`);

      await bot.toss(itemData.id, null, count);

      return {
        tossed: true,
        item: name,
        count,
      };
    },

    /**
     * Select a hotbar slot (0-8)
     * @param {{ slot: number }} params
     */
    async setHotbarSlot(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { slot } = params;
      if (slot === undefined || slot < 0 || slot > 8) {
        throw new Error('Required: slot (0-8)');
      }

      bot.setQuickBarSlot(slot);

      return {
        slot,
        heldItem: bot.heldItem ? {
          name: bot.heldItem.name,
          displayName: bot.heldItem.displayName,
          count: bot.heldItem.count,
        } : null,
      };
    },

    /**
     * Respawn after death
     */
    async respawn(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      bot.respawn();

      return { respawning: true };
    },

    /**
     * Give yourself an item (Creative mode only)
     * @param {{ name: string, count?: number, slot?: number }} params
     */
    async creativeItem(params, signal) {
      if (!bot) throw new Error('Bot not connected');
      if (bot.game && bot.game.gameMode !== 'creative') throw new Error('Bot must be in creative mode');

      const { name, count = 1, slot = 36 } = params; // 36 - first hotbar slot
      const mcData = getMcData();
      const itemData = mcData.itemsByName[name];
      if (!itemData) throw new Error(`Unknown item: "${name}"`);

      const Item = require('prismarine-item')(bot.version);
      const item = new Item(itemData.id, count);

      await bot.creative.setInventorySlot(slot, item);

      return {
        given: true,
        item: name,
        count,
        slot,
      };
    },
  };
}

module.exports = { createItemActions };