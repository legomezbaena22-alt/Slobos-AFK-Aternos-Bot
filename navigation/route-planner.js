'use strict';


function routeCost(candidate, computed, currentPosition, memory, now = Date.now()) {
  const route = Array.isArray(computed?.path) ? computed.path : [];
  if (!route.length) return Infinity;
  let rises = 0;
  let drops = 0;
  let turns = 0;
  let revisits = 0;
  let previous = currentPosition.floored();
  let previousDirection = null;
  for (const node of route) {
    const dx = Math.sign(node.x - previous.x);
    const dz = Math.sign(node.z - previous.z);
    const dy = node.y - previous.y;
    if (dy > 0) rises += dy;
    if (dy < 0) drops += Math.abs(dy);
    if (previousDirection && (dx !== previousDirection.x || dz !== previousDirection.z)) turns++;
    if (dx || dz) previousDirection = { x: dx, z: dz };
    if (memory && Number.isFinite(memory.visitAge({ x: node.x, y: node.y, z: node.z }, now))) revisits++;
    previous = node;
  }
  const base = Number.isFinite(Number(computed.cost)) ? Number(computed.cost) : route.length;
  const partialPenalty = computed.status === 'success' ? 0 : 4;
  const local = Number(candidate.localScore) || 0;
  return base + local * 0.18 + rises * 2.1 + drops * 0.7 + turns * 0.28 + revisits * 0.8 + partialPenalty;
}

/**
 * Incremental path probes. Each call to generator.next() is bounded by tickTimeout,
 * so candidate evaluation yields to the Node.js event loop instead of executing
 * several long synchronous getPathTo() calls in one navigation tick.
 */
class RoutePlanner {
  constructor({ pathfinder, movements, memory, candidates = 4, totalTimeoutMs = 1400, tickTimeoutMs = 4, goalFactory = null }) {
    this.pathfinder = pathfinder;
    this.movements = movements;
    this.memory = memory;
    this.candidates = Math.max(1, Math.min(6, candidates));
    this.totalTimeoutMs = Math.max(250, totalTimeoutMs);
    this.tickTimeoutMs = Math.max(1, Math.min(10, tickTimeoutMs));
    this.goalFactory = goalFactory;
    this.cancelled = false;
  }

  cancel() { this.cancelled = true; }

  async choose(points, currentPosition) {
    this.cancelled = false;
    const makeGoal = this.goalFactory || ((x, y, z, range) => {
      const Goal = require('mineflayer-pathfinder').goals.GoalNear;
      return new Goal(x, y, z, range);
    });
    const selected = points.slice(0, this.candidates);
    let best = null;
    const deadline = Date.now() + this.totalTimeoutMs;
    for (const candidate of selected) {
      if (this.cancelled || Date.now() >= deadline) break;
      if (!this.pathfinder || typeof this.pathfinder.getPathFromTo !== 'function') {
        // Fallback is deliberately one short synchronous probe, never a batch.
        if (typeof this.pathfinder?.getPathTo !== 'function') return points[0] || null;
        let preview;
        try { preview = this.pathfinder.getPathTo(this.movements, makeGoal(candidate.x, candidate.y, candidate.z, 1), 80); }
        catch (_) { continue; }
        if (!preview || !['success', 'partial'].includes(preview.status) || !preview.path?.length) continue;
        const score = routeCost(candidate, preview, currentPosition, this.memory);
        if (!best || score < best.score) best = { point: candidate, score, status: preview.status, length: preview.path.length };
        continue;
      }

      const goal = makeGoal(candidate.x, candidate.y, candidate.z, 1);
      let iterator;
      try {
        iterator = this.pathfinder.getPathFromTo(this.movements, currentPosition, goal, {
          timeout: Math.max(100, Math.min(450, deadline - Date.now())),
          tickTimeout: this.tickTimeoutMs,
          optimizePath: true
        });
      } catch (_) { continue; }

      let finalResult = null;
      while (!this.cancelled && Date.now() < deadline) {
        let step;
        try { step = iterator.next(); }
        catch (_) { break; }
        if (!step) break;
        const result = step.value && step.value.result ? step.value.result : step.value;
        if (result && ['success', 'noPath', 'timeout'].includes(result.status)) {
          finalResult = result;
          break;
        }
        if (step.done) {
          finalResult = result || finalResult;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (this.cancelled) return null;
      if (!finalResult || !['success', 'partial'].includes(finalResult.status) || !finalResult.path?.length) continue;
      const score = routeCost(candidate, finalResult, currentPosition, this.memory);
      if (!best || score < best.score) {
        best = { point: candidate, score, status: finalResult.status, length: finalResult.path.length };
      }
    }
    if (!best) return null;
    return { ...best.point, previewStatus: best.status, previewLength: best.length, routeScore: best.score };
  }
}

module.exports = { RoutePlanner, routeCost };
