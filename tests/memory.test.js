'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentMemory, cellKey } = require('../memory/agent-memory');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'manji-memory-test-')), 'memory.json');
}

test('cell keys quantize positions into two-block memory cells', () => {
  assert.equal(cellKey({ x: 1.9, y: 64.2, z: -1.1 }), '0,64,-1');
});

test('visited and failed areas are remembered and can expire', async () => {
  const filePath = tempFile();
  const memory = new AgentMemory({ filePath, visitedTtlMs: 1000 });
  const point = { x: 8.2, y: 70, z: -4.1 };
  const now = Date.now();
  memory.markVisited(point, now);
  assert.equal(memory.visitAge(point, now + 500), 500);
  memory.markFailed(point, 'blocked', 5000, now);
  assert.equal(memory.isFailed(point, now + 100), true);
  assert.equal(memory.isFailed(point, now + 6000), false);
  await memory.save();
  const restored = new AgentMemory({ filePath, visitedTtlMs: 1000 });
  assert.equal(restored.visitAge(point, now + 500), 500);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('memory persists observations and bounded operational statistics', async () => {
  const filePath = tempFile();
  const memory = new AgentMemory({ filePath });
  memory.observeEntity({ name: 'zombie', type: 'hostile', position: { x: 4, y: 64, z: 9 } }, Date.now());
  memory.increment('routesStarted');
  memory.setSession({ x: 1, y: 2, z: 3 }, 'explore');
  await memory.save();
  const restored = new AgentMemory({ filePath });
  assert.equal(restored.data.observations.zombie.sightings, 1);
  assert.equal(restored.data.statistics.routesStarted, 1);
  assert.equal(restored.data.session.lastActivity, 'explore');
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('player observations do not persist player names', () => {
  const memory = new AgentMemory({ filePath: tempFile() });
  memory.observeEntity({ name: 'player', username: 'secretName', type: 'player', position: { x: 2, y: 3, z: 4 } });
  assert.ok(memory.data.observations.player);
  assert.equal(JSON.stringify(memory.data).includes('secretName'), false);
});


test('observations expire independently of the visited-cell cache', () => {
  const filePath = tempFile();
  const memory = new AgentMemory({ filePath, observationTtlMs: 60_000 });
  const oldAt = Date.now() - 90_000;
  memory.observeEntity({ name: 'skeleton', type: 'hostile', position: { x: 1, y: 64, z: 2 } }, oldAt);
  memory.observeEntity({ name: 'zombie', type: 'hostile', position: { x: 2, y: 64, z: 3 } }, Date.now());
  memory.prune(Date.now());
  assert.equal(memory.data.observations.skeleton, undefined);
  assert.ok(memory.data.observations.zombie);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('corrupt memory is copied aside before recovery starts with an empty store', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ invalid json');
  const memory = new AgentMemory({ filePath });
  assert.deepEqual(memory.data.visited, {});
  const backups = fs.readdirSync(path.dirname(filePath)).filter((name) => name.startsWith('memory.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(filePath), backups[0]), 'utf8'), '{ invalid json');
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});
