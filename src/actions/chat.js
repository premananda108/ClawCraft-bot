/**
 * actions/chat.js — Public chat and private messages
 *
 * Based on API:
 *   bot.chat(message)               — public chat
 *   bot.whisper(username, message)  — private message (/tell)
 */

/**
 * @param {import('mineflayer').Bot} bot
 */
function createChatActions(bot) {
  return {
    /**
     * Send a public message to the chat
     * @param {{ message: string }} params
     */
    async chat(params) {
      if (!bot) throw new Error('Bot not connected');

      const { message } = params;
      if (!message) throw new Error('Required: message');

      bot.chat(message);

      return {
        sent: true,
        type: 'public',
        message,
      };
    },

    /**
     * Send a private message to a player (/tell)
     * @param {{ player: string, message: string }} params
     */
    async whisper(params) {
      if (!bot) throw new Error('Bot not connected');

      const { player, message } = params;
      if (!player) throw new Error('Required: player');
      if (!message) throw new Error('Required: message');

      bot.whisper(player, message);

      return {
        sent: true,
        type: 'whisper',
        to: player,
        message,
      };
    },
  };
}

module.exports = { createChatActions };