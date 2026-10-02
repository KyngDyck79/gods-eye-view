import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAge,
  overallStatus,
  providerDetailLines,
  statusLabel,
} from './systemStatus.js';

test('the chip shows the worst live status and ignores disabled providers', () => {
  assert.equal(overallStatus([{ status: 'ONLINE' }, { status: 'DEGRADED' }]), 'DEGRADED');
  assert.equal(overallStatus([{ status: 'ONLINE' }, { status: 'OFFLINE' }, { status: 'RATE_LIMITED' }]), 'OFFLINE');
  assert.equal(overallStatus([{ status: 'DISABLED' }, { status: 'ONLINE' }]), 'ONLINE');
  assert.equal(overallStatus([]), 'IDLE');
});

test('ages read in seconds, minutes and hours', () => {
  const now = 1_000_000_000;
  assert.equal(formatAge(now - 12_000, now), '12 s ago');
  assert.equal(formatAge(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatAge(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(formatAge(null, now), 'never');
});

test('status labels are readable', () => {
  assert.equal(statusLabel('RATE_LIMITED'), 'RATE LIMITED');
  assert.equal(statusLabel('NEEDS_KEY'), 'NEEDS KEY');
});

test('detail lines show timing, budget use and terms without secrets', () => {
  const now = 1_000_000_000;
  const lines = providerDetailLines(
    {
      lastSuccessAt: now - 4_000,
      latencyMs: 612,
      lastErrorAt: null,
      budget: { usedLastMinute: 3, perMinute: 6, dailyCredits: 4000, creditsUsedToday: 12, creditsRemaining: 640, blockedForMs: 0 },
      cost: 'Free for research and non-commercial use',
      license: 'OpenSky Network terms of use (non-commercial)',
      commercialUse: 'not-allowed',
    },
    now,
  );
  assert.deepEqual(lines, [
    'Last success 4 s ago · 612 ms',
    '3/6 requests this minute · 12 credits used today, 640 left',
    'Free for research and non-commercial use · OpenSky Network terms of use (non-commercial) · commercial use: not-allowed',
  ]);
});
