'use strict';

const ARMOR_DESTINATIONS = Object.freeze(['head', 'torso', 'legs', 'feet']);
const FALLBACK_EQUIPMENT_SLOTS = Object.freeze({ head: 5, torso: 6, legs: 7, feet: 8 });

const SLOT_KEYWORDS = Object.freeze({
  head: Object.freeze(['helmet', 'helm', 'headgear', 'headwear', 'hat', 'hood', 'cap', 'beanie', 'mask', 'crown', 'casco', 'gorro']),
  torso: Object.freeze(['chestplate', 'chest_armor', 'body_armor', 'breastplate', 'cuirass', 'jacket', 'coat', 'parka', 'tunic', 'robe', 'vest', 'sweater', 'hoodie', 'shirt', 'jerkin', 'torso', 'thermal_top', 'pechera', 'peto', 'tunica', 'abrigo', 'chaqueta', 'chaleco']),
  legs: Object.freeze(['leggings', 'leg_armor', 'legwear', 'pants', 'trousers', 'greaves', 'thermal_pants', 'pantalon', 'pantalones']),
  feet: Object.freeze(['boots', 'shoes', 'footwear', 'sandals', 'slippers', 'botas', 'zapatos'])
});

const MATERIAL_SCORE = Object.freeze({
  head: Object.freeze({ netherite: 14.5, diamond: 14, turtle: 12, iron: 11.5, chainmail: 10.5, golden: 10, gold: 10, leather: 8 }),
  torso: Object.freeze({ netherite: 22, diamond: 20.5, iron: 18, chainmail: 16, golden: 15, gold: 15, leather: 12 }),
  legs: Object.freeze({ netherite: 18.5, diamond: 17.5, iron: 15.5, chainmail: 13.5, golden: 12, gold: 12, leather: 9.5 }),
  feet: Object.freeze({ netherite: 13.5, diamond: 12.5, iron: 10.5, chainmail: 9.5, golden: 9, gold: 9, leather: 8 })
});

const NUMERIC_ENCHANTMENTS = Object.freeze({
  0: 'protection', 1: 'fire_protection', 2: 'feather_falling', 3: 'blast_protection',
  4: 'projectile_protection', 5: 'respiration', 6: 'aqua_affinity', 7: 'thorns',
  8: 'depth_strider', 9: 'frost_walker', 10: 'binding_curse', 11: 'soul_speed',
  12: 'swift_sneak', 13: 'unbreaking', 14: 'mending'
});

function flattenItemText(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 7) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((entry) => flattenItemText(entry, depth + 1, seen)).filter(Boolean).join(' ');
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const parts = [];
  for (const key of ['text', 'translate', 'key', 'value', 'name', 'fallback']) {
    if (value[key] != null && typeof value[key] !== 'object') parts.push(String(value[key]));
  }
  for (const key of ['extra', 'with', 'children']) {
    if (value[key] != null) parts.push(flattenItemText(value[key], depth + 1, seen));
  }
  return parts.filter(Boolean).join(' ');
}

