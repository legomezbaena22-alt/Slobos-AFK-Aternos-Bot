'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findIncomingProjectile, buildLateralDodgePoints } = require('../combat/projectile-defense');

test('incoming arrow aimed through Manji is identified as a projectile threat', () => {
  const arrow = {
    name: 'arrow',
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 1, y: 0, z: 0 }
  };
  const threat = findIncomingProjectile([arrow], { x: 5, y: 1, z: 0 });
  assert.ok(threat);
  assert.equal(threat.name, 'arrow');
  assert.ok(threat.timeToClosest > 0 && threat.timeToClosest <= 12);
});

test('projectiles moving away or passing far to the side are ignored', () => {
  const away = { name: 'arrow', position: { x: 0, y: 1, z: 0 }, velocity: { x: -1, y: 0, z: 0 } };
  const miss = { name: 'arrow', position: { x: 0, y: 1, z: 0 }, velocity: { x: 1, y: 0, z: 0 } };
  assert.equal(findIncomingProjectile([away], { x: 5, y: 1, z: 0 }), null);
  assert.equal(findIncomingProjectile([miss], { x: 5, y: 1, z: 5 }), null);
});

test('lateral dodge planner returns two opposite safe-side candidates', () => {
  const points = buildLateralDodgePoints({ x: 0, y: 64, z: 0 }, { x: 1, y: 0, z: 0 }, 3);
  assert.equal(points.length, 2);
  assert.equal(points[0].x, 0);
  assert.equal(points[1].x, 0);
  assert.equal(points[0].z, 3);
  assert.equal(points[1].z, -3);
});
