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

/**
 * @param {import('mineflayer').Bot} bot
 */
function createNavigationActions(bot) {
  /** @type {Movements|null} */
  let movements = null;



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

      return new Promise((resolve, reject) => {
        // On abort — stop pathfinder and clean up listeners
        const onAbort = () => {
          bot.pathfinder.setGoal(null);
          bot.removeListener('goal_reached', onGoalReached);
          bot.removeListener('path_update', onPathUpdate);
          reject(new Error('Cancelled'));
        };

        const onGoalReached = () => {
          signal.removeEventListener('abort', onAbort);
          bot.removeListener('path_update', onPathUpdate);
          const pos = bot.entity.position;
          resolve({
            arrived: true,
            position: {
              x: Math.round(pos.x * 100) / 100,
              y: Math.round(pos.y * 100) / 100,
              z: Math.round(pos.z * 100) / 100,
            },
          });
        };

        const onPathUpdate = (results) => {
          if (results.status === 'noPath') {
            signal.removeEventListener('abort', onAbort);
            bot.removeListener('goal_reached', onGoalReached);
            bot.pathfinder.setGoal(null);
            reject(new Error('No path found to target'));
          }
        };

        signal.addEventListener('abort', onAbort, { once: true });
        bot.once('goal_reached', onGoalReached);
        bot.once('path_update', onPathUpdate);

        bot.pathfinder.setGoal(goal);
      });
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
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          bot.pathfinder.setGoal(null);
          resolve({
            following: false,
            reason: 'stopped',
            player,
          });
        };
        signal.addEventListener('abort', onAbort, { once: true });

        // If the player leaves — stop following
        const onPlayerLeft = (leftPlayer) => {
          if (leftPlayer.username === player) {
            signal.removeEventListener('abort', onAbort);
            bot.pathfinder.setGoal(null);
            resolve({
              following: false,
              reason: 'player_left',
              player,
            });
          }
        };
        bot.on('playerLeft', onPlayerLeft);

        // Cleanup on abort
        signal.addEventListener('abort', () => {
          bot.removeListener('playerLeft', onPlayerLeft);
        }, { once: true });
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