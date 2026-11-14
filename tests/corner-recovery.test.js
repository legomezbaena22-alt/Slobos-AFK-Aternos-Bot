'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCornerEscapeCandidates, canInterruptForCornerRecovery } = require('../navigation/corner-recovery');

test('corner recovery creates short lateral exits around a stationary bot', () => {
  const points = buildCornerEscapeCandidates({ x: 10.2, y: 64, z: -5.7 }, 0);
  assert.ok(points.length >= 8);
  assert.ok(points.every((point) => Math.hypot(point.x + 0.5 - 10.2, point.z + 0.5 + 5.7) >= 1.15));
  const directions = new Set(points.slice(0, 8).map((point) => `${Math.sign(point.x - 10)},${Math.sign(point.z + 6)}`));
  assert.ok(directions.size >= 4);
});

test('corner recovery rotates its first escape directions after repeated failures', () => {
  const origin = { x: 0.1, y: 70, z: 0.1 };
  const first = buildCornerEscapeCandidates(origin, 0);
  const second = buildCornerEscapeCandidates(origin, 1);
  assert.notDeepEqual(first.slice(0, 4).map(({ x, z }) => [x, z]), second.slice(0, 4).map(({ x, z }) => [x, z]));
});

test('corner recovery rejects invalid positions', () => {
  assert.deepEqual(buildCornerEscapeCandidates(null), []);
  assert.deepEqual(buildCornerEscapeCandidates({ x: NaN, y: 1, z: 2 }), []);
});


test('navigation recovery signal is allowed to run its own local corner escape', () => {
  assert.equal(canInterruptForCornerRecovery('recovery'), true);
  assert.equal(canInterruptForCornerRecovery('explore'), true);
  assert.equal(canInterruptForCornerRecovery('combat'), false);
  assert.equal(canInterruptForCornerRecovery('emergency'), false);
  assert.equal(canInterruptForCornerRecovery('investigate'), false);
  assert.equal(canInterruptForCornerRecovery('observe'), false);
});
