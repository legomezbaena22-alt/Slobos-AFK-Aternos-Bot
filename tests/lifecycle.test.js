'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('uncaught process failures save memory, release lock and exit non-zero', () => {
  assert.match(source, /process\.on\('uncaughtException',\s*\(error\)\s*=>\s*\{\s*fatalProcessShutdown\('uncaughtException',\s*error\)/);
  assert.match(source, /function fatalProcessShutdown\(/);
  assert.match(source, /void manjiMemory\.save\(\)/);
  assert.match(source, /releaseProcessLock\(\)/);
  assert.match(source, /process\.exit\(1\)/);
});

test('normal Minecraft end events still own exponential-backoff reconnects', () => {
  const endHandlerStart = source.indexOf("bot.on(\"end\"");
  assert.notEqual(endHandlerStart, -1);
  const endHandler = source.slice(endHandlerStart, source.indexOf('bot.on("error"', endHandlerStart));
  assert.match(endHandler, /scheduleReconnect\(\)/);
  assert.match(source, /Math\.pow\(2, botState\.reconnectAttempts\)/);
});
