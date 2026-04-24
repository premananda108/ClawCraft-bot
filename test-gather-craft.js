/**
 * test-gather-craft.js — Test: collect ANY log → craft planks → crafting_table → wooden_pickaxe
 * Run: node test-gather-craft.js
 */

const http = require('http');
const BASE = 'http://127.0.0.1:3001';

// Список всех стандартных видов бревен в Minecraft
const LOG_TYPES = [
  'oak_log',
  'birch_log',
  'spruce_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log'
];

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

function fmt(o) { return JSON.stringify(o, null, 2); }

/**
 * Poll a job until terminal state.
 * Returns the final job data.
 */
async function pollJob(jobId, label, maxAttempts = 60) {
  console.log(`  ⏳ Polling job [${label}] (${jobId.slice(0, 8)}...)...`);
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(1500);
    const r = await get(`/jobs/${jobId}`);
    const job = r.body?.data;
    const s = job?.status;
    process.stdout.write(`  [${i}] status=${s} `);
    if (s === 'done') { console.log(`✅ result=${fmt(job.result)}`); return job; }
    if (s === 'failed') { console.log(`❌ error=${job.error}`); return job; }
    if (s === 'cancelled') { console.log(`⏹️  cancelled`); return job; }
    console.log('...');
  }
  console.log('  ⚠️  Max attempts reached');
  return null;
}

async function step(label, fn) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${label}`);
  try {
    return await fn();
  } catch (err) {
    console.error(`  EXCEPTION: ${err.message}`);
    return null;
  }
}

async function postAction(actionName, params) {
  const r = await post(`/actions/${actionName}`, params);
  if (!r.body?.ok) {
    console.log(`  ❌ HTTP ${r.status}: ${r.body?.error}`);
    return null;
  }
  const jobId = r.body.data?.jobId;
  console.log(`  📬 Job enqueued: ${jobId}`);
  return jobId;
}

// ============================================================

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  TEST: Gather ANY log → craft table → wooden pickaxe');
  console.log('══════════════════════════════════════════════════════════');

  // 1. Health check
  await step('GET /health', async () => {
    const r = await get('/health');
    console.log(`  botState: ${fmt(r.body?.data?.botState)}`);
    if (!r.body?.data?.botState?.spawned) throw new Error('Bot not spawned!');
  });

  await sleep(500);

  // 2. Status check
  let botPos;
  await step('GET /status', async () => {
    const r = await get('/status');
    const d = r.body?.data;
    console.log(`  health=${d?.health}, food=${d?.food}, pos=(${d?.position?.x}, ${d?.position?.y}, ${d?.position?.z})`);
    botPos = d?.position;
  });

  await sleep(500);

  // 3. Inventory check
  await step('GET /inventory (before)', async () => {
    const r = await get('/inventory');
    const d = r.body?.data;
    console.log(`  items=${d?.itemCount}, freeSlots=${d?.freeSlots}`);
    d?.items?.forEach(i => console.log(`    - ${i.name} x${i.count}`));
  });

  await sleep(500);

  // 4. Find ANY log
  let targetLog = null;
  let targetPlanks = null;

  await step('Find any wood log nearby', async () => {
    for (const logName of LOG_TYPES) {
      const r = await get(`/findblock?name=${logName}`);
      const d = r.body?.data;
      if (d?.found) {
        console.log(`  ✅ Found ${d.count} ${logName}(s). Nearest at ${fmt(d.nearest)}`);
        targetLog = logName;
        // Генерируем название досок (например: oak_log -> oak_planks)
        targetPlanks = logName.replace('_log', '_planks');
        break; // Нашли дерево — прерываем цикл
      }
    }

    if (!targetLog) {
      console.log('  ❌ No logs found within range');
    }
  });

  if (!targetLog) {
    console.log('\n⛔ Cannot proceed without any wood nearby. Exiting.');
    return;
  }

  await sleep(500);

  // 5. Collect 3 logs (динамическое название)
  await step(`POST /actions/collect — ${targetLog} x3`, async () => {
    const jobId = await postAction('collect', { name: targetLog, count: 3, maxDistance: 32 });
    if (!jobId) return;
    await pollJob(jobId, `collect ${targetLog}`);
  });

  await sleep(1000);

  // 6. Inventory after collect
  let hasLogs = false;
  await step('GET /inventory (after collect)', async () => {
    const r = await get('/inventory');
    const d = r.body?.data;
    d?.items?.forEach(i => console.log(`    - ${i.name} x${i.count}`));
    hasLogs = d?.items?.some(i => i.name.includes('log'));
  });

  if (!hasLogs) {
    console.log('\n⛔ No logs in inventory after collect. Cannot craft. Exiting.');
    return;
  }

  await sleep(500);

  // 7. Craft planks (динамическое название)
  await step(`POST /actions/craft — ${targetPlanks} x8`, async () => {
    const jobId = await postAction('craft', { name: targetPlanks, count: 8, useCraftingTable: false });
    if (!jobId) return;
    await pollJob(jobId, `craft ${targetPlanks}`);
  });

  await sleep(500);

  // 8. Craft crafting_table
  await step('POST /actions/craft — crafting_table x1', async () => {
    const jobId = await postAction('craft', { name: 'crafting_table', count: 1, useCraftingTable: false });
    if (!jobId) return;
    await pollJob(jobId, 'craft crafting_table');
  });

  await sleep(500);

  // 9. Place crafting_table 1 block in front of bot
  await step('POST /actions/place-block — crafting_table', async () => {
    if (!botPos) { console.log('  ⚠️  No position data, skipping placement'); return; }
    // Place 1 block to the +X side of bot, same Y
    const px = Math.floor(botPos.x) + 2;
    const py = Math.floor(botPos.y);
    const pz = Math.floor(botPos.z);
    console.log(`  Placing at (${px}, ${py}, ${pz})`);
    const jobId = await postAction('place-block', { name: 'crafting_table', x: px, y: py, z: pz });
    if (!jobId) return;
    await pollJob(jobId, 'place crafting_table');
  });

  await sleep(1000);

  // 10. Craft sticks (no table needed)
  await step('POST /actions/craft — stick x4', async () => {
    const jobId = await postAction('craft', { name: 'stick', count: 4, useCraftingTable: false });
    if (!jobId) return;
    await pollJob(jobId, 'craft sticks');
  });

  await sleep(500);

  // 11. Craft wooden_pickaxe WITH crafting table
  await step('POST /actions/craft — wooden_pickaxe (with table)', async () => {
    const jobId = await postAction('craft', { name: 'wooden_pickaxe', count: 1, useCraftingTable: true });
    if (!jobId) return;
    await pollJob(jobId, 'craft wooden_pickaxe');
  });

  await sleep(500);

  // 12. Final inventory
  await step('GET /inventory (final result)', async () => {
    const r = await get('/inventory');
    const d = r.body?.data;
    console.log(`  items=${d?.itemCount}`);
    d?.items?.forEach(i => console.log(`    - ${i.name} x${i.count}`));
    const hasPickaxe = d?.items?.some(i => i.name.includes('pickaxe'));
    console.log(hasPickaxe ? '\n  🎉 wooden_pickaxe crafted successfully!' : '\n  ⚠️  No pickaxe found in inventory');
  });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});