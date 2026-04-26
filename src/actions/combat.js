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
  let protectionResolve = null;

  function _stopProtection(reason = 'stopped') {
    if (protectionInterval) {
      clearInterval(protectionInterval);
      protectionInterval = null;
    }
    if (protectionResolve) {
      protectionResolve({ protecting: false, player: targetPlayerName, reason });
      protectionResolve = null;
    }
  }

  // Note: We intentionally do NOT use bot.once('end') for cleanup here.
  // Mineflayer can emit 'end' during dimension changes or server respawn
  // mechanics even when the bot is still alive, which prematurely kills
  // protection. Instead, the protect interval checks bot.entity/health
  // inline (line ~129) and stopCombat() handles manual cleanup.

  function findHostileNear(position, radius = 16) {
    return bot.nearestEntity(e => {
      if (!e || !e.isValid) return false;
      const eName = e.name || e.username;
      if (!eName) return false;
      if (Math.abs(e.position.y - position.y) > 10) return false; // Ignore mobs in caves below or on roofs above
      if (e.position.distanceTo(position) > radius) return false;
      return HOSTILE_MOBS.includes(eName.toLowerCase());
    });
  }

  return {
    /**
     * Attack an entity by name or ID
     */
    async attack(params, signal) {
      if (signal?.aborted) throw new Error('Cancelled');
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

        const MAX_TICKS = 60; // Safety limit: 60 * 500ms = 30s max
        return new Promise((resolve) => {
          let ticks = 0;
          let resolved = false;

          const finish = (result) => {
            if (resolved) return;
            resolved = true;
            bot.pvp.stop();
            clearInterval(checkTask);
            resolve(result);
          };

          const checkTask = setInterval(() => {
            ticks++;
            if (signal?.aborted) {
              finish({ attacked: false, target: target.username || target.name, reason: 'cancelled' });
              return;
            }
            // If the target is dead or has disappeared
            if (!target.isValid || target.health <= 0) {
              finish({ attacked: true, target: target.username || target.name, outcome: 'Target defeated' });
              return;
            }
            // Safety: stop if taking too long (target may have escaped)
            if (ticks >= MAX_TICKS) {
              finish({ attacked: true, target: target.username || target.name, outcome: 'Combat timed out (target escaped?)' });
            }
          }, 500);
        });
      } else {
        // Fallback if the plugin is not loaded
        bot.attack(target);
        return { attacked: true, target: target.username || target.name, outcome: 'Attacked once (no PVP plugin)' };
      }
    },

    /**
     * Protect a player
     */
    async protect(params, signal) {
      if (signal?.aborted) throw new Error('Cancelled');
      const { player: name, radius = 10 } = params;
      targetPlayerName = name;

      const player = bot.players[name]?.entity;
      if (!player) throw new Error(`Player ${name} not found in sight`);

      console.log(`[Combat] Player protection mode: ${name}`);

      // Stop previous protection if it existed
      _stopProtection('superseded');

      return new Promise((resolve) => {
        protectionResolve = resolve;
        let unavailableTicks = 0;
        const MAX_UNAVAILABLE_TICKS = 20; // 20 * 500ms = 10s before assuming disconnected

        protectionInterval = setInterval(() => {
          if (signal?.aborted) {
            _stopProtection('stopped');
            return;
          }

          // Skip tick if bot is dead or not fully spawned
          if (!bot.entity || bot.health <= 0 || bot.isDead) {
            unavailableTicks++;
            if (bot.pvp) try { bot.pvp.stop(); } catch (_) { }
            if (bot.pathfinder) try { bot.pathfinder.setGoal(null); } catch (_) { }

            // If bot has been unavailable too long, assume real disconnect
            if (unavailableTicks >= MAX_UNAVAILABLE_TICKS) {
              console.log('[Combat] Bot unavailable for too long — stopping protection');
              _stopProtection('disconnected');
            }
            return;
          }

          // Bot is alive — reset counter
          unavailableTicks = 0;

          const pEntity = bot.players[targetPlayerName]?.entity;


          // 1. Look for threats around the PLAYER and around the BOT
          const hostileNearPlayer = pEntity ? findHostileNear(pEntity.position, 16) : null;
          const hostileNearBot = findHostileNear(bot.entity.position, 12);

          const target = hostileNearBot || hostileNearPlayer;

          if (target) {
            if (bot.pvp && bot.pvp.target !== target) {
              console.log(`[Combat] Protecting! Target: ${target.name || target.username}`);
              bot.pathfinder.setGoal(null); // Stop walking
              bot.pvp.attack(target);
            }
          } else if (pEntity) {
            // If there are no threats, follow the player
            if (bot.pvp && bot.pvp.target) bot.pvp.stop();

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
      _stopProtection('manual_stop');
      if (bot.pvp) bot.pvp.stop();
      if (bot.pathfinder) bot.pathfinder.setGoal(null);
      return { combatStopped: true };
    }
  };
}

module.exports = { createCombatActions };