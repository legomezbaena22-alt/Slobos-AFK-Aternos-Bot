'use strict';

// Deprecated compatibility shim. Manji v12 must never schedule voluntary
// disconnects. Connection recovery is owned exclusively by index.js and runs
// only after a real disconnect/error event.
function setupLeaveRejoin() {
  console.warn('[Manji] leaveRejoin.js is deprecated and intentionally disabled.');
  return function cleanup() {};
}

module.exports = setupLeaveRejoin;
