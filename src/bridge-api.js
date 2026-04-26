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

  // --- Middleware: optional API key authentication ---
  if (config.bridge.apiKey) {
    app.use((req, res, next) => {
      // Allow /health without auth for monitoring
      if (req.path === '/health') return next();
      const key = req.headers['x-api-key'];
      if (key !== config.bridge.apiKey) {
        return res.status(401).json({ ok: false, error: 'Invalid or missing x-api-key' });
      }
      next();
    });
    console.log('[Bridge API] 🔑 API key authentication enabled');
  }

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

  // --- Helper for read-only calls (async-safe) ---
  function safeCall(fn) {
    return async (req, res) => {
      try {
        const result = await fn(req);
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

  // --- Validation Helpers (from shared module) ---
  const {
    parseRequiredNumber,
    parseOptionalNumber,
    parsePositiveInt,
    parseNonNegativeInt,
  } = require('./validation');

  // =====================================================
  // Route Registry (Single Source of Truth)
  // =====================================================
  const apiDocs = {};

  function reg(method, path, category, paramsDesc, handler, isPublic = false) {
    if (!apiDocs[category]) apiDocs[category] = [];
    apiDocs[category].push(`${method} ${path}${paramsDesc ? '        ' + paramsDesc : ''}`.trim());
    
    const middlewares = isPublic ? [] : [requireBot];
    if (method === 'GET') app.get(path, ...middlewares, handler);
    else if (method === 'POST') app.post(path, ...middlewares, handler);
  }

  // Health (always available)
  reg('GET', '/health', 'read_only', '', (req, res) => {
    res.json({
      ok: true,
      data: {
        uptime: Math.round(process.uptime()),
        botState: botCore.state,
        queue: jobQueue.summary(),
      },
    });
  }, true);

  // Read-only endpoints
  reg('GET', '/status', 'read_only', '', safeCall(() => actions.readOnlyActions.status()));
  reg('GET', '/position', 'read_only', '', safeCall(() => actions.readOnlyActions.position()));
  reg('GET', '/inventory', 'read_only', '', safeCall(() => actions.readOnlyActions.inventory()));
  
  reg('GET', '/nearby', 'read_only', '[?radius=32]', safeCall((req) => {
    return actions.readOnlyActions.nearby({ radius: parsePositiveInt(req.query.radius) });
  }));

  reg('GET', '/scan-blocks', 'read_only', '[?radius=8]', safeCall((req) => {
    return actions.readOnlyActions.scan({ radius: parsePositiveInt(req.query.radius) });
  }));

  reg('GET', '/findblock', 'read_only', '?name=oak_log[&maxDistance=32&count=1]', safeCall((req) => {
    return actions.readOnlyActions.findBlock({
      name: req.query.name,
      maxDistance: parsePositiveInt(req.query.maxDistance),
      count: parsePositiveInt(req.query.count),
    });
  }));

  // Navigation
  reg('POST', '/actions/goto', 'navigation', '{ x, y, z }', enqueueAction('goto', (req) => ({
    x: parseRequiredNumber(req.body.x, 'x'),
    y: parseRequiredNumber(req.body.y, 'y'),
    z: parseRequiredNumber(req.body.z, 'z'),
  })));

  reg('POST', '/actions/follow', 'navigation', '{ player, distance? }', enqueueAction('follow', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    return { player: req.body.player, distance: parseOptionalNumber(req.body.distance) };
  }));

  reg('POST', '/actions/stop', 'navigation', '', async (req, res) => {
    try {
      jobQueue.cancelAll();
      const result = await actions.immediateActions.stop();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Chat
  reg('POST', '/actions/chat', 'chat', '{ message }', enqueueAction('chat', (req) => {
    if (!req.body.message) throw new Error('Required: message');
    return { message: req.body.message };
  }));

  reg('POST', '/actions/whisper', 'chat', '{ player, message }', enqueueAction('whisper', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    if (!req.body.message) throw new Error('Required: message');
    return { player: req.body.player, message: req.body.message };
  }));

  // Combat
  reg('POST', '/actions/attack', 'combat', '{ name?, id? }', enqueueAction('attack', (req) => {
    if (!req.body.name && req.body.id === undefined) throw new Error('Required: name or id');
    return { name: req.body.name, id: parsePositiveInt(req.body.id) };
  }));

  reg('POST', '/actions/protect', 'combat', '{ player, radius? }', enqueueAction('protect', (req) => {
    if (!req.body.player) throw new Error('Required: player');
    return { player: req.body.player, radius: parseOptionalNumber(req.body.radius, 10) };
  }));

  // World
  reg('POST', '/actions/dig', 'world', '{ name } or { x, y, z }', enqueueAction('digBlock', (req) => {
    const p = { name: req.body.name, maxDistance: parsePositiveInt(req.body.maxDistance) };
    if (req.body.x !== undefined) p.x = parseRequiredNumber(req.body.x, 'x');
    if (req.body.y !== undefined) p.y = parseRequiredNumber(req.body.y, 'y');
    if (req.body.z !== undefined) p.z = parseRequiredNumber(req.body.z, 'z');
    return p;
  }));

  reg('POST', '/actions/collect', 'world', '{ name, count?, maxDistance? }', enqueueAction('collectBlock', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return { name: req.body.name, count: parsePositiveInt(req.body.count), maxDistance: parsePositiveInt(req.body.maxDistance) };
  }));

  reg('POST', '/actions/activate-block', 'world', '{ x, y, z }', enqueueAction('activateBlock', (req) => ({
    x: parseRequiredNumber(req.body.x, 'x'),
    y: parseRequiredNumber(req.body.y, 'y'),
    z: parseRequiredNumber(req.body.z, 'z'),
  })));

  reg('POST', '/actions/place-block', 'world', '{ x, y, z, name }', enqueueAction('placeBlock', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return {
      name: req.body.name,
      x: parseRequiredNumber(req.body.x, 'x'),
      y: parseRequiredNumber(req.body.y, 'y'),
      z: parseRequiredNumber(req.body.z, 'z'),
    };
  }));

  reg('POST', '/actions/build-house', 'world', '{ material? }', enqueueAction('buildHouse', (req) => ({
    material: req.body.material || 'oak_planks',
  })));

  // Items
  reg('POST', '/actions/equip', 'items', '{ name, destination? }', enqueueAction('equipItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return { name: req.body.name, destination: req.body.destination || 'hand' };
  }));

  reg('POST', '/actions/unequip', 'items', '{ destination }', enqueueAction('unequipItem', (req) => {
    if (!req.body.destination) throw new Error('Required: destination');
    return { destination: req.body.destination };
  }));

  reg('POST', '/actions/craft', 'items', '{ name, count?, useCraftingTable? }', enqueueAction('craftItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return { name: req.body.name, count: parsePositiveInt(req.body.count, 1), useCraftingTable: req.body.useCraftingTable === true };
  }));

  reg('POST', '/actions/consume', 'items', '', enqueueAction('consume', () => ({})));

  reg('POST', '/actions/toss', 'items', '{ name, count? }', enqueueAction('tossItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return { name: req.body.name, count: parsePositiveInt(req.body.count, 1) };
  }));

  reg('POST', '/actions/hotbar', 'items', '{ slot }', enqueueAction('setHotbarSlot', (req) => {
    const slot = parseNonNegativeInt(req.body.slot);
    if (slot === undefined || slot > 8) throw new Error('Invalid slot: must be 0-8');
    return { slot };
  }));

  reg('POST', '/actions/creative', 'items', '{ name, count?, slot? }', enqueueAction('creativeItem', (req) => {
    if (!req.body.name) throw new Error('Required: name');
    return { name: req.body.name, count: parsePositiveInt(req.body.count, 1), slot: parsePositiveInt(req.body.slot, 36) };
  }));

  // Jobs
  reg('GET', '/jobs/:id', 'jobs', '', (req, res) => {
    const job = jobQueue.getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    res.json({ ok: true, data: job });
  }, true);

  // =====================================================
  // List of all endpoints (help)
  // =====================================================
  app.get('/', (req, res) => {
    res.json({
      ok: true,
      data: apiDocs,
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
