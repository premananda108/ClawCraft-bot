/**
 * test-build.js — Trigger house building
 */
const API_URL = 'http://127.0.0.1:3001';

async function startBuilding() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  TEST: Building a simple house');
  console.log('══════════════════════════════════════════════════════════');

  try {
    // 1. Check health/state
    const healthRes = await fetch(`${API_URL}/health`);
    const health = await healthRes.json();
    if (!health.ok) throw new Error('Bot not ready');
    
    // 1.5 Fetch full status and ensure creative mode
    const statusRes = await fetch(`${API_URL}/status`);
    const statusData = await statusRes.json();
    if (!statusData.ok) throw new Error('Failed to fetch bot status');

    console.log(`[Status] Bot is ready at ${JSON.stringify(statusData.data.position)}`);

    if (statusData.data.gameMode !== 'creative') {
      console.log('[Status] Switching to creative mode...');
      await fetch(`${API_URL}/actions/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '/gamemode creative' })
      });
      await new Promise(r => setTimeout(r, 1000));
      
      const verifyRes = await fetch(`${API_URL}/status`);
      const verifyData = await verifyRes.json();
      if (verifyData.data.gameMode !== 'creative') {
        throw new Error('Failed to switch to creative mode. Make sure the bot has OP permissions on the server!');
      }
    }

    // 2. Start building
    console.log('[Build] Sending build command...');
    const buildRes = await fetch(`${API_URL}/actions/build-house`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material: 'oak_planks' })
    });

    const buildData = await buildRes.json();
    if (!buildData.ok) throw new Error(buildData.error);

    const jobId = buildData.data.jobId;
    console.log(`[Build] ✅ Job started. ID: ${jobId}`);

    // 3. Monitor progress
    let done = false;
    while (!done) {
      const statusRes = await fetch(`${API_URL}/jobs/${jobId}`);
      const job = await statusRes.json();

      if (!job.ok) {
        console.error('[Monitor] Error fetching job status');
        break;
      }

      const s = job.data;
      process.stdout.write(`\r[Monitor] status=${s.status} ... `);

      if (['done', 'failed', 'cancelled'].includes(s.status)) {
        done = true;
        console.log(`\n[Final] Result: ${JSON.stringify(s.result || s.error)}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

  } catch (err) {
    console.error(`[Error] ${err.message}`);
  }
}

startBuilding();
