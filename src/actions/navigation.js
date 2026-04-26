/**
 * actions/navigation.js — Navigation: goto, followPlayer, stopAll
 *
 * All async actions go through the job queue.
 * Uses mineflayer-pathfinder for navigation.
 */
const {
  Movements,
  goals: { GoalBlock, GoalNear, GoalFollow },
} = require('mineflayer-pathfinder');
const { pathfinderGoto } = require('./navigation-utils');

/**
 * @param {import('mineflayer').Bot} bot
 */
function createNavigationActions(bot) {
  return {
    /**
     * Go to coordinates { x, y, z }
     * @param {{ x: number, y: number, z: number }} params
     * @param {AbortSignal} signal
     */
    async goto(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { x, y, z } = params;
      if (x === undefined || y === undefined || z === undefined) {
        throw new Error('Required: x, y, z');
      }

      const goal = new GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      await pathfinderGoto(bot, goal, signal);

      const pos = bot.entity.position;
      return {
        arrived: true,
        position: {
          x: Math.round(pos.x * 100) / 100,
          y: Math.round(pos.y * 100) / 100,
          z: Math.round(pos.z * 100) / 100,
        },
      };
    },

    /**
     * Follow a player
     * @param {{ player: string, distance?: number }} params
     * @param {AbortSignal} signal
     */
    async followPlayer(params, signal) {
      if (!bot) throw new Error('Bot not connected');

      const { player, distance = 3 } = params;
      if (!player) throw new Error('Required: player name');

      const target = bot.players[player];
      if (!target || !target.entity) {
        throw new Error(`Player "${player}" not found or not visible`);
      }

      const goal = new GoalFollow(target.entity, distance);
      bot.pathfinder.setGoal(goal, true); // true = dynamic (updates)

      // Follow works until cancelled
      return new Promise((resolve) => {
        let resolved = false;

        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
          bot.removeListener('playerLeft', onPlayerLeft);
        };

        const onAbort = () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          bot.pathfinder.setGoal(null);
          resolve({ following: false, reason: 'stopped', player });
        };

        const onPlayerLeft = (leftPlayer) => {
          if (leftPlayer.username !== player || resolved) return;
          resolved = true;
          cleanup();
          bot.pathfinder.setGoal(null);
          resolve({ following: false, reason: 'player_left', player });
        };

        signal.addEventListener('abort', onAbort, { once: true });
        bot.on('playerLeft', onPlayerLeft);
      });
    },

    /**
     * Stop all movement
     */
    async stopAll() {
      if (!bot) throw new Error('Bot not connected');

      // setGoal(null) — immediate stop (better than stop())
      bot.pathfinder.setGoal(null);

      // Release all controls
      bot.clearControlStates();

      return { stopped: true };
    },
  };
}

module.exports = { createNavigationActions };