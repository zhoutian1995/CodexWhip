class WhipSendScheduler {
  constructor({
    cooldownMs,
    run,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onQueued = () => {},
    onQueuedError = () => {},
  }) {
    if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
      throw new TypeError('cooldownMs must be a non-negative number');
    }
    if (typeof run !== 'function') throw new TypeError('run must be a function');

    this.cooldownMs = cooldownMs;
    this.run = run;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onQueued = onQueued;
    this.onQueuedError = onQueuedError;
    this.running = false;
    this.pending = false;
    this.disposed = false;
    this.lastStartedAt = Number.NEGATIVE_INFINITY;
    this.timer = null;
  }

  get hasPending() {
    return this.pending;
  }

  get isRunning() {
    return this.running;
  }

  cooldownRemaining() {
    return Math.max(0, this.cooldownMs - (this.now() - this.lastStartedAt));
  }

  request() {
    if (this.disposed) {
      return Promise.resolve({ status: 'failed', code: 'WHIP_SCHEDULER_DISPOSED' });
    }

    const retryAfterMs = this.cooldownRemaining();
    if (this.running || retryAfterMs > 0) {
      const coalesced = this.pending;
      this.pending = true;
      const queuedResult = {
        status: 'queued',
        code: coalesced ? 'WHIP_ALREADY_QUEUED' : 'WHIP_QUEUED',
        coalesced,
        retryAfterMs,
      };
      this.schedulePending();
      this.notifyQueued(queuedResult);
      return Promise.resolve(queuedResult);
    }

    return this.runNow();
  }

  async runNow() {
    if (this.disposed) {
      return { status: 'failed', code: 'WHIP_SCHEDULER_DISPOSED' };
    }

    this.running = true;
    this.lastStartedAt = this.now();
    try {
      return await this.run();
    } finally {
      this.running = false;
      this.schedulePending();
    }
  }

  schedulePending() {
    if (this.disposed || !this.pending || this.running || this.timer !== null) return;

    const delay = this.cooldownRemaining();
    if (delay > 0) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.drainPending();
      }, delay);
      return;
    }

    this.drainPending();
  }

  drainPending() {
    if (this.disposed || !this.pending || this.running) return;
    if (this.cooldownRemaining() > 0) {
      this.schedulePending();
      return;
    }

    this.pending = false;
    this.runNow().catch(error => this.notifyQueuedError(error));
  }

  notifyQueued(result) {
    try {
      this.onQueued(result);
    } catch (error) {
      this.notifyQueuedError(error);
    }
  }

  notifyQueuedError(error) {
    try {
      this.onQueuedError(error);
    } catch {
      // Status observers must never break or reject the send queue.
    }
  }

  dispose() {
    this.disposed = true;
    this.pending = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { WhipSendScheduler };