function normalizeName(value) {
  return flattenItemText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^.*:/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function containsKeyword(name, keyword) {
  const normalized = normalizeName(name);
  const token = normalizeName(keyword);
  if (!normalized || !token) return false;
  return normalized === token || normalized.includes(`_${token}_`) ||
    normalized.startsWith(`${token}_`) || normalized.endsWith(`_${token}`) || normalized.includes(token);
}

function classifyArmorSlot(item, customSlotKeywords = {}) {
  if (!item) return null;

  // Some modded items expose their intended equipment slot as metadata even
  // when the registry/display name does not contain words such as "helmet".
  const metadataSlots = [item.armorSlot, item.armor_slot, item.equipmentSlot, item.equipment_slot, item.wearableSlot]
    .map(normalizeName);
  const metadataAliases = {
    head: ['head', 'helmet', 'armor_head', 'slot_head'],
    torso: ['torso', 'chest', 'body', 'armor_chest', 'slot_chest'],
    legs: ['legs', 'leg', 'armor_legs', 'slot_legs'],
    feet: ['feet', 'foot', 'boots', 'armor_feet', 'slot_feet']
  };
  for (const destination of ARMOR_DESTINATIONS) {
    if (metadataSlots.some((slot) => metadataAliases[destination].includes(slot))) return destination;
  }

  const names = [item.name, item.displayName, item.customName, item.custom_name, item.translationKey]
    .filter(Boolean)
    .map(normalizeName);
  if (!names.length) return null;

  for (const destination of ARMOR_DESTINATIONS) {
    const keywords = [
      ...SLOT_KEYWORDS[destination],
      ...(Array.isArray(customSlotKeywords[destination]) ? customSlotKeywords[destination] : [])
    ];
    if (keywords.some((keyword) => names.some((name) => containsKeyword(name, keyword)))) return destination;
  }
  return null;
}

function unwrapTag(value) {
  let current = value;
  let guard = 0;
  while (current && typeof current === 'object' && !Array.isArray(current) &&
    Object.prototype.hasOwnProperty.call(current, 'value') && guard++ < 8) {
    current = current.value;
  }
  return current;
}

function scalarTag(value) {
  const unwrapped = unwrapTag(value);
  if (unwrapped === undefined || unwrapped === null) return null;
  if (typeof unwrapped === 'number' || typeof unwrapped === 'string') return unwrapped;
  return null;
}

function normalizeEnchantmentId(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) {
    return NUMERIC_ENCHANTMENTS[Number(value)] || `unknown_${value}`;
  }
  return String(value || '').toLowerCase().replace(/^.*:/, '').replace(/[^a-z0-9_]/g, '_');
}

function getEnchantments(item) {
  const found = new Map();
  const add = (idValue, levelValue) => {
    const id = normalizeEnchantmentId(scalarTag(idValue));
    const level = Number(scalarTag(levelValue));
    if (!id || !Number.isFinite(level) || level <= 0 || id.startsWith('unknown_')) return;
    found.set(id, Math.max(found.get(id) || 0, level));
  };

  const direct = Array.isArray(item && item.enchants) ? item.enchants : [];
  for (const enchant of direct) {
    if (!enchant || typeof enchant !== 'object') continue;
    add(enchant.name ?? enchant.id, enchant.level ?? enchant.lvl);
  }

  const visited = new Set();
  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }

    const id = node.id ?? node.Id;
    const level = node.lvl ?? node.level ?? node.Lvl;
    if (id !== undefined && level !== undefined) add(id, level);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'value' && child && typeof child === 'object') walk(child, depth + 1);
      else if (child && typeof child === 'object') walk(child, depth + 1);
    }
  }
  walk(item && item.nbt);
  return found;
}

function getDurabilityPenalty(item) {
  const max = Number(item && item.maxDurability);
  let damage = Number(item && item.durabilityUsed);
  if (!Number.isFinite(damage)) damage = NaN;

  if (!Number.isFinite(damage) && item && item.nbt) {
    const direct = item.nbt.value && item.nbt.value.Damage;
    const parsed = Number(scalarTag(direct));
    if (Number.isFinite(parsed)) damage = parsed;
  }
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(damage) || damage <= 0) return 0;
  return Math.min(8, Math.max(0, damage / max) * 8);
}

