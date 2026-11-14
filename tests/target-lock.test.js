'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCombatTarget } = require('../combat/target-lock');

const distanceTo = (entity) => entity.distance;

test('combat target remains locked during a short line-of-sight interruption', () => {
  const active = { id: 7, name: 'zombie', position: {}, distance: 5 };
  const selected = selectCombatTarget({
    visibleTargets: [],
    activeTarget: active,
    currentTargetId: 7,
    lastConfirmedAt: 10000,
    now: 12000,
    combatRadius: 16,
    lostGraceMs: 6500,
    distanceTo
  });
  assert.equal(selected, active);
});

test('combat target lock expires after the grace period or when the target leaves combat range', () => {
  const active = { id: 7, name: 'zombie', position: {}, distance: 5 };
  assert.equal(selectCombatTarget({
    visibleTargets: [], activeTarget: active, currentTargetId: 7,
    lastConfirmedAt: 10000, now: 17000, combatRadius: 16,
    lostGraceMs: 6500, distanceTo
  }), null);

  active.distance = 20;
  assert.equal(selectCombatTarget({
    visibleTargets: [], activeTarget: active, currentTargetId: 7,
    lastConfirmedAt: 10000, now: 12000, combatRadius: 16,
    lostGraceMs: 6500, distanceTo
  }), null);
});

test('creeper receives priority when there is no valid active target lock', () => {
  const zombie = { id: 1, name: 'zombie' };
  const creeper = { id: 2, name: 'creeper' };
  assert.equal(selectCombatTarget({ visibleTargets: [zombie, creeper] }), creeper);
});
