/**
 * test-attack.js — Test: attack ALL nearby entities (mobs, animals, and PLAYERS)
 * The bot will scan for nearby entities, attack each in turn, then re-scan.
 * Stops when no targets remain or Ctrl+C is pressed.
 * Run: node test-attack.js
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

let stopRequested = false;

process.on('SIGINT', async () => {
  console.log('\n\n[Ctrl+C] Stopping all attacks...');
  stopRequested = true;
  try {
    await post('/actions/stop', {});
    console.log('[Stop] Bot stopped.');
  } catch (e) { }
  process.exit(0);
});

async function pollJob(jobId, label, maxAttempts = 30) {
  console.log(`  ⏳ Polling [${label}] (${jobId.slice(0, 8)}...)...`);
  for (let i = 1; i <= maxAttempts; i++) {
    if (stopRequested) return null;
    await sleep(1000);
    const r = await get(`/jobs/${jobId}`);
    const job = r.body?.data;
    const s = job?.status;
    if (s === 'done') {
      console.log(`  ✅ done: ${JSON.stringify(job.result)}`);
      return job;
    }
    if (s === 'failed') {
      console.log(`  ❌ failed: ${job.error}`);
      return job;
    }
    if (s === 'cancelled') {
      console.log(`  ⏹️  cancelled`);
      return job;
    }
    process.stdout.write(`  [${i}] ${s}...`);
    if (i % 5 === 0) console.log('');
  }
  console.log('\n  ⚠️  Timeout waiting for job');
  return null;
}

async function scanTargets(radius = 16) {
  const r = await get(`/nearby?radius=${radius}`);
  const entities = r.body?.data?.entities || [];

  return entities.filter(e => {
    // Игнорируем неживые объекты (выброшенные предметы, стрелы, сферы опыта)
    if (e.type === 'object' || e.type === 'orb' || e.type === 'projectile') {
      return false;
    }

    // Атакуем всех остальных (игроков, мобов, животных)
    return true;
  });
}

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  TEST: Attack EVERYONE nearby (Players, Mobs, Animals)`);
  console.log('  Press Ctrl+C to stop at any time');
  console.log('══════════════════════════════════════════════════════════\n');

  // Health check
  const health = await get('/health');
  const botState = health.body?.data?.botState;
  console.log(`[Health] spawned=${botState?.spawned}, connected=${botState?.connected}`);
  if (!botState?.spawned) {
    console.error('Bot is not spawned. Exiting.');
    process.exit(1);
  }

  await sleep(500);

  // Status check
  const statusR = await get('/status');
  const s = statusR.body?.data;
  console.log(`[Status] health=${s?.health}/20, food=${s?.food}/20, gameMode=${s?.gameMode}`);

  await sleep(500);

  // Inventory — find best weapon to equip
  const invR = await get('/inventory');
  const items = invR.body?.data?.items || [];

  const WEAPON_PRIORITY = [
    'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'golden_sword', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
    'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'
  ];

  let bestWeapon = null;
  for (const w of WEAPON_PRIORITY) {
    if (items.some(i => i.name === w)) { bestWeapon = w; break; }
  }

  if (bestWeapon) {
    console.log(`\n[Equip] Best weapon found: ${bestWeapon}. Equipping...`);
    const er = await post('/actions/equip', { name: bestWeapon, destination: 'hand' });
    if (er.body?.ok) {
      const jobId = er.body.data?.jobId;
      await pollJob(jobId, `equip ${bestWeapon}`);
    } else {
      console.log(`  ⚠️  Could not equip: ${er.body?.error}`);
    }
    await sleep(500);
  } else {
    console.log('\n[Equip] No weapon found in inventory. Will fight bare-handed or with whatever is held.');
  }

  // Main attack loop
  let round = 0;
  let totalKills = 0;

  while (!stopRequested) {
    round++;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Round ${round}] Scanning for targets (radius=24)...`);

    const targets = await scanTargets(24);

    if (targets.length === 0) {
      console.log('[Scan] No targets found. Waiting 5 seconds before next scan...');
      await sleep(5000);
      // After 3 empty rounds in a row, offer to exit
      if (round > 3) {
        console.log('\n[Done] No enemies found after multiple scans. All clear! Exiting.');
        break;
      }
      continue;
    }

    round = 0; // Reset empty round counter when we find targets

    console.log(`[Scan] Found ${targets.length} target(s):`);
    // У игроков имя в поле username, у мобов в name
    targets.forEach(t => {
      const targetName = t.username || t.name || 'unknown';
      console.log(`  - ${targetName} (type=${t.type}, dist=${t.distance}m)`);
    });

    // Attack each target
    for (const target of targets) {
      if (stopRequested) break;

      // Re-check health before each attack
      const hR = await get('/status');
      const health = hR.body?.data?.health;
      console.log(`\n[Health check] health=${health}/20`);

      if (health <= 4) {
        console.log('⚠️  Health critically low! Stopping attacks to survive.');
        await post('/actions/stop', {});
        break;
      }

      const targetName = target.username || target.name;
      console.log(`\n[Attack] Targeting: ${targetName} at distance=${target.distance}m`);

      const attackParams = {};
      if (target.distance <= 20) {
        // Передаем имя (или юзернейм игрока) в API
        attackParams.name = targetName;
      } else {
        console.log(`  ⚠️  Target too far (${target.distance}m), skipping`);
        continue;
      }

      const ar = await post('/actions/attack', attackParams);
      if (!ar.body?.ok) {
        console.log(`  ❌ Attack request failed: ${ar.body?.error}`);
        continue;
      }

      const jobId = ar.body.data?.jobId;
      const result = await pollJob(jobId, `attack ${targetName}`);

      if (result?.status === 'done') {
        totalKills++;
        console.log(`  🗡️  Kill #${totalKills}`);
      }

      await sleep(1000);
    }
  }

  // Final status
  console.log('\n══════════════════════════════════════════════════════════');
  const finalStatus = await get('/status');
  const fs = finalStatus.body?.data;
  console.log(`[Final] health=${fs?.health}/20, food=${fs?.food}/20`);
  console.log(`[Final] Total kills this session: ${totalKills}`);
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});