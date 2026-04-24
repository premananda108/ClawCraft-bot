/**
 * actions/world.js — Interaction with the world: findBlock, digBlock, placeBlock
 *
 * Based on API:
 *   bot.findBlock(options)              — find nearest block
 *   bot.findBlocks(options)             — find multiple blocks
 *   bot.blockAt(point)                  — get block at coordinates
 *   bot.dig(block, forceLook, digFace)  — dig block
 *   bot.stopDigging()                   — stop digging
 *   bot.canDigBlock(block)              — if bot can dig block
 *   bot.placeBlock(refBlock, faceVec)   — place block
 *   bot.activateBlock(block)            — activate block (open door, etc.)
 */

const vec3 = require('vec3');

/**
 * @param {import('mineflayer').Bot} bot
 */
function createWorldActions(bot) {

  /**
   * Get mcData (lazy initialization)
   */
  let _mcData = null;
  function getMcData() {
    if (!_mcData) _mcData = require('minecraft-data')(bot.version);
    return _mcData;
  }

  return {
    /**
     * Find nearest block by name (read-only, bypassing the queue)
     * @param {{ name: string, maxDistance?: number, count?: number }} params
     */
    findBlock(params) {
      if (!bot) throw new Error('Bot not connected');

      const { name, maxDistance = 32, count = 1 } = params;
      if (!name) throw new Error('Required: name (block name, e.g. "oak_log")');

      const mcData = getMcData();
      const block = mcData.blocksByName[name];
      if (!block) throw new Error(`Unknown block: "${name}"`);

      const positions = bot.findBlocks({
        matching: block.id,
        maxDistance,
        count,
      });

      if (positions.length === 0) {
        return { found: false, count: 0, blocks: [] };
      }

      const blocks = positions.map(pos => {
        const dist = Math.round(pos.distanceTo(bot.entity.position) * 10) / 10;
        return {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          distance: dist,
        };
      });

      return {
        found: true,
        count: blocks.length,
        blocks,
        nearest: blocks[0],
      };
    },

    /**
     * Dig nearest block by name or by coordinates
     * @param {{ name?: string, x?: number, y?: number, z?: number, maxDistance?: number }} params
     * @param {AbortSignal} signal
     */
    async digBlock(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      let targetBlock;

      if (params.x !== undefined && params.y !== undefined && params.z !== undefined) {
        // Dig a specific block by coordinates
        targetBlock = bot.blockAt(vec3(Math.floor(params.x), Math.floor(params.y), Math.floor(params.z)));
        if (!targetBlock || targetBlock.name === 'air') {
          throw new Error(`No block at (${params.x}, ${params.y}, ${params.z})`);
        }
      } else if (params.name) {
        // Search for the nearest block by name
        const mcData = getMcData();
        const blockData = mcData.blocksByName[params.name];
        if (!blockData) throw new Error(`Unknown block: "${params.name}"`);

        const pos = bot.findBlocks({
          matching: blockData.id,
          maxDistance: params.maxDistance || 32,
          count: 1,
        })[0];

        if (!pos) throw new Error(`Block "${params.name}" not found within ${params.maxDistance || 32} blocks`);

        targetBlock = bot.blockAt(pos);
      } else {
        throw new Error('Required: name (block name) or x, y, z coordinates');
      }

      if (!bot.canDigBlock(targetBlock)) {
        throw new Error(`Cannot dig block "${targetBlock.name}" (out of range or not diggable)`);
      }

      // Use pathfinder to approach if the block is far
      const dist = targetBlock.position.distanceTo(bot.entity.position);
      if (dist > 4.5) {
        const { goals: { GoalBlock } } = require('mineflayer-pathfinder');
        const { x, y, z } = targetBlock.position;
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
              reject(new Error('No path found to block'));
            }
          };

          signal.addEventListener('abort', onAbort, { once: true });
          bot.once('goal_reached', onGoalReached);
          bot.once('path_update', onPathUpdate);
          bot.pathfinder.setGoal(new GoalBlock(x, y, z));
        });
      }

      const blockName = targetBlock.name;
      const blockPos = { ...targetBlock.position };
      const digTime = bot.digTime(targetBlock); // Calculate BEFORE digging — block will be destroyed

      const onAbort = () => bot.stopDigging();
      signal.addEventListener('abort', onAbort, { once: true });

      await bot.dig(targetBlock, true); // forceLook=true
      signal.removeEventListener('abort', onAbort);

      return {
        dug: true,
        block: blockName,
        position: blockPos,
        digTime,
      };
    },

    /**
     * Activate block (open door, press button, etc.)
     * @param {{ x: number, y: number, z: number }} params
     */
    async activateBlock(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { x, y, z } = params;
      if (x === undefined || y === undefined || z === undefined) {
        throw new Error('Required: x, y, z');
      }

      const block = bot.blockAt(vec3(Math.floor(x), Math.floor(y), Math.floor(z)));
      if (!block || block.name === 'air') {
        throw new Error(`No block at (${x}, ${y}, ${z})`);
      }

      await bot.activateBlock(block);

      return {
        activated: true,
        block: block.name,
        position: { x: block.position.x, y: block.position.y, z: block.position.z },
      };
    },

    /**
     * Place block at specified coordinates
     * @param {{ name: string, x: number, y: number, z: number }} params
     */
    async placeBlock(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { name, x, y, z } = params;
      const pos = vec3(x, y, z);

      const mcData = getMcData();
      const itemData = mcData.itemsByName[name];
      if (!itemData) throw new Error(`Unknown item: ${name}`);

      const item = bot.inventory.findInventoryItem(itemData.id, null, false);
      if (!item) throw new Error(`Item ${name} not found in inventory`);

      // 1. Search for support (from below, from the side, etc.)
      const faces = [
        vec3(0, -1, 0),
        vec3(0, 0, -1),
        vec3(0, 0, 1),
        vec3(-1, 0, 0),
        vec3(1, 0, 0),
        vec3(0, 1, 0)
      ];

      let referenceBlock = null;
      let faceVector = null;

      const nonSolidBlocks = ['air', 'void_air', 'cave_air', 'water', 'lava', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'vine', 'glow_lichen'];
      for (const face of faces) {
        const checkPos = pos.plus(face);
        const b = bot.blockAt(checkPos);
        if (b && !nonSolidBlocks.includes(b.name)) {
          referenceBlock = b;
          faceVector = face.scaled(-1); 
          break;
        }
      }

      if (!referenceBlock) {
        throw new Error(`CRITICAL_ERROR_PLACING_BLOCK at (${x}, ${y}, ${z})`);
      }

      // Prevent suffocation (placing block on self)
      const botX = Math.floor(bot.entity.position.x);
      const botY = Math.floor(bot.entity.position.y);
      const botZ = Math.floor(bot.entity.position.z);
      if (Math.floor(x) === botX && Math.floor(z) === botZ && (Math.floor(y) === botY || Math.floor(y) === botY + 1)) {
        throw new Error(`Cannot place block at (${x}, ${y}, ${z}) - bot is standing there!`);
      }

      console.log(`[World] Placing ${name} on ${referenceBlock.name} at (${x}, ${y}, ${z})`);

      // 2. Approach if too far
      const dist = pos.distanceTo(bot.entity.position);
      if (dist > 4.5) {
        const { goals: { GoalNear } } = require('mineflayer-pathfinder');
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
            if (signal) signal.removeEventListener('abort', onAbort);
            bot.removeListener('path_update', onPathUpdate);
            resolve();
          };

          onPathUpdate = (results) => {
            if (results.status === 'noPath') {
              if (signal) signal.removeEventListener('abort', onAbort);
              bot.removeListener('goal_reached', onGoalReached);
              bot.pathfinder.setGoal(null);
              reject(new Error(`No path found to place block at ${x}, ${y}, ${z}`));
            }
          };

          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          bot.once('goal_reached', onGoalReached);
          bot.once('path_update', onPathUpdate);
          bot.pathfinder.setGoal(new GoalNear(x, y, z, 3));
        });
      }

      // 3. Look at placement point
      await bot.lookAt(pos, true);

      // 4. Equip and place
      await bot.equip(item, 'hand');
      await bot.placeBlock(referenceBlock, faceVector);

      return { placed: true, name, position: { x, y, z } };
    },

    /**
     * Collect nearest block by name (uses mineflayer-collectblock)
     * @param {{ name: string, count?: number, maxDistance?: number }} params
     */
    async collectBlock(params, signal) {
      if (!bot) throw new Error('Bot not connected');
      if (!bot.collectBlock) throw new Error('collectBlock plugin not loaded');

      const { name, count = 1, maxDistance = 32 } = params;
      if (!name) throw new Error('Required: name (block name, e.g. "oak_log")');

      const mcData = getMcData();
      const blockData = mcData.blocksByName[name];
      if (!blockData) throw new Error(`Unknown block: "${name}"`);

      const positions = bot.findBlocks({
        matching: blockData.id,
        maxDistance,
        count,
      });

      if (positions.length === 0) {
        throw new Error(`Block "${name}" not found within ${maxDistance} blocks`);
      }

      const blocks = positions.map(pos => bot.blockAt(pos));

      // Register abort handler: stop pathfinder so the plugin can react
      const onAbort = () => {
        bot.pathfinder.setGoal(null);
      };
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        // Explicitly bind method to plugin instance to avoid losing 'this'
        const collect = bot.collectBlock.collect.bind(bot.collectBlock);
        await collect(blocks);
        if (signal.aborted) return { collected: false, reason: 'cancelled' };
        return { collected: true, count: blocks.length, name };
      } catch (err) {
        if (signal.aborted) throw new Error('Cancelled');
        if (err.message === 'Safe to ignore') return { collected: true, name };
        throw err;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

module.exports = { createWorldActions };
