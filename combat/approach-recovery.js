'use strict';

const ANGLES = Object.freeze([0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
  (3 * Math.PI) / 4, -(3 * Math.PI) / 4, Math.PI]);

function buildApproachCandidates(botPosition, targetPosition, cycle = 0) {
  if (!botPosition || !targetPosition ||
      ![botPosition.x, botPosition.y, botPosition.z, targetPosition.x, targetPosition.y, targetPosition.z]
        .every((value) => Number.isFinite(Number(value)))) return [];

  const awayAngle = Math.atan2(botPosition.z - targetPosition.z, botPosition.x - targetPosition.x);
  const rotation = (Math.trunc(cycle) || 0) % ANGLES.length;
  const radii = [3.1, 4.2];
  const yLevels = [...new Set([Math.floor(targetPosition.y), Math.floor(botPosition.y)])];
  const result = [];
  const seen = new Set();

  for (let index = 0; index < ANGLES.length; index++) {
    const offset = ANGLES[(index + rotation) % ANGLES.length];
    const angle = awayAngle + offset;
    for (const radius of radii) {
      const x = Math.floor(targetPosition.x + Math.cos(angle) * radius);
      const z = Math.floor(targetPosition.z + Math.sin(angle) * radius);
      for (const y of yLevels) {
        const key = `${x},${y},${z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ x, y, z, radius, angle });
      }
    }
  }
  return result;
}

module.exports = { buildApproachCandidates };