function scoreArmorItem(item, destination) {
  if (!item || !ARMOR_DESTINATIONS.includes(destination)) return -Infinity;
  const name = normalizeName(item.name || item.displayName);
  const materialTable = MATERIAL_SCORE[destination];
  let score = 8;
  for (const [material, value] of Object.entries(materialTable)) {
    if (containsKeyword(name, material)) {
      score = value;
      break;
    }
  }

  // Seasonal/modded clothing commonly identifies warmth in its registry name.
  // This is a heuristic only; the exact thermal stat remains controlled by the mod/server.
  if (['winter', 'thermal', 'insulated', 'warm', 'fur', 'padded', 'wool', 'fleece', 'snow', 'down'].some((word) => containsKeyword(name, word))) {
    score += 12;
  }

  const enchantments = getEnchantments(item);
  const protection = enchantments.get('protection') || 0;
  const fire = enchantments.get('fire_protection') || 0;
  const blast = enchantments.get('blast_protection') || 0;
  const projectile = enchantments.get('projectile_protection') || 0;
  const thorns = enchantments.get('thorns') || 0;
  const unbreaking = enchantments.get('unbreaking') || 0;
  const mending = enchantments.get('mending') || 0;
  score += protection * 4.2 + (fire + blast + projectile) * 2.5 + thorns * 0.8 + unbreaking * 0.45 + mending * 1.1;

  if (destination === 'feet') {
    score += (enchantments.get('feather_falling') || 0) * 2.8;
    score += (enchantments.get('depth_strider') || 0) * 0.7;
    score += (enchantments.get('frost_walker') || 0) * 0.7;
    score += (enchantments.get('soul_speed') || 0) * 0.5;
  } else if (destination === 'head') {
    score += (enchantments.get('respiration') || 0) * 0.8;
    score += (enchantments.get('aqua_affinity') || 0) * 0.8;
  } else if (destination === 'legs') {
    score += (enchantments.get('swift_sneak') || 0) * 0.5;
  }

  score -= getDurabilityPenalty(item);
  return score;
}

/**
 * Shared inventory lock policy. An armor transaction may continue while it
 * owns the 'armor' lock, but must defer to weapon/other transactions.
 */
function canRunArmorTransaction(bot, weaponController) {
  const lock = bot && bot.__manjiEquipmentBusy;
  if (lock && lock !== 'armor') return false;
  if (weaponController && (weaponController.equipping || weaponController.stowing)) return false;
  return true;
}

class ArmorController {
  constructor(bot, options = {}) {
    this.bot = bot;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.customSlotKeywords = options.customSlotKeywords || {};
    this.canRun = typeof options.canRun === 'function' ? options.canRun : () => true;
    this.operationTimeoutMs = Math.max(500, Number(options.operationTimeoutMs) || 2500);
    this.upgradeMargin = Math.max(0, Number(options.upgradeMargin) || 0.25);
    this.failureLogIntervalMs = Math.max(3000, Number(options.failureLogIntervalMs) || 20000);
    this.busy = false;
    this.lastFailureAt = new Map();
    this.lastScanLogAt = 0;
    this.lastDeferredLogAt = 0;
    this.stopped = false;
  }

  getInventoryItems() {
    const inventory = this.bot && this.bot.inventory;
    if (!inventory) return [];
    const slots = Array.isArray(inventory.slots) ? inventory.slots : [];
    const bySlot = new Map();

    // Normal Mineflayer player-window slots: 9..35 backpack and 36..44 hotbar.
    // Read the live slots first, then merge inventory.items() as a compatibility
    // fallback for forks which expose a filtered or wrapped inventory view.
    for (let slot = 9; slot <= 44 && slot < slots.length; slot++) {
      const item = slots[slot];
      if (item) bySlot.set(slot, item);
    }
    if (typeof inventory.items === 'function') {
      try {
        for (const item of inventory.items()) {
          if (!item) continue;
          let slot = Number.isInteger(item.slot) ? item.slot : -1;
          if (slot < 9 || slot > 44) {
            slot = slots.findIndex((candidate, index) => index >= 9 && index <= 44 && candidate &&
              candidate.name === item.name && candidate.type === item.type && candidate.count === item.count);
          }
          if (slot >= 9 && slot <= 44 && !bySlot.has(slot)) bySlot.set(slot, item);
        }
      } catch (error) {
        this.log(`[Equipment][Armor] inventory.items() scan failed: ${error.message || String(error)}.`);
      }
    }
    return [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([slot, item]) => {
      if (!Number.isInteger(item.slot)) {
        try { Object.defineProperty(item, '__manjiInventorySlot', { value: slot, configurable: true }); } catch (_) {}
      }
      return item;
    });
  }

