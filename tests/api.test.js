/**
 * tests/api.test.js — Integration tests for Bridge API
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const JobQueue = require('../src/job-queue');
const { createBridgeAPI } = require('../src/bridge-api');

// Helper: Start a test server with mocks
async function startTestServer(overrides = {}) {
  const config = {
    bridge: { host: '127.0.0.1', port: 0, apiKey: overrides.apiKey || '' },
    mc: { username: 'TestBot' },
    ...overrides.config
  };

  const botCore = {
    isReady: () => overrides.ready !== false,
    state: { connected: true, spawned: true },
    bot: {
      health: 20, food: 20, experience: { level: 0 },
      entity: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      inventory: { items: () => [] },
      time: { timeOfDay: 1000 }
    },
    ...overrides.botCore
  };

  const jobQueue = new JobQueue();
  
  const actions = {
    queuedActions: {
      chat: async (params) => ({ sent: true, message: params.message })
    },
    readOnlyActions: {
      status: () => ({ health: 20 })
    },
    ...overrides.actions
  };

  const server = await createBridgeAPI({ config, botCore, jobQueue, actions });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return { server, baseUrl, jobQueue, config };
}

// Suppress logs during tests
const origLog = console.log;
const origErr = console.error;
function silence() { console.log = () => {}; console.error = () => {}; }
function restore() { console.log = origLog; console.error = origErr; }

describe('Bridge API — Integration', () => {
  let testEnv;

  beforeEach(() => silence());
  afterEach(async () => {
    if (testEnv) {
      if (testEnv.server) {
        if (typeof testEnv.server.closeAllConnections === 'function') {
          testEnv.server.closeAllConnections();
        }
        await new Promise(r => testEnv.server.close(r));
      }
      if (testEnv.jobQueue) {
        testEnv.jobQueue.destroy();
      }
    }
    restore();
  });

  it('GET /health — returns 200 and reflects bot state', async () => {
    // 1. Ready
    testEnv = await startTestServer({ ready: true });
    const res1 = await fetch(`${testEnv.baseUrl}/health`);
    const body1 = await res1.json();
    assert.equal(res1.status, 200);
    assert.equal(body1.data.botState.spawned, true);

    // 2. Not ready (but still returns 200 for health check)
    await new Promise(r => testEnv.server.close(r));
    testEnv = await startTestServer({ ready: false, botCore: { state: { spawned: false } } });
    const res2 = await fetch(`${testEnv.baseUrl}/health`);
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.data.botState.spawned, false);
  });

  it('POST /actions/chat — enqueues a job', async () => {
    testEnv = await startTestServer();
    const res = await fetch(`${testEnv.baseUrl}/actions/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello unit tests' })
    });
    const body = await res.json();

    if (res.status !== 200) {
      restore();
      console.error('API Error body:', body);
      silence();
    }

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data.jobId);
    
    // Verify job exists in queue
    const job = testEnv.jobQueue.getJob(body.data.jobId);
    assert.equal(job.action, 'chat');
    assert.equal(job.params.message, 'Hello unit tests');
  });

  it('API Key — blocks unauthorized requests when enabled', async () => {
    testEnv = await startTestServer({ apiKey: 'secret123' });
    
    // 1. Without key
    const res1 = await fetch(`${testEnv.baseUrl}/status`);
    assert.equal(res1.status, 401);

    // 2. With wrong key
    const res2 = await fetch(`${testEnv.baseUrl}/status`, {
      headers: { 'x-api-key': 'wrong' }
    });
    assert.equal(res2.status, 401);

    // 3. With correct key
    const res3 = await fetch(`${testEnv.baseUrl}/status`, {
      headers: { 'x-api-key': 'secret123' }
    });
    
    if (res3.status !== 200) {
      restore();
      const body = await res3.json();
      console.error('API Key Success check failed. Status:', res3.status, 'Body:', body);
      silence();
    }

    assert.equal(res3.status, 200);
    const body3 = await res3.json();
    assert.equal(body3.ok, true);
  });

  it('API Key — allows /health without key for monitoring', async () => {
    testEnv = await startTestServer({ apiKey: 'secret123' });
    const res = await fetch(`${testEnv.baseUrl}/health`);
    assert.equal(res.status, 200);
  });

  it('404 Handling — returns custom error for unknown routes', async () => {
    testEnv = await startTestServer();
    const res = await fetch(`${testEnv.baseUrl}/something-weird`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
    assert.match(body.error, /Unknown endpoint/);
  });
});
