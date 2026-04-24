/**
 * test-protect.js — Test: protect the nearest player indefinitely
 * Press Ctrl+C to stop protection and cancel the job.
 * Run: node test-protect.js
 */

const http = require('http');
const BASE = 'http://127.0.0.1:3001';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function post(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: '127.0.0.1', port: 3001, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let protectJobId = null;
let stopRequested = false;

// Ctrl+C handler — send /actions/stop then exit cleanly
process.on('SIGINT', async () => {
  console.log('\n\n[Ctrl+C] Stopping protection...');
  stopRequested = true;
  try {
    const r = await post('/actions/stop', {});
    console.log('[Stop] Response:', JSON.stringify(r.body));
  } catch (e) {
    console.error('[Stop] Error:', e.message);
  }
  // Wait a moment and check final job status
  if (protectJobId) {
    await sleep(1000);
    try {
      const r = await get(`/jobs/${protectJobId}`);
      const d = r.body?.data;
      console.log(`[Final job status] status=${d?.status}, result=${JSON.stringify(d?.result)}`);
    } catch (e) { }
  }
  console.log('Protection ended. Exiting.');
  process.exit(0);
});

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  TEST: Protect nearest player (indefinite)');
  console.log('  Press Ctrl+C to stop at any time');
  console.log('══════════════════════════════════════════════════════════\n');

  // 1. Health check
  const health = await get('/health');
  const botState = health.body?.data?.botState;
  console.log(`[Health] spawned=${botState?.spawned}, connected=${botState?.connected}`);
  if (!botState?.spawned) {
    console.error('Bot is not spawned. Exiting.');
    process.exit(1);
  }

  await sleep(500);

  // 2. Get nearby entities to find a player
  console.log('\n[Nearby] Scanning for players...');
  const nearby = await get('/nearby?radius=32');
  const entities = nearby.body?.data?.entities || [];

  const players = entities.filter(e => e.type === 'player');

  if (players.length === 0) {
    console.error('No players found within 32 blocks. Move a player closer to the bot and retry.');
    process.exit(1);
  }

  console.log(`[Nearby] Found ${players.length} player(s):`);
  players.forEach(p => console.log(`  - "${p.name}" at distance=${p.distance}, pos=(${p.position.x}, ${p.position.y}, ${p.position.z})`));

  const target = players[0];
  console.log(`\n[Protect] Target player: "${target.name}" (distance: ${target.distance})`);

  await sleep(500);

  // 3. Start protection
  console.log(`[Protect] Starting protection of "${target.name}"...`);
  const r = await post('/actions/protect', { player: target.name });

  if (!r.body?.ok) {
    console.error('[Protect] Failed to start:', r.body?.error);
    process.exit(1);
  }

  protectJobId = r.body.data?.jobId;
  console.log(`[Protect] ✅ Protection active. Job ID: ${protectJobId}`);
  console.log('[Protect] Bot will now follow and defend the player.');
  console.log('[Protect] Press Ctrl+C to stop.\n');

  // 4. Monitor loop — poll status every 5 seconds
  let tick = 0;
  while (!stopRequested) {
    await sleep(5000);
    if (stopRequested) break;

    tick++;
    try {
      // Check job status
      const jobR = await get(`/jobs/${protectJobId}`);
      const job = jobR.body?.data;

      // Check bot status
      const statusR = await get('/status');
      const s = statusR.body?.data;

      // Check nearby threats
      const nearbyR = await get('/nearby?radius=16');
      const ents = nearbyR.body?.data?.entities || [];
      const mobs = ents.filter(e => e.type === 'mob' || e.type === 'hostile');

      const timeOfDay = s?.time?.timeOfDay;
      const isNight = timeOfDay > 13000 && timeOfDay < 23000;

      console.log(`[Monitor #${tick}] job=${job?.status} | health=${s?.health}/20 food=${s?.food}/20 | time=${timeOfDay} (${isNight ? '🌙 NIGHT' : '☀️ day'}) | nearby mobs=${mobs.length}`);

      if (mobs.length > 0) {
        console.log(`  ⚔️  Mobs nearby: ${mobs.map(m => `${m.name}(${m.distance}m)`).join(', ')}`);
      }

      // If job reached terminal state (shouldn't happen unless error)
      if (job?.status === 'done' || job?.status === 'failed' || job?.status === 'cancelled') {
        console.log(`\n[Monitor] Job reached terminal state: ${job.status}`);
        if (job.error) console.log(`  Error: ${job.error}`);
        if (job.result) console.log(`  Result: ${JSON.stringify(job.result)}`);
        break;
      }
    } catch (e) {
      console.error(`[Monitor] Error: ${e.message}`);
    }
  }

  if (!stopRequested) {
    console.log('\nProtection ended (job completed). Exiting.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
