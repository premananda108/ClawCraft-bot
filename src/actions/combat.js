/**
 * combat.js — Layer 3: combat actions and protection
 */

const { goals } = require('mineflayer-pathfinder');
const { GoalFollow } = goals;

/**
 * List of hostile mobs for automatic protection
 */
const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
  'slime', 'ghast', 'husk', 'drowned', 'phantom', 'pillager',
  'ravager', 'evoker', 'vindicator', 'magma_cube', 'silverfish', 'cave_spider'
];

/**
 * Create combat actions
 * @param {import('mineflayer').Bot} bot
 */
function createCombatActions(bot) {
  let protectionInterval = null;
  let targetPlayerName = null;

  // Clean up on bot disconnect to prevent calling methods on a dead bot instance
  bot.once('end', () => {
    if (protectionInterval) {
      clearInterval(protectionInterval);
      protectionInterval = null;
    }
    if (bot.pvp) {
      try { bot.pvp.stop(); } catch (_) { /* ignore */ }
    }
  });

  /**
   * Find the nearest hostile mob
   */
  function findHostileNear(position, radius = 16) {
    return bot.nearestEntity(e => {
      if (!e || !e.isValid || !['mob', 'hostile'].includes(e.type)) return false;
      if (Math.abs(e.position.y - position.y) > 5) return false; // Ignore mobs in caves below or on roofs above
      if (e.position.distanceTo(position) > radius) return false;
      return HOSTILE_MOBS.includes(e.name.toLowerCase());
    });
  }

  return {
    /**
     * Attack an entity by name or ID
     */
    async attack(params, signal) {
      const { name, id } = params;
      let target = null;

      if (id) {
        target = bot.entities[id];
      } else if (name) {
        target = bot.nearestEntity(e => {
          const eName = e.username || e.name || '';
          return eName.toLowerCase().includes(name.toLowerCase());
        });
      }

      if (!target) {
        throw new Error(`Target ${name || id} not found`);
      }

      console.log(`[Combat] Attacking: ${target.name || target.username}`);

      // Use mineflayer-pvp
      if (bot.pvp) {
        bot.pvp.attack(target);

        return new Promise((resolve) => {
          const checkTask = setInterval(() => {
            if (signal?.aborted) {
              bot.pvp.stop();
              clearInterval(checkTask);
              resolve({ ok: false, error: 'Cancelled' });
            }
            // If the target is dead or has disappeared
            if (!target.isValid || target.health <= 0) {
              bot.pvp.stop();
              clearInterval(checkTask);
              resolve({ ok: true, result: 'Target defeated' });
            }
          }, 500);
        });
      } else {
        // Fallback if the plugin is not loaded
        bot.attack(target);
        return { ok: true, result: 'Attacked once (no PVP plugin)' };
      }
    },

    /**
     * Protect a player
     */
    async protect(params, signal) {
      const { player: name, radius = 10 } = params;
      targetPlayerName = name;

      const player = bot.players[name]?.entity;
      if (!player) throw new Error(`Player ${name} not found in sight`);

      console.log(`[Combat] Player protection mode: ${name}`);

      // Stop previous protection if it existed
      if (protectionInterval) clearInterval(protectionInterval);

      return new Promise((resolve) => {
        protectionInterval = setInterval(() => {
          if (signal?.aborted) {
            if (bot.pvp) bot.pvp.stop();
            if (bot.pathfinder) bot.pathfinder.setGoal(null);
            clearInterval(protectionInterval);
            protectionInterval = null;
            resolve({ ok: true, result: 'Protection stopped' });
            return;
          }

          const pEntity = bot.players[targetPlayerName]?.entity;

          // 1. Look for threats around the PLAYER and around the BOT
          const hostileNearPlayer = pEntity ? findHostileNear(pEntity.position, 16) : null;
          const hostileNearBot = findHostileNear(bot.entity.position, 12);

          const target = hostileNearBot || hostileNearPlayer;

          if (target) {
            if (bot.pvp.target !== target) {
              console.log(`[Combat] Protecting! Target: ${target.name || target.username}`);
              bot.pathfinder.setGoal(null); // Stop walking
              bot.pvp.attack(target);
            }
          } else if (pEntity) {
            // If there are no threats, follow the player
            if (bot.pvp.target) bot.pvp.stop();

            // GoalFollow automatically handles distance and updates path.
            // We only need to set it ONCE.
            const currentGoal = bot.pathfinder.goal;
            const isFollowing = currentGoal && currentGoal.entity === pEntity;

            if (!isFollowing) {
              console.log(`[Combat] Following ${targetPlayerName}...`);
              bot.pathfinder.setGoal(new GoalFollow(pEntity, 2), true);
            }
          }
        }, 500); // Increase check frequency to 0.5 sec
      });
    },

    /**
     * Stop combat
     */
    async stopCombat() {
      if (protectionInterval) {
        clearInterval(protectionInterval);
        protectionInterval = null;
      }
      if (bot.pvp) bot.pvp.stop();
      bot.pathfinder.setGoal(null);
      return { ok: true };
    }
  };
}

module.exports = { createCombatActions };