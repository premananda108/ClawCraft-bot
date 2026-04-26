/**
 * safety-manager.js — Layer 3.5: Reactive behaviors and instincts
 */

class SafetyManager {
  /**
   * @param {import('mineflayer').Bot} bot
   * @param {import('./job-queue')} jobQueue
   * @param {object} actions - initialized actions
   */
  constructor(bot, jobQueue, actions) {
    this.bot = bot;
    this.jobQueue = jobQueue;
    this.actions = actions;
    this._panicMode = false;
    this._lastAttackerId = null;
  }

  /**
   * Start monitoring instincts
   */
  start() {
    console.log('[Safety] 🛡️  Safety Manager started (Instincts active)');

    // 1. Monitor health for Panic Mode
    this.bot.on('health', () => this._checkHealth());

    // 2. Monitor damage for Retaliation
    // Note: 'entityHurt' triggers when any entity takes damage. We check if it's the bot.
    this.bot.on('entityHurt', (entity) => {
      if (entity === this.bot.entity) {
        this._handleBotHurt();
      }
    });

    // 3. Optional: Auto-eat if hungry and holding food
    this.bot.on('health', () => this._autoEat());
  }

  /**
   * Instinct: Panic and Retreat when low health
   */
  async _checkHealth() {
    if (this.bot.health <= 6 && !this._panicMode && this.bot.health > 0) {
      this._panicMode = true;
      console.log(`[Safety] 😱 PANIC! Low health: ${this.bot.health}. Retreating!`);
      
      // Stop current task immediately
      this.jobQueue.cancelAll();
      this.bot.chat("I'm badly hurt! I need to retreat!");

      const enemy = this.bot.nearestEntity(e => (e.type === 'mob' || e.type === 'player') && e !== this.bot.entity);
      
      let direction;
      if (enemy) {
        direction = this.bot.entity.position.minus(enemy.position).normalize();
      } else {
        // Calculate forward vector from yaw/pitch if no enemy
        const yaw = this.bot.entity.yaw;
        const pitch = this.bot.entity.pitch;
        const Vec3 = require('vec3');
        direction = new Vec3(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch)
        ).normalize();
      }
        
      const retreatPos = this.bot.entity.position.plus(direction.scaled(10)).floored();
      
      // We use the bridge action directly to ensure it goes through JobQueue logic
      this.actions.queuedActions.goto({ 
        x: retreatPos.x, 
        y: retreatPos.y, 
        z: retreatPos.z 
      }).catch(err => console.warn(`[Safety] Retreat failed: ${err.message}`));
      
      // Reset panic after 10 seconds or when healed
      setTimeout(() => { this._panicMode = false; }, 10000);
    }
  }

  /**
   * Instinct: Defend back if attacked
   */
  async _handleBotHurt() {
    if (this._panicMode) return; // Panic takes priority over revenge

    // Try to find who attacked us. Mineflayer doesn't always provide the attacker directly in entityHurt.
    // We look for the nearest hostile entity looking at us or very close.
    const attacker = this.bot.nearestEntity(e => {
      if (e.type !== 'mob' && e.type !== 'player') return false;
      if (e === this.bot.entity) return false;
      return e.position.distanceTo(this.bot.entity.position) < 5;
    });

    if (attacker && this.bot.health > 6) {
      if (this.jobQueue.isBusy()) {
        const currentJob = this.jobQueue.currentJob;
        // Only interrupt non-combat tasks (like digging or building)
        if (!['attack', 'protect'].includes(currentJob.action)) {
          console.log(`[Safety] ⚔️  Interrupted ${currentJob.action} to defend against ${attacker.name || attacker.username}`);
          this.jobQueue.cancelAll();
          this.actions.queuedActions.attack({ id: attacker.id });
        }
      } else {
        console.log(`[Safety] ⚔️  Auto-defending against ${attacker.name || attacker.username}`);
        this.actions.queuedActions.attack({ id: attacker.id });
      }
    }
  }

  /**
   * Instinct: Auto-eat if holding food and hungry
   */
  async _autoEat() {
    if (this.bot.food < 14 && this.bot.heldItem && !this.jobQueue.isBusy()) {
      // Basic check if item is food (this is a simple heuristic)
      const foodItems = ['apple', 'bread', 'cooked_beef', 'cooked_chicken', 'carrot', 'potato'];
      if (foodItems.some(f => this.bot.heldItem.name.includes(f))) {
        console.log(`[Safety] 🍖 Hungry (${this.bot.food}). Auto-eating ${this.bot.heldItem.name}`);
        this.actions.queuedActions.consume();
      }
    }
  }
}

module.exports = SafetyManager;
