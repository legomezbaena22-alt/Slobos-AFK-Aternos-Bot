'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ActivityBrain } = require('../brain/activity-brain');

test('brain starts in autonomous exploration without human presence signal', () => {
  const brain = new ActivityBrain();
  assert.equal(brain.current, 'explore');
});

test('higher-priority combat overrides exploration, then returns to exploration', () => {
  const brain = new ActivityBrain();
  brain.setSignal('combat', true);
  assert.equal(brain.current, 'combat');
  brain.setSignal('combat', false);
  assert.equal(brain.current, 'explore');
});

test('recovery signal temporarily outranks exploration and expires', () => {
  const brain = new ActivityBrain();
  brain.setSignal('recovery', true, { ttlMs: 10 });
  assert.equal(brain.current, 'recovery');
  assert.equal(brain.update(Date.now() + 20), 'explore');
});

test('emergency outranks combat and all lower activities', () => {
  const brain = new ActivityBrain();
  brain.setSignal('combat', true);
  brain.setSignal('emergency', true);
  assert.equal(brain.current, 'emergency');
});


test('short observation pause interrupts exploration without outranking recovery', () => {
  const brain = new ActivityBrain();
  brain.setSignal('observe', true, { ttlMs: 10 });
  assert.equal(brain.current, 'observe');
  brain.setSignal('recovery', true, { ttlMs: 100 });
  assert.equal(brain.current, 'recovery');
});


test('observation temporarily interrupts exploration and then yields back', () => {
  const brain = new ActivityBrain();
  brain.setSignal('observe', true, { ttlMs: 25, details: 'look at target' });
  assert.equal(brain.current, 'observe');
  assert.equal(brain.isHigherPriorityThanExploration(), true);
  assert.equal(brain.update(Date.now() + 30), 'explore');
  assert.equal(brain.isHigherPriorityThanExploration(), false);
});
