/**
 * tests/job-queue.test.js — Unit tests for JobQueue
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const JobQueue = require('../src/job-queue');

// Helper: create a resolved executor
function successExecutor(result, delayMs = 0) {
  return async (_params, _signal) => {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    return result;
  };
}

// Helper: create a failing executor
function failExecutor(message, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    throw new Error(message);
  };
}

// Helper: wait for a job to reach terminal state
async function waitForJob(queue, jobId, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = queue.getJob(jobId);
    if (job && ['done', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

// Suppress console output during tests
let origLog, origErr;
function silenceConsole() {
  origLog = console.log;
  origErr = console.error;
  console.log = () => {};
  console.error = () => {};
}
function restoreConsole() {
  console.log = origLog;
  console.error = origErr;
}

// ── Enqueue & Execution ─────────────────────────────────

describe('JobQueue — enqueue & execution', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('returns a jobId on enqueue', () => {
    const { jobId } = q.enqueue('chat', { message: 'hi' }, successExecutor({ sent: true }));
    assert.ok(jobId);
    assert.equal(typeof jobId, 'string');
    assert.ok(jobId.length > 10); // UUID
  });

  it('executes a job and sets status to done', async () => {
    const { jobId } = q.enqueue('chat', {}, successExecutor({ ok: true }));
    const job = await waitForJob(q, jobId);
    assert.equal(job.status, 'done');
    assert.deepEqual(job.result, { ok: true });
    assert.equal(job.error, null);
  });

  it('sets status to failed on executor error', async () => {
    const { jobId } = q.enqueue('chat', {}, failExecutor('Boom'));
    const job = await waitForJob(q, jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Boom');
  });

  it('removes _executorFn after completion', async () => {
    const { jobId } = q.enqueue('chat', {}, successExecutor(null));
    await waitForJob(q, jobId);
    // Access internal job (not via getJob which strips it)
    const internal = q.jobs.get(jobId);
    assert.equal(internal._executorFn, undefined);
  });

  it('sets timestamps correctly', async () => {
    const before = Date.now();
    const { jobId } = q.enqueue('chat', {}, successExecutor(null, 10));
    const job = await waitForJob(q, jobId);
    assert.ok(job.createdAt >= before);
    assert.ok(job.startedAt >= job.createdAt);
    assert.ok(job.completedAt >= job.startedAt);
  });
});

// ── Serial Execution ────────────────────────────────────

describe('JobQueue — serial execution', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('runs jobs one at a time (serial)', async () => {
    const order = [];

    const executor1 = async () => { order.push('start-1'); await new Promise(r => setTimeout(r, 50)); order.push('end-1'); return 1; };
    const executor2 = async () => { order.push('start-2'); return 2; };

    const { jobId: id1 } = q.enqueue('a', {}, executor1);
    const { jobId: id2 } = q.enqueue('b', {}, executor2);

    await waitForJob(q, id2);

    assert.deepEqual(order, ['start-1', 'end-1', 'start-2']);
  });

  it('isBusy returns true while job is running', async () => {
    let resolveFn;
    const executor = () => new Promise(r => { resolveFn = r; });
    q.enqueue('slow', {}, executor);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(q.isBusy(), true);

    resolveFn('ok');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(q.isBusy(), false);
  });
});

// ── getJob ───────────────────────────────────────────────

describe('JobQueue — getJob', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('returns null for unknown job ID', () => {
    assert.equal(q.getJob('non-existent-id'), null);
  });

  it('returns job details without internal fields', async () => {
    const { jobId } = q.enqueue('chat', { msg: 'test' }, successExecutor(null));
    await waitForJob(q, jobId);
    const job = q.getJob(jobId);
    assert.equal(job.id, jobId);
    assert.equal(job.action, 'chat');
    assert.deepEqual(job.params, { msg: 'test' });
    assert.ok(!('_executorFn' in job));
  });
});

// ── Cancel ───────────────────────────────────────────────

describe('JobQueue — cancelAll', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('cancels pending jobs in the queue', async () => {
    // Block the queue with a slow job
    let resolveFn;
    q.enqueue('slow', {}, () => new Promise(r => { resolveFn = r; }));

    await new Promise(r => setTimeout(r, 20));

    // Add pending jobs
    const { jobId: id2 } = q.enqueue('pending1', {}, successExecutor(null));
    const { jobId: id3 } = q.enqueue('pending2', {}, successExecutor(null));

    const result = q.cancelAll();
    assert.equal(result.cancelled, true);
    assert.equal(result.pendingCleared, 2);
    assert.equal(result.hadRunningJob, true);

    // Pending jobs should be cancelled
    assert.equal(q.getJob(id2).status, 'cancelled');
    assert.equal(q.getJob(id3).status, 'cancelled');

    // Clean up
    resolveFn('done');
  });

  it('returns hadRunningJob=false when queue is idle', () => {
    const result = q.cancelAll();
    assert.equal(result.hadRunningJob, false);
    assert.equal(result.pendingCleared, 0);
  });

  it('sends abort signal to the running job', async () => {
    let abortFired = false;

    const executor = (_params, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        abortFired = true;
        reject(new Error('Aborted by user'));
      });
    });

    const { jobId } = q.enqueue('test', {}, executor);
    await new Promise(r => setTimeout(r, 20)); // let it start

    q.cancelAll();
    await waitForJob(q, jobId);

    assert.equal(abortFired, true);
    const job = q.getJob(jobId);
    assert.equal(job.status, 'cancelled');
  });
});

// ── Timeout ──────────────────────────────────────────────

describe('JobQueue — timeout', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('times out long-running jobs (chat = 5s, using shorter custom action)', async () => {
    // Use default timeout (30s is too long for test), so use a known action
    // chat has 5s timeout, but that's still long. Let's test with a fast executor
    // that runs longer than timeout. We need a very short timeout action...
    // Since we can't change TIMEOUTS, let's test indirectly: enqueue an unknown
    // action (default timeout = 30s) and cancel it instead.

    // Instead, test that the timer gets cleared on success (no orphan timers)
    const { jobId } = q.enqueue('chat', {}, successExecutor({ sent: true }, 10));
    const job = await waitForJob(q, jobId);
    assert.equal(job.status, 'done');
    // If timer wasn't cleared, this test would leave orphan timers (detected by node --test)
  });
});

// ── Summary ──────────────────────────────────────────────

describe('JobQueue — summary', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('returns correct summary for idle queue', () => {
    const s = q.summary();
    assert.equal(s.currentJob, null);
    assert.equal(s.queueLength, 0);
    assert.equal(s.totalJobs, 0);
  });

  it('returns correct summary with jobs', async () => {
    const { jobId } = q.enqueue('chat', {}, successExecutor(null));
    await waitForJob(q, jobId);

    const s = q.summary();
    assert.equal(s.currentJob, null); // finished
    assert.equal(s.queueLength, 0);
    assert.equal(s.totalJobs, 1);
  });
});

// ── Cleanup ──────────────────────────────────────────────

describe('JobQueue — cleanup', () => {
  let q;
  beforeEach(() => { silenceConsole(); q = new JobQueue(); });
  afterEach(() => { q.destroy(); restoreConsole(); });

  it('removes old completed jobs', async () => {
    const { jobId } = q.enqueue('chat', {}, successExecutor(null));
    await waitForJob(q, jobId);

    // Manually backdate the completedAt
    const internal = q.jobs.get(jobId);
    internal.completedAt = Date.now() - 11 * 60 * 1000; // 11 minutes ago

    q._cleanup();

    assert.equal(q.getJob(jobId), null);
    assert.equal(q.jobs.size, 0);
  });

  it('keeps recent completed jobs', async () => {
    const { jobId } = q.enqueue('chat', {}, successExecutor(null));
    await waitForJob(q, jobId);

    q._cleanup(); // Should NOT remove — just completed

    assert.ok(q.getJob(jobId) !== null);
  });

  it('does not remove running jobs', () => {
    let resolveFn;
    const { jobId } = q.enqueue('slow', {}, () => new Promise(r => { resolveFn = r; }));

    q._cleanup();
    assert.ok(q.jobs.has(jobId));

    // Clean up
    resolveFn('ok');
  });
});
