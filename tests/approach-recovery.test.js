'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApproachCandidates } = require('../combat/approach-recovery');

test('combat approach recovery offers varied flank positions around a target', () => {
  const candidates = buildApproachCandidates(
    { x: 0.5, y: 64, z: 0.5 },
    { x: 8.5, y: 64, z: 8.5 },
    0
  );
  assert.ok(candidates.length >= 8);
  assert.equal(new Set(candidates.map(({ x, y, z }) => `${x},${y},${z}`)).size, candidates.length);
  assert.ok(candidates.every((point) => Math.hypot(point.x - 8.5, point.z - 8.5) >= 1.8));
});

test('combat approach recovery rotates its candidate order after repeated blockages', () => {
  const botPosition = { x: 0, y: 64, z: 0 };
  const targetPosition = { x: 5, y: 64, z: 5 };
  const first = buildApproachCandidates(botPosition, targetPosition, 0);
  const second = buildApproachCandidates(botPosition, targetPosition, 1);
  assert.notDeepEqual(first.slice(0, 4), second.slice(0, 4));
});

test('invalid position samples do not create movement goals', () => {
  assert.deepEqual(buildApproachCandidates(null, { x: 0, y: 0, z: 0 }), []);
  assert.deepEqual(buildApproachCandidates({ x: 0, y: NaN, z: 0 }, { x: 0, y: 0, z: 0 }), []);
});
