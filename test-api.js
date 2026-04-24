/**
 * test-api.js — Manual API tester for ClawCraft-bot
 * Run: node test-api.js
 */

const http = require('http');

const BASE = 'http://127.0.0.1:3001';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function post(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: '127.0.0.1', port: 3001,
      path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(label, result) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: ' + label);
  console.log('Status HTTP:', result.status);
  console.log(JSON.stringify(result.body, null, 2));
}

async function pollJob(jobId, label, maxAttempts = 8) {
  console.log(`\n--- Polling job ${jobId} (${label}) ---`);
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(1000);
    const r = await get(`/jobs/${jobId}`);
    const s = r.body?.data?.status;
    console.log(`  Attempt ${i}: status=${s}, error=${r.body?.data?.error || 'null'}, result=${JSON.stringify(r.body?.data?.result)}`);
    if (s === 'done' || s === 'failed' || s === 'cancelled') {
      console.log('  => Terminal state reached:', s);
      return r.body?.data;
    }
  }
  console.log('  => Max attempts reached, still not terminal');
}

async function main() {
  console.log('ClawCraft-bot API Test Suite');
  console.log('Base URL:', BASE);
  console.log('='.repeat(60));

  // TEST 1: Health
  log('GET /health', await get('/health'));
  await sleep(500);

  // TEST 2: Status
  log('GET /status', await get('/status'));
  await sleep(500);

  // TEST 3: Inventory
  log('GET /inventory', await get('/inventory'));
  await sleep(500);

  // TEST 4: Nearby entities
  log('GET /nearby?radius=16', await get('/nearby?radius=16'));
  await sleep(500);

  // TEST 5: Find block
  log('GET /findblock?name=oak_log', await get('/findblock?name=oak_log'));
  await sleep(500);

  // TEST 6: Consume WITHOUT equip first (expected: fail or error in job)
  console.log('\n' + '='.repeat(60));
  console.log('TEST: POST /actions/consume (NO equip first) — expect error in job');
  const consumeR = await post('/actions/consume', {});
  console.log('HTTP Status:', consumeR.status);
  console.log(JSON.stringify(consumeR.body, null, 2));
  if (consumeR.body?.data?.jobId) {
    await pollJob(consumeR.body.data.jobId, 'consume-no-equip');
  }
  await sleep(500);

  // TEST 7: Chat (test job polling cycle)
  console.log('\n' + '='.repeat(60));
  console.log('TEST: POST /actions/chat — test job polling cycle');
  const chatR = await post('/actions/chat', { message: 'API test ping' });
  console.log('HTTP Status:', chatR.status);
  console.log(JSON.stringify(chatR.body, null, 2));
  if (chatR.body?.data?.jobId) {
    await pollJob(chatR.body.data.jobId, 'chat');
  }
  await sleep(500);

  // TEST 8: Unknown block name
  log('GET /findblock?name=INVALID_BLOCK_XYZ', await get('/findblock?name=INVALID_BLOCK_XYZ'));
  await sleep(500);

  // TEST 9: 404 unknown endpoint
  log('GET /actions/nonexistent (expect 404)', await get('/actions/nonexistent'));
  await sleep(500);

  // TEST 10: goto with missing params
  console.log('\n' + '='.repeat(60));
  console.log('TEST: POST /actions/goto missing params — expect 400');
  const gotoR = await post('/actions/goto', { x: 100 }); // missing y, z
  console.log('HTTP Status:', gotoR.status);
  console.log(JSON.stringify(gotoR.body, null, 2));
  await sleep(500);

  // TEST 11: Health again — check queue state
  log('GET /health (final — check queue state)', await get('/health'));

  console.log('\n' + '='.repeat(60));
  console.log('ALL TESTS DONE');
}

main().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
