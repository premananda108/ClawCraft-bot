/**
 * building.js — High-level building actions
 */
const { GoalBlock } = require('mineflayer-pathfinder').goals;
const { ensureMovements } = require('./navigation-utils');

function createBuildingActions(bot) {
  return {
    /**
     * Build a simple 5x5x3 house with a roof
     * @param {object} params
     * @param {string} params.material - block name (e.g. 'oak_planks')
     * @param {AbortSignal} signal
     */
    async buildHouse(params, signal) {
      if (!bot) throw new Error('Bot not connected');
      
      const startPos = bot.entity.position.clone().floored();
      const base = startPos.offset(2, 0, 2); 
      
      console.log(`[Building] Starting 5x5 Starter House at ${base}`);

      const materials = {
        pillar: 'oak_log',
        wall: 'oak_planks',
        roof: 'oak_slab'
      };

      // 1. Prepare items (Creative mode)
      if (bot.game.gameMode === 'creative') {
        const mcData = require('minecraft-data')(bot.version);
        const Item = require('prismarine-item')(bot.version);
        for (const m of Object.values(materials)) {
          const item = mcData.itemsByName[m];
          if (item) {
            // We'll just put them in different slots to be safe, or equip as needed
            await bot.creative.setInventorySlot(36, new Item(item.id, 64));
          }
        }
      }

      const blocksToPlace = [];
      const size = 5;
      const height = 4;

      // Plan the build
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < size; x++) {
          for (let z = 0; z < size; z++) {
            const isCorner = (x === 0 || x === size - 1) && (z === 0 || z === size - 1);
            const isEdge = x === 0 || x === size - 1 || z === 0 || z === size - 1;
            const isRoof = y === height - 1;

            let type = null;
            if (isCorner && !isRoof) {
              type = materials.pillar;
            } else if (isEdge && !isRoof) {
              // Leave door at (2, 0, 0) and (2, 1, 0)
              if (x === 2 && z === 0 && (y === 0 || y === 1)) continue;
              // Leave windows at (0, 2, 2) and (4, 2, 2) and (2, 2, 4)
              if (y === 2 && ((x === 0 && z === 2) || (x === 4 && z === 2) || (x === 2 && z === 4))) continue;
              
              type = materials.wall;
            } else if (isRoof) {
              type = materials.roof;
            }

            if (type) {
              blocksToPlace.push({ pos: base.offset(x, y, z), type });
            }
          }
        }
      }

      // 2. Execution
      for (const task of blocksToPlace) {
        if (signal?.aborted) throw new Error('Building cancelled');

        const existing = bot.blockAt(task.pos);
        if (existing && existing.name !== 'air' && existing.name !== 'cave_air') continue;

        try {
          // Equip correct material
          await equipCreative(bot, task.type);

          // Move closer
          if (bot.entity.position.distanceTo(task.pos) > 4.5) {
            ensureMovements(bot);
            await bot.pathfinder.goto(new GoalBlock(task.pos.x, task.pos.y, task.pos.z));
          }

          const support = findSupport(bot, task.pos);
          if (support) {
            await bot.lookAt(task.pos);
            await bot.placeBlock(support.block, support.face);
            // Small delay to make it look natural and avoid server lag issues
            await new Promise(r => setTimeout(r, 200)); 
          }
        } catch (err) {
          console.warn(`[Building] Skip ${task.pos} (${task.type}): ${err.message}`);
        }
      }

      return { ok: true, message: 'Starter house completed!', position: base };
    }
  };
}

/**
 * Helper for creative mode item switching
 */
async function equipCreative(bot, itemName) {
  if (bot.heldItem && bot.heldItem.name === itemName) return;
  
  const mcData = require('minecraft-data')(bot.version);
  const Item = require('prismarine-item')(bot.version);
  const itemData = mcData.itemsByName[itemName];
  
  if (!itemData) throw new Error(`Unknown item: ${itemName}`);
  
  // In creative, we can just "spawn" the item into the hand slot (36 is hotbar 0)
  await bot.creative.setInventorySlot(36, new Item(itemData.id, 64));
  await bot.equip(36, 'hand');
}


/**
 * Helper to find a neighboring solid block to place against
 */
function findSupport(bot, pos) {
  const directions = [
    { vec: require('vec3')(0, -1, 0), face: require('vec3')(0, 1, 0) },
    { vec: require('vec3')(0, 0, -1), face: require('vec3')(0, 0, 1) },
    { vec: require('vec3')(0, 0, 1), face: require('vec3')(0, 0, -1) },
    { vec: require('vec3')(-1, 0, 0), face: require('vec3')(1, 0, 0) },
    { vec: require('vec3')(1, 0, 0), face: require('vec3')(-1, 0, 0) },
  ];

  for (const dir of directions) {
    const neighbor = bot.blockAt(pos.plus(dir.vec));
    if (neighbor && neighbor.boundingBox === 'block') {
      return { block: neighbor, face: dir.face };
    }
  }
  return null;
}

module.exports = { createBuildingActions };
