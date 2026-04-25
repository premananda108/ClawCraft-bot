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
    const radius = req.query.radius ? parseInt(req.query.radius, 10) : undefined;
    return actions.readOnlyActions.nearby({ radius });
  }));

  app.get('/scan-blocks', requireBot, safeCall((req) => {
    const radius = req.query.radius ? parseInt(req.query.radius, 10) : undefined;
    return actions.readOnlyActions.scan({ radius });
  }));

  app.get('/findblock', requireBot, safeCall((req) => {
    const { name, maxDistance, count } = req.query;
    return actions.readOnlyActions.findBlock({
      name,
      maxDistance: maxDistance ? parseInt(maxDistance, 10) : undefined,
      count: count ? parseInt(count, 10) : undefined,
    });
  }));

  // =====================================================
  // Navigation (queued)
  // =====================================================
  app.post('/actions/goto', requireBot, (req, res) => {
    const { x, y, z } = req.body;
    if (x === undefined || y === undefined || z === undefined) {
      return res.status(400).json({ ok: false, error: 'Required: x, y, z' });
    }
    const { jobId } = jobQueue.enqueue('goto', { x, y, z }, actions.queuedActions.goto);
    res.json({ ok: true, data: { jobId, action: 'goto', params: { x, y, z } } });
  });

  app.post('/actions/follow', requireBot, (req, res) => {
    const { player, distance } = req.body;
    if (!player) return res.status(400).json({ ok: false, error: 'Required: player' });
    const { jobId } = jobQueue.enqueue('follow', { player, distance }, actions.queuedActions.follow);
    res.json({ ok: true, data: { jobId, action: 'follow', params: { player, distance } } });
  });

  // =====================================================
  // Chat (queued)
  // =====================================================
  app.post('/actions/chat', requireBot, (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: 'Required: message' });
    const { jobId } = jobQueue.enqueue('chat', { message }, actions.queuedActions.chat);
    res.json({ ok: true, data: { jobId, action: 'chat', params: { message } } });
  });

  app.post('/actions/whisper', requireBot, (req, res) => {
    const { player, message } = req.body;
    if (!player) return res.status(400).json({ ok: false, error: 'Required: player' });
    if (!message) return res.status(400).json({ ok: false, error: 'Required: message' });
    const { jobId } = jobQueue.enqueue('whisper', { player, message }, actions.queuedActions.whisper);
    res.json({ ok: true, data: { jobId, action: 'whisper', params: { player, message } } });
  });

  // =====================================================
  // Combat (queued)
  // =====================================================
  app.post('/actions/attack', requireBot, enqueueAction('attack'));

  app.post('/actions/protect', requireBot, enqueueAction('protect'));

  // =====================================================
  // World (queued)
  // =====================================================
  app.post('/actions/dig', requireBot, enqueueAction('digBlock'));

  app.post('/actions/collect', requireBot, enqueueAction('collectBlock'));

  app.post('/actions/activate-block', requireBot, enqueueAction('activateBlock'));

  app.post('/actions/place-block', requireBot, enqueueAction('placeBlock'));

  // =====================================================
  // Items (queued)
  // =====================================================
  app.post('/actions/equip', requireBot, enqueueAction('equipItem'));

  app.post('/actions/unequip', requireBot, enqueueAction('unequipItem'));

  app.post('/actions/craft', requireBot, enqueueAction('craftItem'));

  app.post('/actions/consume', requireBot, enqueueAction('consume'));

  app.post('/actions/toss', requireBot, enqueueAction('tossItem'));

  app.post('/actions/hotbar', requireBot, enqueueAction('setHotbarSlot'));

  app.post('/actions/creative', requireBot, enqueueAction('creativeItem'));

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
          'POST /actions/place-block    { x, y, z, face? }',
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
