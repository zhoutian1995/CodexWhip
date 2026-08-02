const test = require('node:test');
const assert = require('node:assert/strict');

const { WhipSendScheduler } = require('../lib/whip-send-scheduler');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeClock() {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();

  function runDueTimers() {
    let ranTimer = true;
    while (ranTimer) {
      ranTimer = false;
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.at <= currentTime)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [timerId, timer] of dueTimers) {
        timers.delete(timerId);
        timer.callback();
        ranTimer = true;
      }
    }
  }

  return {
    now: () => currentTime,
    setTimer(callback, delay) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, at: currentTime + delay });
      return timerId;
    },
    clearTimer(timerId) {
      timers.delete(timerId);
    },
    advance(milliseconds) {
      currentTime += milliseconds;
      runDueTimers();
    },
    pendingTimerCount: () => timers.size,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('first whip request runs immediately', async () => {
  const clock = createFakeClock();
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: async () => ({ status: 'sent', call: ++calls }),
  });

  const result = await scheduler.request();

  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'sent', call: 1 });
});

test('rapid clicks during an active send create one deferred send', async () => {
  const clock = createFakeClock();
  const firstRun = deferred();
  let calls = 0;
  const queuedEvents = [];
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onQueued: event => queuedEvents.push(event),
    run: async () => {
      calls++;
      if (calls === 1) return firstRun.promise;
      return { status: 'sent', call: calls };
    },
  });

  const firstRequest = scheduler.request();
  const secondResult = await scheduler.request();
  const thirdResult = await scheduler.request();

  assert.equal(calls, 1);
  assert.equal(secondResult.status, 'queued');
  assert.equal(secondResult.coalesced, false);
  assert.equal(thirdResult.status, 'queued');
  assert.equal(thirdResult.coalesced, true);
  assert.equal(scheduler.hasPending, true);
  assert.equal(queuedEvents.length, 2);

  firstRun.resolve({ status: 'sent', call: 1 });
  await firstRequest;
  await flushMicrotasks();
  assert.equal(clock.pendingTimerCount(), 1);

  clock.advance(1499);
  await flushMicrotasks();
  assert.equal(calls, 1);

  clock.advance(1);
  await flushMicrotasks();
  assert.equal(calls, 2);
  assert.equal(scheduler.hasPending, false);
});

test('a request during cooldown is delivered when cooldown expires', async () => {
  const clock = createFakeClock();
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: async () => ({ status: 'sent', call: ++calls }),
  });

  await scheduler.request();
  const queued = await scheduler.request();

  assert.equal(queued.status, 'queued');
  assert.equal(calls, 1);
  clock.advance(1500);
  await flushMicrotasks();
  assert.equal(calls, 2);
});

test('a long active send drains its pending whip immediately after completion', async () => {
  const clock = createFakeClock();
  const firstRun = deferred();
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: async () => {
      calls++;
      if (calls === 1) return firstRun.promise;
      return { status: 'sent', call: calls };
    },
  });

  const firstRequest = scheduler.request();
  clock.advance(2000);
  const queued = await scheduler.request();
  assert.equal(queued.status, 'queued');
  assert.equal(queued.retryAfterMs, 0);

  firstRun.resolve({ status: 'sent', call: 1 });
  await firstRequest;
  await flushMicrotasks();

  assert.equal(calls, 2);
  assert.equal(clock.pendingTimerCount(), 0);
});

test('errors from an automatic queued run are reported without an unhandled rejection', async () => {
  const clock = createFakeClock();
  const errors = [];
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onQueuedError: error => errors.push(error),
    run: async () => {
      calls++;
      if (calls === 2) throw new Error('queued failure');
      return { status: 'sent', call: calls };
    },
  });

  await scheduler.request();
  await scheduler.request();
  clock.advance(1500);
  await flushMicrotasks();

  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /queued failure/u);
});

test('a failing queue status observer does not discard the pending send', async () => {
  const clock = createFakeClock();
  const observerErrors = [];
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onQueued: () => {
      throw new Error('tray refresh failed');
    },
    onQueuedError: error => observerErrors.push(error),
    run: async () => ({ status: 'sent', call: ++calls }),
  });

  await scheduler.request();
  const queued = await scheduler.request();
  clock.advance(1500);
  await flushMicrotasks();

  assert.equal(queued.status, 'queued');
  assert.equal(calls, 2);
  assert.equal(observerErrors.length, 1);
  assert.match(observerErrors[0].message, /tray refresh failed/u);
});

test('dispose cancels a pending send', async () => {
  const clock = createFakeClock();
  let calls = 0;
  const scheduler = new WhipSendScheduler({
    cooldownMs: 1500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    run: async () => ({ status: 'sent', call: ++calls }),
  });

  await scheduler.request();
  await scheduler.request();
  scheduler.dispose();
  clock.advance(1500);
  await flushMicrotasks();

  assert.equal(calls, 1);
  assert.equal(scheduler.hasPending, false);
  assert.equal(clock.pendingTimerCount(), 0);
});
