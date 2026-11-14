'use strict';

/**
 * Try normal exploration waypoints first, then a short-range local detour.
 * The fallback never creates movement on its own: every candidate must pass
 * the same pathfinder pre-check as a normal waypoint.
 */
async function planWaypointWithFallback({ routePlanner, primaryCandidates, fallbackCandidates, currentPosition }) {
  if (!routePlanner || typeof routePlanner.choose !== 'function') {
    throw new TypeError('routePlanner.choose must be a function');
  }
  const primary = Array.isArray(primaryCandidates) ? primaryCandidates : [];
  const fallback = Array.isArray(fallbackCandidates) ? fallbackCandidates : [];

  if (primary.length) {
    const selected = await routePlanner.choose(primary, currentPosition);
    if (selected) return { ...selected, recoveryDetour: false };
  }

  if (fallback.length) {
    const selected = await routePlanner.choose(fallback, currentPosition);
    if (selected) return { ...selected, recoveryDetour: true };
  }

  return null;
}

module.exports = { planWaypointWithFallback };
