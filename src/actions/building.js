/**
 * building.js — High-level building actions
 */
const { GoalNear } = require('mineflayer-pathfinder').goals;
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
      if (bot.game.gameMode !== 'creative') {
        throw new Error('buildHouse requires creative mode. Please switch gamemode first.');
      }
      
      const startPos = bot.entity.position.clone().floored();
      const base = findBuildArea(bot, startPos, 5); 
      
      console.log(`[Building] Starting 5x5 Starter House at ${base}`);

      const mcData = require('minecraft-data')(bot.version);
      const reqMat = params?.material || 'oak_planks';
      
      const materials = {
        pillar: 'oak_log',
        wall: reqMat,
        roof: 'oak_slab'
      };

      // Heuristics for wood types or custom materials
      if (reqMat.includes('planks')) {
        const type = reqMat.split('_')[0]; 
        if (mcData.itemsByName[`${type}_log`]) materials.pillar = `${type}_log`;
        if (mcData.itemsByName[`${type}_slab`]) materials.roof = `${type}_slab`;
      } else if (reqMat !== 'oak_planks') {
        materials.pillar = reqMat;
        if (mcData.itemsByName[`${reqMat}_slab`]) {
          materials.roof = `${reqMat}_slab`;
        } else {
          materials.roof = reqMat;
        }
      }

      // 1. Prepare items (Creative mode)
      if (bot.game.gameMode === 'creative') {
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

      // Clear the build area
      console.log(`[Building] Clearing build area...`);
      for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < size; x++) {
          for (let z = 0; z < size; z++) {
            if (signal?.aborted) throw new Error('Building cancelled');
            const clearPos = base.offset(x, y, z);
            const block = bot.blockAt(clearPos);
            if (block && block.name !== 'air' && block.name !== 'cave_air') {
              try {
                if (bot.canDigBlock(block)) {
                  if (bot.entity.position.distanceTo(clearPos) > 4.5) {
                    ensureMovements(bot);
                    await bot.pathfinder.goto(new GoalNear(clearPos.x, clearPos.y, clearPos.z, 3));
                  }
                  const toDig = bot.blockAt(clearPos);
                  if (toDig && toDig.name !== 'air' && bot.canDigBlock(toDig)) {
                    await bot.dig(toDig, true);
                  }
                }
              } catch (err) {
                console.warn(`[Building] Skip clearing ${clearPos}: ${err.message}`);
              }
            }
          }
        }
      }

      // Ensure floor exists
      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const floorPos = base.offset(x, -1, z);
          const block = bot.blockAt(floorPos);
          if (block && (block.name === 'air' || block.name === 'cave_air' || block.name.includes('water') || block.name.includes('lava'))) {
            blocksToPlace.push({ pos: floorPos, type: materials.wall });
          }
        }
      }

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
            await bot.pathfinder.goto(new GoalNear(task.pos.x, task.pos.y, task.pos.z, 3));
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
  bot.setQuickBarSlot(0);
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

/**
 * Helper to find a suitable flat area for building
 */
function findBuildArea(bot, startPos, size = 5) {
  let bestPos = null;
  let bestScore = Infinity;

  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      for (let y = -4; y <= 4; y++) {
        const candidate = startPos.offset(x, y, z);
        let clearCount = 0;
        let fillCount = 0;
        let valid = true;

        for (let bx = 0; bx < size; bx++) {
          for (let bz = 0; bz < size; bz++) {
            const floorBlock = bot.blockAt(candidate.offset(bx, -1, bz));
            if (!floorBlock) { valid = false; break; }
            if (floorBlock.name === 'air' || floorBlock.name === 'cave_air' || floorBlock.name.includes('water') || floorBlock.name.includes('lava')) {
              fillCount++;
            }

            for (let by = 0; by < 4; by++) {
              const spaceBlock = bot.blockAt(candidate.offset(bx, by, bz));
              if (!spaceBlock) { valid = false; break; }
              if (spaceBlock.name !== 'air' && spaceBlock.name !== 'cave_air' && !spaceBlock.name.includes('leaves') && !spaceBlock.name.includes('grass') && spaceBlock.name !== 'snow') {
                clearCount++;
              }
            }
            if (!valid) break;
          }
          if (!valid) break;
        }

        if (valid) {
          const score = (clearCount * 2) + (fillCount * 3) + candidate.distanceTo(startPos);
          if (score < bestScore) {
            bestScore = score;
            bestPos = candidate;
          }
        }
      }
    }
  }

  return bestPos || startPos.offset(2, 0, 2);
}

module.exports = { createBuildingActions };