  getEquipmentSlot(destination) {
    if (this.bot && typeof this.bot.getEquipmentDestSlot === 'function') {
      const slot = this.bot.getEquipmentDestSlot(destination);
      if (Number.isInteger(slot) && slot >= 0) return slot;
    }
    return FALLBACK_EQUIPMENT_SLOTS[destination];
  }

  getEquippedItem(destination) {
    const slots = this.bot && this.bot.inventory && this.bot.inventory.slots;
    const slot = this.getEquipmentSlot(destination);
    return Array.isArray(slots) && Number.isInteger(slot) ? slots[slot] || null : null;
  }

  findBestItem(destination) {
    const candidates = this.getInventoryItems()
      .filter((item) => classifyArmorSlot(item, this.customSlotKeywords) === destination)
      .map((item) => ({ item, score: scoreArmorItem(item, destination), sourceSlot: this.findInventorySlot(item) }))
      .filter((candidate) => candidate.sourceSlot >= 9 && candidate.sourceSlot <= 44)
      .sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name)));
    return candidates[0] || null;
  }

  findInventorySlot(item) {
    const slots = this.bot && this.bot.inventory && this.bot.inventory.slots;
    if (!Array.isArray(slots)) return Number.isInteger(item && item.__manjiInventorySlot) ? item.__manjiInventorySlot : -1;
    const exact = slots.findIndex((candidate) => candidate === item);
    if (exact >= 9 && exact <= 44) return exact;
    if (Number.isInteger(item && item.slot) && item.slot >= 9 && item.slot <= 44 && slots[item.slot]) return item.slot;
    if (Number.isInteger(item && item.__manjiInventorySlot) && item.__manjiInventorySlot >= 9 && item.__manjiInventorySlot <= 44 && slots[item.__manjiInventorySlot]) return item.__manjiInventorySlot;
    return slots.findIndex((candidate, index) => index >= 9 && index <= 44 && candidate &&
      candidate.name === item.name && candidate.type === item.type && candidate.count === item.count);
  }

  async waitForEquipped(destination, candidate, timeoutMs = 1300) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const actual = this.getEquippedItem(destination);
      if (actual && actual.name === candidate.name &&
          (candidate.type == null || actual.type == null || actual.type === candidate.type)) return actual;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    return this.getEquippedItem(destination);
  }

  logInventoryScan(items) {
    const now = Date.now();
    if (now - this.lastScanLogAt < 20000) return;
    this.lastScanLogAt = now;
    const details = items.map((item) => {
      const destination = classifyArmorSlot(item, this.customSlotKeywords) || 'unrecognized';
      const slot = this.findInventorySlot(item);
      const name = flattenItemText(item.name || item.displayName || item.customName) || 'unnamed';
      return `${slot}:${name}→${destination}`;
    });
    const held = this.bot && this.bot.heldItem ? this.bot.heldItem.name : 'empty';
    this.log(`[Equipment][Armor] Player inventory scan (${items.length} item(s), slots 9..44; hand=${held}): ${details.length ? details.join(', ') : 'no items in player inventory'}.`);
  }

  async equipBestAvailable() {
    if (this.stopped || this.busy || !this.bot || !this.bot.inventory || !this.bot.entity) return false;
    if (this.bot.__manjiEquipmentBusy || !this.canRun()) {
      const now = Date.now();
      if (now - this.lastDeferredLogAt >= 12000) {
        this.log(`[Equipment][Armor] Scan deferred because another equipment transaction is active (lock=${this.bot.__manjiEquipmentBusy || 'controller-busy'}).`);
        this.lastDeferredLogAt = now;
      }
      return false;
    }

    this.busy = true;
    this.bot.__manjiEquipmentBusy = 'armor';
    let changed = false;
    try {
      const inventoryItems = this.getInventoryItems();
      this.logInventoryScan(inventoryItems);
      for (const destination of ARMOR_DESTINATIONS) {
        if (this.stopped || !this.canRun()) break;
        const best = inventoryItems
          .filter((item) => classifyArmorSlot(item, this.customSlotKeywords) === destination)
          .map((item) => ({ item, score: scoreArmorItem(item, destination), sourceSlot: this.findInventorySlot(item) }))
          .filter((candidate) => candidate.sourceSlot >= 9 && candidate.sourceSlot <= 44)
          .sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name)))[0] || null;
        if (!best) continue;

        const equipped = this.getEquippedItem(destination);
        const currentScore = equipped ? scoreArmorItem(equipped, destination) : -Infinity;
        if (equipped && best.score <= currentScore + this.upgradeMargin) continue;

        let candidateForDiagnostic = best.item;
        try {
          // Re-fetch the exact live Item instance immediately before bot.equip.
          const sourceSlot = this.findInventorySlot(best.item);
          const liveItem = sourceSlot >= 9 && sourceSlot <= 44
            ? this.bot.inventory.slots[sourceSlot]
            : null;
          if (!liveItem) throw new Error(`candidate ${best.item.name} is no longer present in player inventory slots 9..44`);
          candidateForDiagnostic = liveItem;

          let equipError = null;
          try {
            await withTimeout(this.bot.equip(liveItem, destination), this.operationTimeoutMs, `equip armor ${destination}`);
          } catch (error) {
            equipError = error;
            const primaryMessage = error && error.message ? error.message : String(error);
            this.log(`[Equipment][Armor] Primary bot.equip() failed for ${liveItem.name} → ${destination}: ${primaryMessage}`);
            if (error && error.stack) this.log(`[Equipment][Armor] Primary bot.equip() stack for ${liveItem.name}:\n${error.stack}`);
          }

          let actual = await this.waitForEquipped(destination, liveItem, equipError ? 250 : 1300);
          if (!actual || actual.name !== liveItem.name) {
            // Fallback to the documented low-level slot transfer only when the
            // original item is still in its source slot. This avoids issuing a
            // second click if the first equip transaction already moved it.
            const destinationSlot = this.getEquipmentSlot(destination);
            const sourceStillHasItem = this.bot.inventory.slots[sourceSlot] &&
              this.bot.inventory.slots[sourceSlot].name === liveItem.name;
            const destinationAlreadyHasItem = this.bot.inventory.slots[destinationSlot] &&
              this.bot.inventory.slots[destinationSlot].name === liveItem.name;
            if (sourceStillHasItem && !destinationAlreadyHasItem &&
                typeof this.bot.moveSlotItem === 'function' &&
                !(equipError && /timed out/i.test(String(equipError.message || equipError)))) {
              try {
                await withTimeout(this.bot.moveSlotItem(sourceSlot, destinationSlot), this.operationTimeoutMs, `move armor into ${destination} slot`);
                actual = await this.waitForEquipped(destination, liveItem, 1300);
                if (actual && actual.name === liveItem.name) {
                  this.log(`[Equipment][Armor] Used slot-transfer fallback for ${liveItem.name} → ${destination}.`);
                }
              } catch (fallbackError) {
                const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError);
                const primaryMessage = equipError
                  ? (equipError && equipError.message ? equipError.message : String(equipError))
                  : 'bot.equip() resolved without a confirmed inventory change';
                const combined = new Error(`slot-transfer fallback failed: ${fallbackMessage}; primary bot.equip(): ${primaryMessage}`);
                combined.cause = fallbackError;
                combined.stack = `${combined.stack || combined.message}\nFallback stack:\n${fallbackError && fallbackError.stack ? fallbackError.stack : fallbackMessage}`;
                if (equipError && equipError.stack) combined.stack += `\nPrimary bot.equip() stack:\n${equipError.stack}`;
                throw combined;
              }
            }
          }
          if (!actual || actual.name !== liveItem.name) {
            const detail = equipError ? `; equip API reported ${equipError.message || String(equipError)}` : '';
            throw new Error(`server did not confirm ${liveItem.name} in ${destination} slot (observed: ${actual ? actual.name : 'empty'}${detail})`);
          }
          changed = true;
          this.lastFailureAt.delete(destination);
          const reason = equipped ? `upgrade ${currentScore.toFixed(1)} → ${best.score.toFixed(1)}` : `empty ${destination} slot`;
          this.log(`[Equipment][Armor] Equipped ${actual.name} in ${destination} (${reason}; score ${best.score.toFixed(1)}; source slot ${sourceSlot}).`);
        } catch (error) {
          const now = Date.now();
          const last = this.lastFailureAt.get(destination) || 0;
          if (now - last >= this.failureLogIntervalMs) {
            const itemLabel = flattenItemText(best.item.name || best.item.displayName) || 'unlabelled item';
            this.log(`[Equipment][Armor] Could not equip ${itemLabel} in ${destination}: ${error && error.message ? error.message : String(error)}.`);
            this.log(`[Equipment][Armor] Serialization diagnostics for ${itemLabel}: ${describeItemSerialization(candidateForDiagnostic)}.`);
            if (error && error.stack) this.log(`[Equipment][Armor] Error stack for ${itemLabel}:\n${error.stack}`);
            this.lastFailureAt.set(destination, now);
          }
        }
      }
    } finally {
      this.busy = false;
      if (this.bot && this.bot.__manjiEquipmentBusy === 'armor') delete this.bot.__manjiEquipmentBusy;
    }
    return changed;
  }

  stop() {
    this.stopped = true;
  }
}

