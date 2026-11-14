'use strict';

/**
 * Build a small, rotating set of candidate feet positions around the bot.
 * It does not assert that a position is safe; callers must check blocks and
 * ask Pathfinder A* whether the point is reachable before using it.
 */
function buildCornerEscapeCandidates(position, cycle = 0) {
  if (!position || ![position.x, position.y, position.z].every((value) => Number.isFinite(Number(value)))) return [];
  const directions = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [-1, -1], [1, -1]
  ];
  const offset = ((Math.trunc(cycle) || 0) % directions.length + directions.length) % directions.length;
  const radii = [1.6, 2.4, 3.2];
  const y = Math.floor(position.y);
  const yLevels = [y, y + 1, y - 1];
  const out = [];
  const seen = new Set();

  // Test all horizontal bearings at the current height before changing levels.
  for (const radius of radii) {
    for (const dy of yLevels) {
      for (let i = 0; i < directions.length; i++) {
        const [dx, dz] = directions[(i + offset) % directions.length];
        const length = Math.hypot(dx, dz) || 1;
        const x = Math.floor(position.x + (dx / length) * radius);
        const z = Math.floor(position.z + (dz / length) * radius);
        const key = `${x},${dy},${z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const distance = Math.hypot((x + 0.5) - position.x, (z + 0.5) - position.z);
        if (distance < 1.15 || distance > 4.5) continue;
        out.push({ x, y: dy, z, radius, localScore: distance + Math.abs(dy - position.y) * 1.8 });
      }
    }
  }
  return out;
}

function canInterruptForCornerRecovery(activity) {
  // 'recovery' is the signal raised by the navigation watchdog itself, so it
  // must be allowed to run the escape maneuver. Only true higher-priority
  // behaviors retain control of Pathfinder.
  return !['emergency', 'combat', 'investigate', 'observe'].includes(String(activity || 'explore'));
}

module.exports = { buildCornerEscapeCandidates, canInterruptForCornerRecovery };
