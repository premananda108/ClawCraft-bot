/**
 * bridge-api.js — Layer 4: Express HTTP API
 *
 * Bind to 127.0.0.1 ONLY — do not expose to the network.
 * All responses: { ok: bool, data?, error? }
 */
const path = require('path');
const express = require('express');

/**
 * Create and launch bridge API
 */
function createBridgeAPI({ config, botCore, jobQueue, actions }) {
  const app = express();
  app.use(express.json());

  // --- Middleware: check if bot is connected ---
  function requireBot(req, res, next) {
    if (!botCore.isReady()) {
      return res.status(503).json({
        ok: false,
        error: 'Bot is not connected or not spawned yet',
        state: botCore.state,
      });
    }
    next();
  }

  // --- Helper for read-only calls ---
  function safeCall(fn) {
    return (req, res) => {
      try {
        const result = fn(req);
        res.json({ ok: true, data: result });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    };
  }

  // --- Helper for queued actions ---
  function enqueueAction(actionName, paramsExtractor) {
    return (req, res) => {
      try {
        const params = paramsExtractor ? paramsExtractor(req) : req.body;
        const fn = actions.queuedActions[actionName];
        if (!fn) return res.status(404).json({ ok: false, error: `Action "${actionName}" not found` });

        const { jobId } = jobQueue.enqueue(actionName, params, fn);
        res.json({ ok: true, data: { jobId, action: actionName, params } });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    };
  }

  // --- Validation Helpers ---
  function parseRequiredNumber(val, name) {
    if (val === undefined || val === null) throw new Error(`Required: ${name}`);
    const num = Number(val);
    if (Number.isNaN(num)) throw new Error(`Invalid number: ${name}`);
    return num;
  }

  function parseOptionalNumber(val, defaultVal = undefined) {
    if (val === undefined || val === null) return defaultVal;
    const num = Number(val);
    if (Number.isNaN(num)) return defaultVal;
    return num;
  }

  function parsePositiveInt(val, defaultVal = undefined) {
    if (val === undefined || val === null) return defaultVal;
    const num = parseInt(val, 10);
    if (Number.isNaN(num) || num <= 0) return defaultVal;
    return num;
  }

  function parseNonNegativeInt(val, defaultVal = undefined) {
    if (val === undefined || val === null) return defaultVal;
    const num = parseInt(val, 10);
    if (Number.isNaN(num) || num < 0) return defaultVal;
    return num;
  }

  // =====================================================
  // Health (always available)
  // =====================================================
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      data: {
        uptime: Math.round(process.uptime()),
        botState: botCore.state,
        queue: jobQueue.summary(),
      },
    });
  });

  // =====================================================
  // Read-only endpoints (bypass queue)
  // =====================================================
  app.get('/status', requireBot, safeCall(() => actions.readOnlyActions.status()));

  app.get('/position', requireBot, safeCall(() => actions.readOnlyActions.position()));

  app.get('/inventory', requireBot, safeCall(() => actions.readOnlyActions.inventory()));

  app.get('/nearby', requireBot, safeCall((req) => {
    return actions.readOnlyActions.nearby({
      radius: parsePositiveInt(req.query.radius),
    });
  }));

  app.get('/scan-blocks', requireBot, safeCall((req) => {
    return actions.readOnlyActions.scan({
      radius: parsePositiveInt(req.query.radius),
    });
  }));

  app.get('/findblock', requireBot, safeCall((req) => {
    return actions.readOnlyActions.findBlock({
      name: req.query.name,
      maxDistance: parsePositiveInt(req.query.maxDistance),
      count: parsePositiveInt(req.query.count),
    });
  }));

  // =====================================================
  // Navigation (queued)
  // =====================================================
  app.post('/actions/goto', requireBot, enqueueAction('goto', (req) => ({
    x: parseRequiredNumber(req.body.x, 'x'),
    y: parseRequiredNumber(req.body.y, 'y'),
    z: parseRequiredNumber(req.body.z, 'z'),
  })));

  app.post('/actions/follow', requireBot, enqueueAction('follow', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    return {
      player: req.body.player,
      distance: parseOptionalNumber(req.body.distance),
    };
  }));

  // =====================================================
  // Chat (queued)
  // =====================================================
  app.post('/actions/chat', requireBot, enqueueAction('chat', (req) => {
    if (!req.body.message) throw new Error('Required: message');
    return { message: req.body.message };
  }));

  app.post('/actions/whisper', requireBot, enqueueAction('whisper', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    if (!req.body.message) throw new Error('Required: message');
    return { player: req.body.player, message: req.body.message };
  }));

  // =====================================================
  // Combat (queued)
  // =====================================================
  app.post('/actions/attack', requireBot, enqueueAction('attack', (req) => {
    if (!req.body.name && req.body.id === undefined) throw new Error('Required: name or id');
    return {
      name: req.body.name,
      id: parsePositiveInt(req.body.id),
    };
  }));

  app.post('/actions/protect', requireBot, enqueueAction('protect', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    return {
      player: req.body.player,
      radius: parseOptionalNumber(req.body.radius, 10),
    };
  }));

  // =====================================================
  // World (queued)
  // =====================================================
  app.post('/actions/dig', requireBot, enqueueAction('digBlock', (req) => {
    const p = { name: req.body.name, maxDistance: parsePositiveInt(req.body.maxDistance) };
    if (req.body.x !== undefined) p.x = parseRequiredNumber(req.body.x, 'x');
    if (req.body.y !== undefined) p.y = parseRequiredNumber(req.body.y, 'y');
    if (req.body.z !== undefined) p.z = parseRequiredNumber(req.body.z, 'z');
    return p;
  }));

  app.post('/actions/collect', requireBot, enqueueAction('collectBlock', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      count: parsePositiveInt(req.body.count),
      maxDistance: parsePositiveInt(req.body.maxDistance),
    };
  }));

  app.post('/actions/activate-block', requireBot, enqueueAction('activateBlock', (req) => ({
    x: parseRequiredNumber(req.body.x, 'x'),
    y: parseRequiredNumber(req.body.y, 'y'),
    z: parseRequiredNumber(req.body.z, 'z'),
  })));

  app.post('/actions/place-block', requireBot, enqueueAction('placeBlock', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      x: parseRequiredNumber(req.body.x, 'x'),
      y: parseRequiredNumber(req.body.y, 'y'),
      z: parseRequiredNumber(req.body.z, 'z'),
    };
  }));

  // =====================================================
  // Items (queued)
  // =====================================================
  app.post('/actions/equip', requireBot, enqueueAction('equipItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      destination: req.body.destination || 'hand',
    };
  }));

  app.post('/actions/unequip', requireBot, enqueueAction('unequipItem', (req) => {
    if (!req.body.destination) throw new Error('Required: destination');
    return {
      destination: req.body.destination,
    };
  }));

  app.post('/actions/craft', requireBot, enqueueAction('craftItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      count: parsePositiveInt(req.body.count, 1),
      useCraftingTable: req.body.useCraftingTable === true,
    };
  }));

  app.post('/actions/consume', requireBot, enqueueAction('consume', () => ({})));

  app.post('/actions/toss', requireBot, enqueueAction('tossItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      count: parsePositiveInt(req.body.count, 1),
    };
  }));

  app.post('/actions/hotbar', requireBot, enqueueAction('setHotbarSlot', (req) => {
    const slot = parseNonNegativeInt(req.body.slot);
    if (slot === undefined || slot > 8) throw new Error('Invalid slot: must be 0-8');
    return { slot };
  }));

  app.post('/actions/creative', requireBot, enqueueAction('creativeItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      count: parsePositiveInt(req.body.count, 1),
      slot: parsePositiveInt(req.body.slot, 36),
    };
  }));

  // =====================================================
  // Stop (immediate, bypass queue)
  // =====================================================
  app.post('/actions/stop', requireBot, async (req, res) => {
    try {
      jobQueue.cancelAll();
      const result = await actions.immediateActions.stop();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =====================================================
  // Job status
  // =====================================================
  app.get('/jobs/:id', (req, res) => {
    const job = jobQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    res.json({ ok: true, data: job });
  });

  // =====================================================
  // List of all endpoints (help)
  // =====================================================
  app.get('/', (req, res) => {
    res.json({
      ok: true,
      data: {
        read_only: [
          'GET /health',
          'GET /status',
          'GET /position',
          'GET /inventory',
          'GET /nearby[?radius=32]',
          'GET /scan-blocks[?radius=8]',
          'GET /findblock?name=oak_log[&maxDistance=32&count=1]',
        ],
        navigation: [
          'POST /actions/goto        { x, y, z }',
          'POST /actions/follow      { player, distance? }',
          'POST /actions/stop',
        ],
        chat: [
          'POST /actions/chat        { message }',
          'POST /actions/whisper     { player, message }',
        ],
        combat: [
          'POST /actions/attack      { name?, id? }',
          'POST /actions/protect     { player }',
        ],
        world: [
          'POST /actions/dig         { name } or { x, y, z }',
          'POST /actions/collect     { name, count?, maxDistance? }',
          'POST /actions/activate-block { x, y, z }',
          'POST /actions/place-block    { x, y, z, name }',
        ],
        items: [
          'POST /actions/equip       { name, destination? }',
          'POST /actions/unequip     { destination }',
          'POST /actions/craft       { name, count?, useCraftingTable? }',
          'POST /actions/consume',
          'POST /actions/toss        { name, count? }',
          'POST /actions/hotbar      { slot }',
        ],
        jobs: [
          'GET /jobs/:id',
        ],
      },
    });
  });

  // 404 fallback
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: `Unknown endpoint: ${req.method} ${req.path}`,
      hint: 'GET / for all available endpoints',
    });
  });

  // Global error handler — prevents stack trace leaks
  app.use((err, req, res, _next) => {
    console.error(`[Bridge API] Unhandled error on ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  // Launch server
  return new Promise((resolve) => {
    const server = app.listen(config.bridge.port, config.bridge.host, () => {
      console.log(`[Bridge API] 🌐 http://${config.bridge.host}:${config.bridge.port}`);
      console.log(`[Bridge API] GET / — list of all endpoints`);
      resolve(server);
    });
  });
}

module.exports = { createBridgeAPI };
