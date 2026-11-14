'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FORMAT_VERSION = 1;
const MAX_VISITED = 1800;
const MAX_FAILED = 500;
const MAX_OBSERVATIONS = 160;
const DEFAULT_VISITED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OBSERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cellKey(position, size = 2) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
  return `${Math.floor(position.x / size)},${Math.floor(position.y)},${Math.floor(position.z / size)}`;
}

function trimOldest(object, maxEntries, timestampField = 'at') {
  const entries = Object.entries(object || {});
  if (entries.length <= maxEntries) return object;
  entries.sort((a, b) => (Number(a[1]?.[timestampField]) || 0) - (Number(b[1]?.[timestampField]) || 0));
  for (const [key] of entries.slice(0, entries.length - maxEntries)) delete object[key];
  return object;
}

class AgentMemory {
  constructor(options = {}) {
    if (!options.filePath) throw new TypeError('AgentMemory requires filePath');
    this.filePath = path.resolve(options.filePath);
    this.visitedTtlMs = Math.max(60_000, Number(options.visitedTtlMs) || DEFAULT_VISITED_TTL_MS);
    this.observationTtlMs = Math.max(60_000, Number(options.observationTtlMs) || DEFAULT_OBSERVATION_TTL_MS);
    this.maxVisited = Math.max(100, Number(options.maxVisited) || MAX_VISITED);
    this.maxFailed = Math.max(50, Number(options.maxFailed) || MAX_FAILED);
    this.maxObservations = Math.max(20, Number(options.maxObservations) || MAX_OBSERVATIONS);
    this.data = {
      formatVersion: FORMAT_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      visited: {},
      failed: {},
      observations: {},
      statistics: { routesStarted: 0, routesReached: 0, routesAbandoned: 0, recoveryAttempts: 0 },
      session: { lastPosition: null, lastActivity: 'idle', savedAt: null }
    };
    this.dirty = false;
    this.savePromise = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return false;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.formatVersion !== FORMAT_VERSION) {
        throw new Error(`Unsupported memory format version: ${parsed?.formatVersion}`);
      }
      this.data = {
        ...this.data,
        ...parsed,
        visited: parsed.visited && typeof parsed.visited === 'object' ? parsed.visited : {},
        failed: parsed.failed && typeof parsed.failed === 'object' ? parsed.failed : {},
        observations: parsed.observations && typeof parsed.observations === 'object' ? parsed.observations : {},
        statistics: { ...this.data.statistics, ...(parsed.statistics || {}) },
        session: { ...this.data.session, ...(parsed.session || {}) }
      };
      this.prune();
      return true;
    } catch (error) {
      // Preserve corrupt or incompatible memory before the next successful save.
      // This avoids silently destroying the only diagnostic/recovery copy.
      try {
        if (fs.existsSync(this.filePath)) {
          const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
          fs.copyFileSync(this.filePath, backupPath, fs.constants.COPYFILE_EXCL);
          console.warn(`[Memory] Preserved unreadable memory at ${backupPath}`);
        }
      } catch (backupError) {
        console.warn(`[Memory] Could not preserve unreadable memory: ${backupError.message}`);
      }
      console.warn(`[Memory] Could not load persistent memory (${error.message}); starting with an empty memory.`);
      return false;
    }
  }

  prune(now = Date.now()) {
    for (const [key, entry] of Object.entries(this.data.visited)) {
      if (!entry || now - Number(entry.at || 0) > this.visitedTtlMs) delete this.data.visited[key];
    }
    for (const [key, entry] of Object.entries(this.data.failed)) {
      if (!entry || Number(entry.until || 0) <= now) delete this.data.failed[key];
    }
    for (const [key, entry] of Object.entries(this.data.observations)) {
      if (!entry || now - Number(entry.at || 0) > this.observationTtlMs) delete this.data.observations[key];
    }
    trimOldest(this.data.visited, this.maxVisited);
    trimOldest(this.data.failed, this.maxFailed, 'at');
    trimOldest(this.data.observations, this.maxObservations);
  }

  markVisited(position, at = Date.now()) {
    const key = cellKey(position);
    if (!key) return;
    this.data.visited[key] = { at };
    this.prune(at);
    this.touch();
  }

  visitAge(position, now = Date.now()) {
    const key = cellKey(position);
    const entry = key ? this.data.visited[key] : null;
    if (!entry) return Infinity;
    const age = now - Number(entry.at || 0);
    return age <= this.visitedTtlMs ? age : Infinity;
  }

  markFailed(position, reason = 'no-progress', ttlMs = 60_000, at = Date.now()) {
    const key = cellKey(position);
    if (!key) return;
    this.data.failed[key] = { at, until: at + Math.max(5_000, ttlMs), reason: String(reason).slice(0, 80) };
    this.prune(at);
    this.touch();
  }

  isFailed(position, now = Date.now()) {
    const key = cellKey(position);
    const entry = key ? this.data.failed[key] : null;
    return !!entry && Number(entry.until) > now;
  }

  observeEntity(entity, at = Date.now()) {
    if (!entity || !entity.position || !entity.name) return;
    const kind = entity.type === 'player' ? 'player' : String(entity.name).toLowerCase();
    // Never persist player names or chat content. Only remember the generic observation category.
    const key = kind === 'player' ? 'player' : kind;
    this.data.observations[key] = {
      at,
      position: {
        x: Math.round(entity.position.x),
        y: Math.round(entity.position.y),
        z: Math.round(entity.position.z)
      },
      sightings: Math.min(1_000_000, (Number(this.data.observations[key]?.sightings) || 0) + 1)
    };
    trimOldest(this.data.observations, this.maxObservations);
    this.touch();
  }

  increment(statistic, amount = 1) {
    if (!(statistic in this.data.statistics)) return;
    this.data.statistics[statistic] = Math.max(0, Number(this.data.statistics[statistic]) || 0) + amount;
    this.touch();
  }

  setSession(position, activity) {
    this.data.session = {
      lastPosition: position && [position.x, position.y, position.z].every(Number.isFinite)
        ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) }
        : this.data.session.lastPosition,
      lastActivity: String(activity || 'idle').slice(0, 32),
      savedAt: Date.now()
    };
    this.touch();
  }

  touch() {
    this.data.updatedAt = Date.now();
    this.dirty = true;
  }

  async save() {
    if (this.savePromise) return this.savePromise;
    if (!this.dirty) return false;
    this.prune();
    const dir = path.dirname(this.filePath);
    const savedUpdatedAt = this.data.updatedAt;
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify(this.data, null, 2);
    this.savePromise = (async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(tempPath, this.filePath);
      if (this.data.updatedAt === savedUpdatedAt) this.dirty = false;
      return true;
    })();
    try { return await this.savePromise; }
    finally {
      this.savePromise = null;
      try { await fs.promises.unlink(tempPath); } catch (_) {}
    }
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

module.exports = { AgentMemory, cellKey, DEFAULT_VISITED_TTL_MS, DEFAULT_OBSERVATION_TTL_MS };