// Shared helper mirrors the timeout behaviour used by the combat equipment controller.
function describeItemSerialization(item) {
  if (!item || typeof item !== 'object') return 'item unavailable';
  const nbt = item.nbt;
  let nbtSummary = 'null';
  if (nbt != null) {
    if (typeof nbt === 'object') {
      const root = nbt.value && typeof nbt.value === 'object' ? nbt.value : nbt;
      const keys = Object.keys(root).slice(0, 16);
      const damageTag = root.Damage ?? root.damage;
      let damageSummary = 'absent';
      if (damageTag != null) {
        if (typeof damageTag === 'object' && Object.prototype.hasOwnProperty.call(damageTag, 'value')) {
          const value = damageTag.value;
          damageSummary = `${damageTag.type || 'tag'}:${typeof value === 'string' ? value : JSON.stringify(value)}`;
        } else {
          damageSummary = typeof damageTag === 'string' ? damageTag : JSON.stringify(damageTag);
        }
      }
      nbtSummary = `present(type=${nbt.type || 'object'}, keys=${keys.join(',') || 'none'}, Damage=${damageSummary})`;
    } else {
      nbtSummary = `present(type=${typeof nbt})`;
    }
  }
  const componentValue = item.components ?? item.componentMap ?? item.dataComponents;
  let componentSummary = 'not exposed';
  if (componentValue != null) {
    componentSummary = Array.isArray(componentValue)
      ? `array(${componentValue.length})`
      : typeof componentValue === 'object'
        ? `object(keys=${Object.keys(componentValue).slice(0, 16).join(',') || 'none'})`
        : typeof componentValue;
  }
  return `itemKeys=${Object.keys(item).join(',')}; nbt=${nbtSummary}; components=${componentSummary}; stackId=${item.stackId ?? 'none'}; slot=${item.slot ?? item.__manjiInventorySlot ?? 'unknown'}`;
}

function withTimeout(promise, timeoutMs, operation) {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs} ms`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

module.exports = {
  ArmorController,
  ARMOR_DESTINATIONS,
  SLOT_KEYWORDS,
  classifyArmorSlot,
  getEnchantments,
  scoreArmorItem,
  flattenItemText,
  normalizeName,
  canRunArmorTransaction,
  describeItemSerialization
};
