'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SensorSuite } = require('../perception/sensor-suite');

test('sensor snapshot records zero human players without disabling observation', () => {
  const position = { x: 1, y: 64, z: 2, distanceTo: (other) => Math.hypot(other.x - 1, other.y - 64, other.z - 2), floored: () => ({ x: 1, y: 64, z: 2, offset: (x, y, z) => ({ x: 1 + x, y: 64 + y, z: 2 + z }) }) };
  const bot = {
    entity: { id: 1, position }, entities: {}, health: 20, food: 20,
    blockAt: (p) => p.y === 64 ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }
  };
  const sensors = new SensorSuite(bot, null);
  const snapshot = sensors.scan();
  assert.equal(snapshot.playersOnline, 0);
  assert.equal(snapshot.health, 20);
  assert.equal(snapshot.inLiquid, false);
});


test('repeated zero-human scans continue to update the autonomous activity and spatial memory', () => {
  const { ActivityBrain } = require('../brain/activity-brain');
  const { AgentMemory } = require('../memory/agent-memory');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'manji-no-human-'));
  const memory = new AgentMemory({ filePath: path.join(directory, 'memory.json') });
  const position = {
    x: 1, y: 64, z: 2,
    distanceTo: (other) => Math.hypot(other.x - 1, other.y - 64, other.z - 2),
    floored: () => ({ x: 1, y: 64, z: 2, offset: (x, y, z) => ({ x: 1 + x, y: 64 + y, z: 2 + z }) })
  };
  const bot = {
    entity: { id: 1, position }, entities: {}, health: 20, food: 20,
    blockAt: (p) => p.y === 64 ? { name: 'air', boundingBox: 'empty' } : { name: 'stone', boundingBox: 'block' }
  };
  const brain = new ActivityBrain();
  const sensors = new SensorSuite(bot, memory);
  for (let i = 0; i < 3; i++) {
    const snapshot = sensors.scan();
    assert.equal(snapshot.playersOnline, 0);
    brain.update();
  }
  assert.equal(brain.current, 'explore');
  assert.ok(memory.visitAge(position) < Infinity);
  fs.rmSync(directory, { recursive: true, force: true });
});
