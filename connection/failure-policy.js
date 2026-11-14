'use strict';

function reasonText(reason) {
  if (reason instanceof Error) return `${reason.name}: ${reason.message} ${reason.code || ''}`;
  if (typeof reason === 'string') return reason;
  try { return JSON.stringify(reason); } catch (_) { return String(reason); }
}

function isPermanentConnectionFailure(reason) {
  const text = reasonText(reason).toLowerCase();
  return /unsupported protocol version|outdated client|outdated server|incompatible protocol|invalid session|not authenticated with minecraft\.net|failed to verify username|not whitelisted|you are banned|banned from this server|multiplayer\.disconnect\.banned|multiplayer\.disconnect\.not_whitelisted|invalid username/.test(text);
}

function isRecoverableNetworkFailure(reason) {
  if (isPermanentConnectionFailure(reason)) return false;
  const source = reason && typeof reason === 'object' ? String(reason.code || '') : '';
  const text = `${source} ${reasonText(reason)}`.toLowerCase();
  return /\b(econnreset|econnrefused|econnaborted|etimedout|ehostunreach|enetunreach|enotfound|eai_again|epipe|econn|und_err_connect_timeout)\b|partialreaderror|socket has been ended|connection reset|connection closed unexpectedly|timed out|temporary failure in name resolution/.test(text);
}

function reconnectAfterKick(reason) {
  return !isPermanentConnectionFailure(reason);
}

module.exports = { isPermanentConnectionFailure, isRecoverableNetworkFailure, reconnectAfterKick };
