/**
 * job-queue.js — Centralized task queue
 *
 * Policy:
 * - Only one main action at a time
 * - Read-only requests (status, inventory) bypass the queue
 * - stopAll() interrupts the current task
 */
const { v4: uuidv4 } = require('uuid');

class JobQueue {
  constructor() {
    /** @type {Map<string, Job>} */
    this.jobs = new Map();

    /** @type {Job|null} */
    this.currentJob = null;

    /** @type {Array<Job>} */
    this.queue = [];

    /** @type {AbortController|null} */
    this._currentAbort = null;

    // Auto-cleanup: remove finished jobs older than 10 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
  }

  /**
   * Remove completed jobs older than 10 minutes to prevent memory leak
   */
  _cleanup() {
    const MAX_AGE = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (
        ['done', 'failed', 'cancelled'].includes(job.status) &&
        job.completedAt &&
        now - job.completedAt > MAX_AGE
      ) {
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Stop cleanup timer (call on shutdown)
   */
  destroy() {
    clearInterval(this._cleanupInterval);
  }

  /**
   * Create task and put in queue
   * @param {string} actionName
   * @param {object} params
   * @param {function} executorFn - async (params, signal) => result
   * @returns {{ jobId: string }}
   */
  enqueue(actionName, params, executorFn) {
    const job = {
      id: uuidv4(),
      action: actionName,
      params,
      status: 'pending',
      result: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      _executorFn: executorFn,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job);

    // Try to run next task
    this._processNext();

    return { jobId: job.id };
  }

  /**
   * Get task status
   * @param {string} jobId
   */
  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.id,
      action: job.action,
      params: job.params,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  cancelAll() {
    let hadRunningJob = false;
    // Cancel current
    if (this._currentAbort) {
      hadRunningJob = true;
      this._currentAbort.abort();
    }

    const pendingCleared = this.queue.length;
    // Mark all pending as cancelled
    for (const job of this.queue) {
      job.status = 'cancelled';
      job.completedAt = Date.now();
    }
    this.queue = [];

    return { cancelled: true, pendingCleared, hadRunningJob };
  }

  /**
   * Launch next task from queue
   */
  async _processNext() {
    // If task is already running — wait.
    // Note: This check and the subsequent shift() are safe from race conditions 
    // because Node.js is single-threaded and they happen before the first await.
    if (this.currentJob) return;

    // Take next
    const job = this.queue.shift();
    if (!job) return;

    this.currentJob = job;
    job.status = 'running';
    job.startedAt = Date.now();
    console.log(`[Queue] 🏃 Running: ${job.action} (${job.id})`);

    // Create AbortController for cancellation
    const abortController = new AbortController();
    this._currentAbort = abortController;

    const TIMEOUTS = {
      chat: 5000,
      whisper: 5000,
      equipItem: 5000,
      setHotbarSlot: 5000,
      tossItem: 5000,
      goto: 60000,
      digBlock: 45000,
      craftItem: 45000,
      collectBlock: 120000,
      attack: 30000,
      buildHouse: 600000,
      follow: null,
      protect: null
    };

    const timeoutMs = TIMEOUTS[job.action] !== undefined ? TIMEOUTS[job.action] : 30000;

    let timeoutTimer = null;
    try {
      let result;
      if (timeoutMs === null) {
        // No timeout: run until AbortSignal fires
        result = await job._executorFn(job.params, abortController.signal);
      } else {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error(`Action ${job.action} timed out (${timeoutMs / 1000}s)`)),
            timeoutMs
          );
          abortController.signal.addEventListener('abort', () => clearTimeout(timeoutTimer));
        });
        result = await Promise.race([
          job._executorFn(job.params, abortController.signal),
          timeoutPromise,
        ]);
        clearTimeout(timeoutTimer); // Clear timer on success — prevent orphan timers in event loop
      }

      job.result = result;
      job.status = 'done';
      console.log(`[Queue] ✅ Completed: ${job.action} (${job.id})`);
    } catch (err) {
      const wasAbortedByUser = abortController.signal.aborted;
      
      // If the timeout triggered (or any other error), force abort to stop the ghost action
      if (!wasAbortedByUser) {
        abortController.abort();
      }

      if (wasAbortedByUser) {
        job.status = 'cancelled';
        job.error = 'Task was cancelled';
        console.log(`[Queue] ⏹️ Cancelled: ${job.action} (${job.id})`);
      } else {
        job.status = 'failed';
        job.error = err.message;
        console.error(`[Queue] ❌ Error in ${job.action} (${job.id}): ${err.message}`);
      }
    } finally {
      job.completedAt = Date.now();
      delete job._executorFn; // Don't store function reference
      this.currentJob = null;
      this._currentAbort = null;

      // Launch next
      this._processNext();
    }
  }

  /**
   * Check if task is active
   */
  isBusy() {
    return this.currentJob !== null;
  }

  /**
   * Summary for debugging
   */
  summary() {
    return {
      currentJob: this.currentJob ? this.getJob(this.currentJob.id) : null,
      queueLength: this.queue.length,
      totalJobs: this.jobs.size,
    };
  }
}

module.exports = JobQueue;
