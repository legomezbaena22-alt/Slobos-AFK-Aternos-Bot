'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPermanentConnectionFailure,
  isRecoverableNetworkFailure,
  reconnectAfterKick,
} = require('../connection/failure-policy');

test('transient socket and DNS errors are retryable', () => {
  assert.equal(isRecoverableNetworkFailure(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })), true);
  assert.equal(isRecoverableNetworkFailure(Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' })), true);
});

test('protocol and authentication failures are permanent, not transient network errors', () => {
  assert.equal(isPermanentConnectionFailure(new Error('unsupported protocol version: 26.3')), true);
  assert.equal(isRecoverableNetworkFailure(new Error('unsupported protocol version: 26.3')), false);
  assert.equal(isPermanentConnectionFailure('Invalid session (try restarting your game)'), true);
});

test('permanent bans and whitelist kicks stop automatic reconnect attempts', () => {
  assert.equal(reconnectAfterKick('You are banned from this server'), false);
  assert.equal(reconnectAfterKick({ translate: 'multiplayer.disconnect.not_whitelisted' }), false);
  assert.equal(reconnectAfterKick('Server closed'), true);
});
