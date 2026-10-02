import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BudgetRefusedError,
  UpstreamStatusError,
  createBudget,
  parseRetryAfterMs,
} from '../../server/providers/gateway/budget.js';

/** Deterministic PRNG (mulberry32) so property failures are reproducible. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: admissions never exceed perMinute in any trailing minute or dailyCredits per UTC day', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = seeded(seed);
    const perMinute = 1 + Math.floor(rand() * 40);
    const dailyCredits = 1 + Math.floor(rand() * 400);
    let clock = Date.UTC(2026, 8, 29, 23, 30) + Math.floor(rand() * 3_600_000);
    const budget = createBudget({
      perMinute,
      dailyCredits,
      now: () => clock,
      random: rand,
    });
    const admittedAt = [];
    const creditsByDay = new Map();
    for (let step = 0; step < 3_000; step += 1) {
      // Mix bursts (0 ms gaps) with long idle stretches that cross midnight.
      const gapRoll = rand();
      clock += gapRoll < 0.5 ? 0 : gapRoll < 0.9 ? Math.floor(rand() * 5_000) : Math.floor(rand() * 600_000);
      const cost = 1 + Math.floor(rand() * 4);
      if (budget.acquire(cost).ok) {
        admittedAt.push(clock);
        const day = Math.floor(clock / 86_400_000);
        creditsByDay.set(day, (creditsByDay.get(day) || 0) + cost);
        // Occasionally feed back provider signals, as real traffic does.
        const outcome = rand();
        if (outcome < 0.1) budget.recordFailure({ status: 429, retryAfterMs: Math.floor(rand() * 30_000) });
        else if (outcome < 0.15) budget.recordFailure({ status: 503 });
        else budget.recordSuccess({ remainingCredits: rand() < 0.05 ? Math.floor(rand() * dailyCredits) : null });
      }
    }
    for (let i = 0; i < admittedAt.length; i += 1) {
      let j = i;
      while (j < admittedAt.length && admittedAt[j] - admittedAt[i] < 60_000) j += 1;
      assert.ok(j - i <= perMinute, `seed ${seed}: ${j - i} admissions within one minute exceeds ${perMinute}`);
    }
    for (const [day, credits] of creditsByDay) {
      assert.ok(credits <= dailyCredits, `seed ${seed}: day ${day} spent ${credits} > ${dailyCredits}`);
    }
  }
});

test('rate limit refuses with the time until the oldest admission leaves the window', () => {
  let clock = 1_000_000;
  const budget = createBudget({ perMinute: 2, now: () => clock });
  assert.equal(budget.acquire().ok, true);
  clock += 10_000;
  assert.equal(budget.acquire().ok, true);
  const refused = budget.acquire();
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'rate');
  assert.equal(refused.retryInMs, 50_000);
  clock += 50_000;
  assert.equal(budget.acquire().ok, true);
});

test('Retry-After is honoured even when longer than the jittered backoff', () => {
  let clock = 0;
  const budget = createBudget({ perMinute: 100, now: () => clock, random: () => 0 });
  budget.acquire();
  budget.recordFailure({ status: 429, retryAfterMs: 120_000 });
  const refused = budget.acquire();
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'rate-limited');
  assert.equal(refused.retryInMs, 120_000);
  clock = 119_999;
  assert.equal(budget.acquire().ok, false);
  clock = 120_000;
  assert.equal(budget.acquire().ok, true);
});

test('backoff grows exponentially with jitter and resets on success', () => {
  let clock = 0;
  const budget = createBudget({ perMinute: 100, now: () => clock, random: () => 1 - Number.EPSILON, failureThreshold: 99, backoffBaseMs: 1_000 });
  const waits = [];
  for (let i = 0; i < 4; i += 1) {
    budget.recordFailure({ status: 503 });
    waits.push(budget.snapshot().blockedForMs);
    clock += budget.snapshot().blockedForMs;
  }
  assert.deepEqual(waits.map((w) => Math.round(w)), [1_000, 2_000, 4_000, 8_000]);
  budget.recordSuccess();
  assert.equal(budget.snapshot().consecutiveFailures, 0);
  assert.equal(budget.acquire().ok, true);
});

test('client errors other than 429 do not back off', () => {
  const budget = createBudget({ perMinute: 10, now: () => 0 });
  budget.recordFailure({ status: 404 });
  assert.equal(budget.acquire().ok, true);
});

test('circuit opens after repeated failures, then admits a single half-open probe', () => {
  let clock = 0;
  const budget = createBudget({
    perMinute: 100,
    failureThreshold: 3,
    circuitOpenMs: 60_000,
    backoffBaseMs: 1,
    backoffMaxMs: 1,
    now: () => clock,
  });
  for (let i = 0; i < 3; i += 1) budget.recordFailure({ status: 500 });
  assert.equal(budget.acquire().reason, 'circuit-open');
  clock = 60_000;
  assert.equal(budget.acquire().ok, true, 'first probe after the open period');
  assert.equal(budget.acquire().reason, 'circuit-half-open', 'second concurrent probe refused');
  budget.recordSuccess();
  assert.equal(budget.snapshot().circuit, 'closed');
  assert.equal(budget.acquire().ok, true);
});

test('provider-reported remaining credits lower the daily ceiling; midnight UTC resets it', () => {
  let clock = Date.UTC(2026, 8, 29, 23, 59);
  const budget = createBudget({ perMinute: 100, dailyCredits: 4000, now: () => clock });
  budget.acquire(4);
  budget.recordSuccess({ remainingCredits: 3 });
  assert.equal(budget.acquire(4).reason, 'daily-budget');
  assert.equal(budget.acquire(3).ok, true);
  clock = Date.UTC(2026, 8, 30, 0, 0, 1);
  assert.equal(budget.acquire(4).ok, true);
  assert.equal(budget.snapshot().creditsUsedToday, 4);
});

test('run() shares one in-flight upstream call per key', async () => {
  const budget = createBudget({ perMinute: 10, now: () => 0 });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const task = async () => {
    calls += 1;
    await gate;
    return 'body';
  };
  const a = budget.run('same', task);
  const b = budget.run('same', task);
  release();
  assert.deepEqual(await Promise.all([a, b]), ['body', 'body']);
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().usedLastMinute, 1);
});

test('run() rejects without calling upstream when the budget refuses', async () => {
  const budget = createBudget({ perMinute: 1, now: () => 0 });
  await budget.run('a', async () => 'ok');
  let called = false;
  await assert.rejects(
    budget.run('b', async () => {
      called = true;
    }),
    (error) => error instanceof BudgetRefusedError && error.reason === 'rate',
  );
  assert.equal(called, false);
});

test('run() feeds UpstreamStatusError into backoff', async () => {
  const budget = createBudget({ perMinute: 10, now: () => 0, random: () => 0 });
  await assert.rejects(
    budget.run('a', async () => {
      throw new UpstreamStatusError(429, { retryAfterMs: 30_000 });
    }),
  );
  const snapshot = budget.snapshot();
  assert.equal(snapshot.blockReason, 'rate-limited');
  assert.equal(snapshot.blockedForMs, 30_000);
  assert.equal(snapshot.lastStatus, 429);
});

test('parseRetryAfterMs reads seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('30'), 30_000);
  assert.equal(parseRetryAfterMs(''), null);
  assert.equal(parseRetryAfterMs(null), null);
  const now = Date.UTC(2026, 8, 29, 12);
  assert.equal(parseRetryAfterMs(new Date(now + 5_000).toUTCString(), now), 5_000);
});
