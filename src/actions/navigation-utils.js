/**
 * navigation-utils.js — Shared pathfinding helper
 *
 * Uses bot.pathfinder.goto(goal) — the proper async API from mineflayer-pathfinder.
 * It handles noPath and goal_reached internally and returns a Promise,
 * so we do NOT need to manually wire up path_update / goal_reached listeners
 * (which is fragile: once() drops the listener after the first event,
 * which could be a 'partial' update before the real 'noPath').
 *
 * This helper adds AbortSignal support on top of pathfinder.goto().
 *
 * @param {import('mineflayer').Bot} bot
 * @param {import('mineflayer-pathfinder').goals.Goal} goal
 * @param {AbortSignal|null} [signal]
 * @returns {Promise<void>}
 */
async function pathfinderGoto(bot, goal, signal) {
  if (signal && signal.aborted) throw new Error('Cancelled');

  // bot.pathfinder.goto() resolves on goal_reached, rejects on noPath or error
  const gotoPromise = bot.pathfinder.goto(goal);

  if (!signal) return gotoPromise;

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      bot.pathfinder.setGoal(null);
      reject(new Error('Cancelled'));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    gotoPromise.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        // Translate pathfinder's noPath error to a friendlier message
        const msg = err && err.message ? err.message : String(err);
        reject(new Error(msg.includes('No path') ? 'No path found to target' : msg));
      }
    );
  });
}

module.exports = { pathfinderGoto };
