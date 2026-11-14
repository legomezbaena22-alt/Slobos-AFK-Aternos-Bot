'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planWaypointWithFallback } = require('../navigation/waypoint-recovery');

test('waypoint recovery returns primary route without probing detours when reachable', async () => {
  const calls = [];
  const primary = [{ x: 1, y: 64, z: 1 }];
  const fallback = [{ x: 2, y: 64, z: 2 }];
  const result = await planWaypointWithFallback({
    routePlanner: { async choose(candidates) { calls.push(candidates); return candidates[0]; } },
    primaryCandidates: primary,
    fallbackCandidates: fallback,
    currentPosition: { x: 0, y: 64, z: 0 }
  });
  assert.deepEqual(result, { ...primary[0], recoveryDetour: false });
  assert.equal(calls.length, 1);
});

test('waypoint recovery probes short-range detour when primary routes fail', async () => {
  const calls = [];
  const fallback = [{ x: -2, y: 64, z: 1 }];
  const result = await planWaypointWithFallback({
    routePlanner: { async choose(candidates) { calls.push(candidates); return calls.length === 1 ? null : candidates[0]; } },
    primaryCandidates: [{ x: 8, y: 64, z: 8 }],
    fallbackCandidates: fallback,
    currentPosition: { x: 0, y: 64, z: 0 }
  });
  assert.deepEqual(result, { ...fallback[0], recoveryDetour: true });
  assert.equal(calls.length, 2);
});

test('waypoint recovery returns null when both candidate batches fail', async () => {
  const result = await planWaypointWithFallback({
    routePlanner: { async choose() { return null; } },
    primaryCandidates: [{ x: 1, y: 64, z: 1 }],
    fallbackCandidates: [{ x: -1, y: 64, z: -1 }],
    currentPosition: { x: 0, y: 64, z: 0 }
  });
  assert.equal(result, null);
});
