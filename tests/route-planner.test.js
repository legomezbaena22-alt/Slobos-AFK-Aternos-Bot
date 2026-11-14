'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeCost } = require('../navigation/route-planner');

function pos(x, y, z) { return { x, y, z }; }

test('route scorer penalizes extra vertical climbing', () => {
  const current = { floored: () => pos(0, 64, 0) };
  const flat = { status: 'success', path: [pos(1, 64, 0), pos(2, 64, 0)], cost: 2 };
  const climb = { status: 'success', path: [pos(1, 65, 0), pos(2, 66, 0)], cost: 2 };
  assert.ok(routeCost({ localScore: 0 }, climb, current, null) > routeCost({ localScore: 0 }, flat, current, null));
});

test('route scorer penalizes partial paths and revisits without forbidding them', () => {
  const current = { floored: () => pos(0, 64, 0) };
  const path = { status: 'success', path: [pos(1, 64, 0)], cost: 1 };
  const partial = { status: 'partial', path: [pos(1, 64, 0)], cost: 1 };
  assert.ok(routeCost({ localScore: 0 }, partial, current, null) > routeCost({ localScore: 0 }, path, current, null));
});

test('incremental planner yields between A* slices and selects the lowest-cost reachable option', async () => {
  const { RoutePlanner } = require('../navigation/route-planner');
  const seenGoals = [];
  const pathfinder = {
    getPathFromTo(movements, start, goal) {
      seenGoals.push(goal);
      const highCost = goal.x === 10;
      return (function* () {
        yield { result: { status: 'partial', path: [pos(1, 64, 0)], cost: 2 }, astarContext: {} };
        yield { result: { status: 'success', path: [pos(1, 64, 0), pos(2, 64, 0)], cost: highCost ? 12 : 3 }, astarContext: {} };
      })();
    }
  };
  const planner = new RoutePlanner({
    pathfinder, movements: {}, memory: null, candidates: 2, totalTimeoutMs: 1000,
    goalFactory: (x, y, z, range) => ({ x, y, z, range })
  });
  const current = { floored: () => pos(0, 64, 0) };
  const result = await planner.choose([
    { x: 10, y: 64, z: 0, localScore: 0 },
    { x: 2, y: 64, z: 0, localScore: 0 }
  ], current);
  assert.equal(seenGoals.length, 2);
  assert.equal(result.x, 2);
  assert.equal(result.previewStatus, 'success');
});
