'use strict';

const PROJECTILE_NAMES = new Set([
  'arrow', 'spectral_arrow', 'trident', 'fireball', 'small_fireball',
  'wither_skull', 'shulker_bullet', 'dragon_fireball', 'llama_spit',
  'snowball', 'egg', 'potion', 'experience_bottle'
]);

function findIncomingProjectile(entities, botPosition, options = {}) {
  if (!Array.isArray(entities) || !botPosition) return null;
  const maxDistance = Math.max(2, Number(options.maxDistance) || 12);
  const maxTicks = Math.max(1, Number(options.maxTicks) || 12);
  const hitRadius = Math.max(0.4, Number(options.hitRadius) || 1.35);
  let best = null;

  for (const entity of entities) {
    if (!entity || !PROJECTILE_NAMES.has(String(entity.name || '').toLowerCase()) ||
        !entity.position || !entity.velocity) continue;
    const px = Number(entity.position.x);
    const py = Number(entity.position.y);
    const pz = Number(entity.position.z);
    const vx = Number(entity.velocity.x);
    const vy = Number(entity.velocity.y);
    const vz = Number(entity.velocity.z);
    if (![px, py, pz, vx, vy, vz].every(Number.isFinite)) continue;

    const dx = Number(botPosition.x) - px;
    const dy = Number(botPosition.y) - py;
    const dz = Number(botPosition.z) - pz;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > maxDistance) continue;

    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq < 0.0025) continue;
    const timeToClosest = (dx * vx + dy * vy + dz * vz) / speedSq;
    if (timeToClosest <= 0 || timeToClosest > maxTicks) continue;

    const closestX = px + vx * timeToClosest;
    const closestY = py + vy * timeToClosest;
    const closestZ = pz + vz * timeToClosest;
    const missDistance = Math.hypot(
      Number(botPosition.x) - closestX,
      Number(botPosition.y) - closestY,
      Number(botPosition.z) - closestZ
    );
    if (missDistance > hitRadius) continue;

    const threat = { entity, name: String(entity.name).toLowerCase(), distance, timeToClosest, missDistance, velocity: { x: vx, y: vy, z: vz } };
    if (!best || threat.timeToClosest < best.timeToClosest ||
        (threat.timeToClosest === best.timeToClosest && threat.missDistance < best.missDistance)) best = threat;
  }
  return best;
}

function buildLateralDodgePoints(position, velocity, distance = 3.5) {
  if (!position || !velocity) return [];
  const vx = Number(velocity.x);
  const vz = Number(velocity.z);
  const magnitude = Math.hypot(vx, vz);
  if (!Number.isFinite(magnitude) || magnitude < 0.05) return [];
  const nx = -vz / magnitude;
  const nz = vx / magnitude;
  const currentX = Number(position.x);
  const currentY = Number(position.y);
  const currentZ = Number(position.z);
  if (![currentX, currentY, currentZ].every(Number.isFinite)) return [];
  return [
    { x: currentX + nx * distance, y: currentY, z: currentZ + nz * distance },
    { x: currentX - nx * distance, y: currentY, z: currentZ - nz * distance }
  ];
}

module.exports = { PROJECTILE_NAMES, findIncomingProjectile, buildLateralDodgePoints };
