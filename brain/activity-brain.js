'use strict';

const PRIORITIES = Object.freeze({
  emergency: 100,
  combat: 90,
  recovery: 80,
  investigate: 50,
  explore: 30,
  observe: 35,
  idle: 0
});

class ActivityBrain {
  constructor() {
    this.signals = new Map();
    this.current = 'idle';
    this.changedAt = Date.now();
    this.listeners = new Set();
    this.setSignal('explore', true);
  }

  setSignal(name, active, options = {}) {
    if (!(name in PRIORITIES)) return;
    if (!active) {
      this.signals.delete(name);
      this.update();
      return;
    }
    const ttlMs = Number(options.ttlMs);
    this.signals.set(name, {
      name,
      priority: PRIORITIES[name],
      until: Number.isFinite(ttlMs) && ttlMs > 0 ? Date.now() + ttlMs : Infinity,
      details: options.details || null
    });
    this.update();
  }

  update(now = Date.now()) {
    for (const [name, signal] of this.signals) {
      if (signal.until <= now) this.signals.delete(name);
    }
    const selected = [...this.signals.values()].sort((a, b) => b.priority - a.priority)[0];
    const next = selected ? selected.name : 'idle';
    if (next !== this.current) {
      const previous = this.current;
      this.current = next;
      this.changedAt = now;
      for (const listener of this.listeners) {
        try { listener({ previous, current: next, at: now, details: selected?.details || null }); } catch (_) {}
      }
    }
    return this.current;
  }

  isHigherPriorityThanExploration() {
    // Observation is a deliberate, short interruption: it pauses path planning
    // while the behavior looks at its target. Idle is not an interruption.
    return this.update() !== 'explore' && this.current !== 'idle';
  }

  onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    this.update();
    return { current: this.current, changedAt: this.changedAt, active: [...this.signals.keys()] };
  }
}

module.exports = { ActivityBrain, PRIORITIES };
