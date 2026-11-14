'use strict';

/**
 * Keep the current hostile target during brief line-of-sight interruptions.
 * The caller still checks visibility before issuing an attack, so this only
 * prevents combat state and weapon selection from dropping between scans.
 */
function selectCombatTarget({
  visibleTargets = [],
  activeTarget = null,
  currentTargetId = null,
  lastConfirmedAt = 0,
  now = Date.now(),
  combatRadius = 16,
  lostGraceMs = 6000,
  distanceTo = () => Infinity
} = {}) {
  const activeIsTracked = activeTarget &&
    activeTarget.id === currentTargetId &&
    activeTarget.position;

  if (activeIsTracked && now - lastConfirmedAt <= lostGraceMs) {
    const distance = distanceTo(activeTarget);
    if (Number.isFinite(distance) && distance <= combatRadius) return activeTarget;
  }

  if (!Array.isArray(visibleTargets) || visibleTargets.length === 0) return null;
  return visibleTargets.find((entity) => String(entity && entity.name || '').toLowerCase() === 'creeper') ||
    visibleTargets[0] || null;
}

module.exports = { selectCombatTarget };
