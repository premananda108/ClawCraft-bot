/**
 * bot-core.js — Layer 1: bot lifecycle, reconnect, state
 */
const mineflayer = require('mineflayer');
const EventEmitter = require('events');

class BotCore extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.bot = null;
    this.state = {
      connected: false,
      spawned: false,
      reconnecting: false,
    };
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._intentionalDisconnect = false;
  }

  /**
   * Create and connect the bot
   */
  connect() {
    this._clearReconnectTimer();
    if (this.bot) {
      this.disconnect();
    }

    this.state.reconnecting = false;
    this._reconnectAttempts = 0;

    this._createBot();
  }

  /**
   * Disconnect the bot
   */
  disconnect() {
    this._clearReconnectTimer();
    this.state.reconnecting = false;
    this._intentionalDisconnect = true;

    if (this.bot) {
      if (typeof this.bot.quit === 'function') {
        this.bot.quit();
      }
      this.bot = null;
    }

    this.state.connected = false;
    this.state.spawned = false;
    this.emit('disconnected', { reason: 'manual' });
  }

  /**
   * Internal bot creation
   */
  _createBot() {
    const mcConfig = {
      host: this.config.mc.host,
      port: this.config.mc.port,
      username: this.config.mc.username,
      auth: this.config.mc.auth,
    };

    // If version is specified, set it explicitly; otherwise — auto-detect
    if (this.config.mc.version) {
      mcConfig.version = this.config.mc.version;
    }

    console.log(`[BotCore] Connecting to ${mcConfig.host}:${mcConfig.port} as ${mcConfig.username}...`);
    this.bot = mineflayer.createBot(mcConfig);

    // --- Patch bot.lookAt and bot.look to prevent NaN coordinates corruption ---
    // (mineflayer-pvp and other plugins can sometimes pass undefined target.height resulting in NaN)
    const originalLookAt = this.bot.lookAt;
    this.bot.lookAt = function (point, force) {
      if (!point || Number.isNaN(point.x) || Number.isNaN(point.y) || Number.isNaN(point.z)) {
        console.error('[BotCore] ⚠️ Prevented lookAt with NaN coordinates:', point);
        return Promise.resolve();
      }
      return originalLookAt.call(this, point, force);
    };

    const originalLook = this.bot.look;
    this.bot.look = function (yaw, pitch, force) {
      if (Number.isNaN(yaw) || Number.isNaN(pitch)) {
        console.error('[BotCore] ⚠️ Prevented look with NaN angles:', yaw, pitch);
        return Promise.resolve();
      }
      return originalLook.call(this, yaw, pitch, force);
    };

    let lastValidPos = null;
    this.bot.on('physicTick', () => {
      const e = this.bot.entity;
      if (!e || !e.position || !e.velocity) return;

      if (Number.isNaN(e.position.x) || Number.isNaN(e.position.y) || Number.isNaN(e.position.z)) {
        if (lastValidPos) {
          e.position.set(lastValidPos.x, lastValidPos.y, lastValidPos.z);
          e.velocity.set(0, 0, 0);
        }
      } else {
        lastValidPos = e.position.clone();
      }

      if (Number.isNaN(e.velocity.x) || Number.isNaN(e.velocity.y) || Number.isNaN(e.velocity.z)) {
        e.velocity.set(0, 0, 0);
      }
    });

    let isFirstSpawn = true;

    // --- Event: bot appeared in the world ---
    this.bot.on('spawn', () => {
      this.state.spawned = true;
      if (isFirstSpawn) {
        console.log(`[BotCore] ✅ Bot ${this.config.mc.username} spawned in the world`);
        this.state.connected = true;
        this.state.reconnecting = false;
        this._reconnectAttempts = 0;
        this.emit('spawned', this.bot);
        isFirstSpawn = false;
      } else {
        console.log(`[BotCore] 👼 Bot respawned`);
        this.emit('respawned');
      }
    });

    this.bot.on('death', () => {
      console.log('[BotCore] 💀 Bot died! Waiting for mineflayer auto-respawn...');
      this.state.spawned = false;
      // Note: We do NOT call bot.respawn() manually because mineflayer does it
      // automatically by default. Calling it twice glitches the server and
      // causes infinite death/respawn loops.
    });

    // --- Event: kick from server ---
    this.bot.on('kicked', (reason, loggedIn) => {
      if (this._intentionalDisconnect) return;
      let reasonStr = '';
      if (typeof reason === 'string') {
        reasonStr = reason;
      } else {
        try {
          reasonStr = JSON.stringify(reason);
        } catch (e) {
          reasonStr = String(reason);
        }
      }
      console.log(`[BotCore] ⛔ Kick: ${reasonStr} (loggedIn: ${loggedIn})`);
      this.state.connected = false;
      this.state.spawned = false;
      this.emit('kicked', { reason: reasonStr, loggedIn });
      // The 'end' event will fire immediately after 'kicked', so we don't call _tryReconnect here
      // to avoid setting up duplicate reconnect timers.
    });

    // --- Event: disconnection ---
    this.bot.on('end', (reason) => {
      if (this._intentionalDisconnect) {
        this._intentionalDisconnect = false;
        return;
      }
      console.log(`[BotCore] 🔌 Disconnection: ${reason}`);
      this.state.connected = false;
      this.state.spawned = false;
      this.emit('ended', { reason });
      this._tryReconnect(reason);
    });

    // --- Event: error ---
    this.bot.on('error', (err) => {
      console.error(`[BotCore] ❌ Error: ${err.message}`);
      this.emit('botError', err);
    });

    // --- Event: chat message ---
    this.bot.on('chat', (username, message) => {
      this.emit('chat', { username, message });
    });
  }

  /**
   * Auto-reconnect with exponential backoff
   */
  _tryReconnect(reason) {
    if (!this.config.autoReconnect) {
      console.log('[BotCore] Auto-reconnect disabled');
      return;
    }

    this._clearReconnectTimer();

    if (this._reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log(`[BotCore] ❌ Exceeded max reconnect attempts (${this.config.maxReconnectAttempts})`);
      this.emit('reconnectFailed');
      return;
    }

    this._reconnectAttempts++;
    this.state.reconnecting = true;

    // Exponential backoff: delay * 2^(attempt-1), but not more than 60s
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this._reconnectAttempts - 1),
      60000
    );

    console.log(`[BotCore] 🔄 Reconnecting in ${delay / 1000}s (attempt ${this._reconnectAttempts}/${this.config.maxReconnectAttempts})...`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._createBot();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Check if bot is ready
   */
  isReady() {
    return this.bot && this.state.connected && this.state.spawned;
  }
}

module.exports = BotCore;
