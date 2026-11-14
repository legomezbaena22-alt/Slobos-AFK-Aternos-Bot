'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCombatDetourCandidates } = require('../navigation/combat-detour');

test('combat detours begin around the bot rather than only around the hostile', () => {
  const points = buildCombatDetourCandidates(
    { x: 0.5, y: 64, z: 0.5 },
    { x: 8.5, y: 64, z: 0.5 }
  );
  assert.ok(points.length >= 16);
  assert.ok(points.every((point) => Math.hypot(point.x + 0.5 - 0.5, point.z + 0.5 - 0.5) <= 4));
  assert.ok(points.some((point) => point.z < 0));
});

test('combat detour ordering rotates after repeated corner collisions', () => {
  const bot = { x: 0.5, y: 64, z: 0.5 };
  const target = { x: 8.5, y: 64, z: 0.5 };
  const a = buildCombatDetourCandidates(bot, target, 0).slice(0, 6);
  const b = buildCombatDetourCandidates(bot, target, 1).slice(0, 6);
  assert.notDeepEqual(a.map(({ x, y, z }) => `${x},${y},${z}`), b.map(({ x, y, z }) => `${x},${y},${z}`));
});

test('invalid combat detour positions return no goals', () => {
  assert.deepEqual(buildCombatDetourCandidates(null, { x: 1, y: 64, z: 1 }), []);
  assert.deepEqual(buildCombatDetourCandidates({ x: NaN, y: 64, z: 0 }, { x: 1, y: 64, z: 1 }), []);
});


test('first detour probes cover several horizontal directions before alternate heights', () => {
  const points = buildCombatDetourCandidates(
    { x: 0.5, y: 64, z: 0.5 },
    { x: 8.5, y: 64, z: 0.5 }
  ).slice(0, 6);
  assert.equal(new Set(points.map(({ x, z }) => `${x},${z}`)).size, 6);
  assert.ok(points.every((point) => point.y === 64));
});
