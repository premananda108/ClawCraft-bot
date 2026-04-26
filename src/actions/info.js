/**
 * actions/info.js — Read-only actions (bypassing the queue)
 *
 * status, position, inventory, nearbyEntities, scanNearbyBlocks
 */
const config = require('../config');

const INVENTORY_SLOTS = 36;

/**
 * @param {import('mineflayer').Bot} bot
 */
function createInfoActions(bot) {
  return {
    /**
     * Get full status of the bot
     */
    status() {
      if (!bot) throw new Error('Bot not connected');

      return {
        username: bot.username,
        health: bot.health,
        food: bot.food,
        saturation: bot.foodSaturation,
        oxygen: bot.oxygenLevel,
        gameMode: bot.game.gameMode,
        difficulty: bot.game.difficulty,
        dimension: bot.game.dimension,
        isRaining: bot.isRaining,
        time: {
          timeOfDay: bot.time.timeOfDay,
          day: bot.time.day,
          age: bot.time.age,
        },
        experience: {
          level: bot.experience.level,
          points: bot.experience.points,
          progress: bot.experience.progress,
        },
        position: bot.entity ? {
          x: Math.round(bot.entity.position.x * 100) / 100,
          y: Math.round(bot.entity.position.y * 100) / 100,
          z: Math.round(bot.entity.position.z * 100) / 100,
        } : null,
      };
    },

    /**
     * Get current coordinates of the bot
     */
    position() {
      if (!bot) throw new Error('Bot not connected');
      if (!bot.entity) throw new Error('Bot entity not loaded');

      return {
        x: Math.round(bot.entity.position.x * 100) / 100,
        y: Math.round(bot.entity.position.y * 100) / 100,
        z: Math.round(bot.entity.position.z * 100) / 100,
        yaw: Math.round(bot.entity.yaw * 100) / 100,
        pitch: Math.round(bot.entity.pitch * 100) / 100,
      };
    },

    /**
     * Get bot's inventory contents
     */
    inventory() {
      if (!bot) throw new Error('Bot not connected');

      const items = bot.inventory.items().map(item => ({
        name: item.name,
        displayName: item.displayName,
        count: item.count,
        slot: item.slot,
      }));

      const equipment = {
        hand: bot.heldItem ? {
          name: bot.heldItem.name,
          displayName: bot.heldItem.displayName,
          count: bot.heldItem.count,
        } : null,
      };

      return {
        items,
        itemCount: items.length,
        freeSlots: INVENTORY_SLOTS - items.length,
        equipment,
      };
    },

    /**
     * Get entities near the bot
     */
    nearbyEntities(params = {}) {
      if (!bot) throw new Error('Bot not connected');

      const radius = params.radius || 32;
      const botPos = bot.entity.position;

      if (config.debug) {
        console.log(`[Debug] nearbyEntities called, radius=${radius}, botPos=${botPos}`);
        console.log(`[Debug] total entities in memory: ${Object.keys(bot.entities).length}`);
        
        // Log all players and their entities
        Object.keys(bot.players).forEach(name => {
          const p = bot.players[name];
          console.log(`[Debug] Player: ${name}, entity found: ${!!p.entity}, pos: ${p.entity ? p.entity.position : 'N/A'}`);
        });
      }

      const entities = Object.values(bot.entities)
        .filter(e => {
          if (e === bot.entity) return false;
          const dist = e.position.distanceTo(botPos);
          return dist <= radius;
        })
        .map(e => ({
          name: e.username || e.name || e.displayName || 'unknown',
          type: e.type,
          distance: Math.round(e.position.distanceTo(botPos) * 10) / 10,
          position: {
            x: Math.round(e.position.x * 100) / 100,
            y: Math.round(e.position.y * 100) / 100,
            z: Math.round(e.position.z * 100) / 100,
          },
          health: e.health || null,
        }))
        .sort((a, b) => a.distance - b.distance);

      if (config.debug) {
        console.log(`[Debug] entities found within radius: ${entities.length}`);
      }
      return {
        entities,
        count: entities.length,
        radius,
      };
    },

    /**
     * Scanning nearby blocks for "interest"
     */
    scanNearbyBlocks(params = {}) {
      if (!bot) throw new Error('Bot not connected');

      const MAX_SCAN_RADIUS = 16;
      const radius = Math.min(params.radius || 8, MAX_SCAN_RADIUS);
      const botPos = bot.entity.position.floored();

      // Look for interesting blocks within the radius
      const blocks = [];
      const interestingBlockNames = [
        'log', 'wood', 'ore', 'table', 'furnace', 'chest', 'bed',
        'wheat', 'potato', 'carrot', 'beetroot',
        'stone', 'grass', 'dirt', 'sand', 'gravel'
      ];

      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            const block = bot.blockAt(botPos.offset(x, y, z));
            if (config.debug && x === 0 && y === -1 && z === 0) {
              console.log(`[DebugScan] Block at feet (${botPos.offset(0,-1,0)}): ${block ? block.name : 'null'}`);
            }
            if (!block || block.name === 'air') continue;

            // If the radius is small, return everything. Otherwise - only interesting ones.
            const isInteresting = interestingBlockNames.some(kw => block.name.toLowerCase().includes(kw));
            if (radius <= 2 || isInteresting) {
              blocks.push({
                name: block.name,
                position: {
                  x: block.position.x,
                  y: block.position.y,
                  z: block.position.z,
                },
                distance: Math.round(block.position.distanceTo(botPos) * 10) / 10,
              });
            }
          }
        }
      }

      // Sort by distance
      blocks.sort((a, b) => a.distance - b.distance);

      return {
        blocks: blocks.slice(0, 500), // Return max 500
        count: blocks.length,
        radius,
      };
    },
  };
}

module.exports = { createInfoActions };
