'use strict';

const HOSTILE_NAMES = new Set([
  'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian',
  'ender_dragon', 'endermite', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk',
  'illusioner', 'magma_cube', 'phantom', 'piglin_brute', 'pillager', 'ravager',
  'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex',
  'vindicator', 'warden', 'witch', 'wither', 'wither_skeleton', 'zoglin', 'zombie',
  'zombie_villager', 'zombified_piglin'
]);

class SensorSuite {
  constructor(bot, memory) {
    this.bot = bot;
    this.memory = memory;
    this.lastSnapshot = null;
  }

  scan() {
    const bot = this.bot;
    if (!bot || !bot.entity || !bot.entities) return null;
    const now = Date.now();
    const position = bot.entity.position;
    const entities = Object.values(bot.entities).filter((entity) => entity && entity.position && entity.id !== bot.entity.id);
    const players = entities.filter((entity) => entity.type === 'player');
    const hostiles = entities.filter((entity) => HOSTILE_NAMES.has(String(entity.name || '').toLowerCase()));
    const interesting = entities.filter((entity) => entity.type !== 'player' && !HOSTILE_NAMES.has(String(entity.name || '').toLowerCase()));
    const nearest = (list) => list.sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position))[0] || null;
    const nearestHostile = nearest([...hostiles]);
    const nearestInteresting = nearest([...interesting]);
    const feetBlock = typeof bot.blockAt === 'function' ? bot.blockAt(position.floored()) : null;
    const belowBlock = typeof bot.blockAt === 'function' ? bot.blockAt(position.floored().offset(0, -1, 0)) : null;
    const inLiquid = !!feetBlock && /water|lava/.test(String(feetBlock.name || '').toLowerCase());
    const inLava = !!feetBlock && String(feetBlock.name || '').toLowerCase().includes('lava');

    if (this.memory) {
      this.memory.markVisited(position, now);
      for (const entity of entities) {
        if (position.distanceTo(entity.position) <= 24) this.memory.observeEntity(entity, now);
      }
    }

    this.lastSnapshot = {
      at: now,
      position: { x: position.x, y: position.y, z: position.z },
      health: Number.isFinite(bot.health) ? bot.health : null,
      food: Number.isFinite(bot.food) ? bot.food : null,
      playersOnline: players.length,
      hostileCount: hostiles.length,
      nearestHostile: nearestHostile ? { name: nearestHostile.name, distance: position.distanceTo(nearestHostile.position) } : null,
      interestingCount: interesting.length,
      nearestInteresting: nearestInteresting ? { name: nearestInteresting.name, distance: position.distanceTo(nearestInteresting.position) } : null,
      inLiquid,
      inLava,
      hasFloor: !!belowBlock && belowBlock.boundingBox === 'block'
    };
    return this.lastSnapshot;
  }
}

module.exports = { SensorSuite, HOSTILE_NAMES };
