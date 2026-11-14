'use strict';

/**
 * Produce short lateral/back-step points around the bot itself. These are
 * deliberately separate from target-side flank points: the first objective is
 * to get the bot's hitbox clear of the corner it is pressing against.
 */
function buildCombatDetourCandidates(botPosition, targetPosition, cycle = 0) {
  if (!botPosition || !targetPosition ||
      ![botPosition.x, botPosition.y, botPosition.z, targetPosition.x, targetPosition.y, targetPosition.z]
        .every((value) => Number.isFinite(Number(value)))) return [];

  const towardTarget = Math.atan2(targetPosition.z - botPosition.z, targetPosition.x - botPosition.x);
  const lateralOrder = [Math.PI / 2, -Math.PI / 2, Math.PI, 3 * Math.PI / 4, -3 * Math.PI / 4, 0, Math.PI / 4, -Math.PI / 4];
  const rotation = ((Math.trunc(cycle) || 0) % lateralOrder.length + lateralOrder.length) % lateralOrder.length;
  const radii = [1.5, 2.5, 3.25];
  const yLevels = [...new Set([Math.floor(botPosition.y), Math.floor(botPosition.y) + 1, Math.floor(botPosition.y) - 1])];
  const result = [];
  const seen = new Set();

  for (const radius of radii) {
    // Spread the first candidates across different horizontal bearings. The
    // route planner only probes a bounded number of points per recovery pass;
    // testing three Y levels for one bearing first would waste that budget.
    for (const y of yLevels) {
      for (let i = 0; i < lateralOrder.length; i++) {
        const angle = towardTarget + lateralOrder[(i + rotation) % lateralOrder.length];
        const x = Math.floor(botPosition.x + Math.cos(angle) * radius);
        const z = Math.floor(botPosition.z + Math.sin(angle) * radius);
        const key = `${x},${y},${z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const targetDistance = Math.hypot(targetPosition.x - (x + 0.5), targetPosition.z - (z + 0.5));
        const displacement = Math.hypot((x + 0.5) - botPosition.x, (z + 0.5) - botPosition.z);
        result.push({ x, y, z, radius, angle, localScore: targetDistance + displacement * 0.12 + Math.abs(y - botPosition.y) * 1.6 });
      }
    }
  }

  return result;
}

module.exports = { buildCombatDetourCandidates };
