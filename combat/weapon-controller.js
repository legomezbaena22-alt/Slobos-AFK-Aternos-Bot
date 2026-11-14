'use strict';

const WEAPON_PRIORITY = Object.freeze({
  netherite_sword: 1000,
  diamond_sword: 900,
  iron_sword: 800,
  stone_sword: 700,
  golden_sword: 600,
  wooden_sword: 500,
  netherite_axe: 490,
  diamond_axe: 480,
  iron_axe: 470,
  stone_axe: 460,
  golden_axe: 450,
  wooden_axe: 440,
  mace: 430,
  trident: 420
});

function isCombatWeaponName(name) {
  const normalized = String(name || '').toLowerCase().replace(/^.*:/, '');
  return /_(sword|axe)$/.test(normalized) || normalized === 'trident' || normalized === 'mace';
}

function isStowableToolName(name) {
  const normalized = String(name || '').toLowerCase().replace(/^.*:/, '');
  return /_(pickaxe|shovel|hoe)$/.test(normalized) ||
    ['shears', 'flint_and_steel', 'brush', 'fishing_rod'].includes(normalized);
}

function isStowableHandItem(name) {
  return isCombatWeaponName(name) || isStowableToolName(name);
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

function errorDescription(error) {
  if (error == null) return 'unknown error (no error detail supplied)';
  if (typeof error === 'string') return error;
  const message = error.message ? String(error.message) : String(error);
  const code = error.code ? ` [${error.code}]` : '';
  return `${message}${code}`;
}

class WeaponController {
  constructor(bot, options = {}) {
    this.bot = bot;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.retryMs = Math.max(1000, Number(options.retryMs) || 5000);
    this.operationTimeoutMs = Math.max(500, Number(options.operationTimeoutMs) || 1800);
    this.equipping = false;
    this.stowing = false;
    this.retryAt = 0;
    this.lastFailureLogAt = 0;
    this.restoreSlot = null;
    this.restoreName = null;
    this.lastEquippedName = null;
    this.attackWindowUntil = 0;
  }

  getPlayerInventoryItems() {
    const inventory = this.bot && this.bot.inventory;
    if (!inventory) return [];
    const slots = Array.isArray(inventory.slots) ? inventory.slots : [];
    const merged = [];
    const seen = new Set();
    const add = (item) => {
      if (!item) return;
      const slot = Number.isInteger(item.slot) ? item.slot : slots.findIndex((entry) => entry === item);
      if (slot < 9 || slot > 44) return;
      const key = `${slot}:${item.type ?? item.name ?? 'unknown'}:${item.count ?? 1}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };
    if (slots.length) slots.slice(9, 45).forEach(add);
    if (typeof inventory.items === 'function') {
      try { inventory.items().forEach(add); } catch (_) {}
    }
    return merged;
  }

  findBestWeapon() {
    const items = this.getPlayerInventoryItems();
    return items
      .filter((item) => item && isCombatWeaponName(item.name))
      .sort((a, b) => (WEAPON_PRIORITY[String(b.name).toLowerCase()] || 0) -
        (WEAPON_PRIORITY[String(a.name).toLowerCase()] || 0))[0] || null;
  }

  hasWeapon() {
    const held = this.bot && this.bot.heldItem;
    return !!(held && isCombatWeaponName(held.name)) || !!this.findBestWeapon();
  }

  async equipForCombat() {
    if (!this.bot || !this.bot.inventory || this.equipping || this.stowing ||
        (this.bot.__manjiEquipmentBusy && this.bot.__manjiEquipmentBusy !== 'weapon')) return false;
    const weapon = this.findBestWeapon();
    const held = this.bot.heldItem;

    if (held && isCombatWeaponName(held.name)) {
      this.lastEquippedName = held.name;
      this.attackWindowUntil = Date.now() + 1800;
      return true;
    }
    if (!weapon) return false;

    this.equipping = true;
    this.bot.__manjiEquipmentBusy = 'weapon';
    const sourceSlot = Number.isInteger(weapon.slot) ? weapon.slot : this.findSlotForItem(weapon);
    const previousHandName = held && held.name ? String(held.name) : null;
    try {
      await withTimeout(this.bot.equip(weapon, 'hand'), this.operationTimeoutMs, 'equip weapon');
      const equipped = this.bot.heldItem && this.bot.heldItem.name === weapon.name;
      if (!equipped) throw new Error(`server did not confirm ${weapon.name} in main hand`);

      // Mineflayer swaps the previous hand item into the source slot when it
      // equips an inventory item. Remember that slot so we can swap the old
      // utility item back instead of requiring an extra empty inventory slot.
      if (previousHandName && !isCombatWeaponName(previousHandName) && !isStowableToolName(previousHandName) && sourceSlot >= 0) {
        this.restoreSlot = sourceSlot;
        this.restoreName = previousHandName;
      } else {
        this.restoreSlot = null;
        this.restoreName = null;
      }
      this.lastEquippedName = this.bot.heldItem.name;
      this.attackWindowUntil = Date.now() + 1800;
      this.retryAt = 0;
      this.log(`[Combat][Equipment] Weapon drawn: ${this.lastEquippedName}.`);
      return true;
    } catch (error) {
      this.log(`[Combat][Equipment] Could not draw weapon: ${errorDescription(error)}.`);
      return false;
    } finally {
      this.equipping = false;
      if (this.bot && this.bot.__manjiEquipmentBusy === 'weapon') delete this.bot.__manjiEquipmentBusy;
    }
  }

  async stowAfterThreat() {
    if (!this.bot || this.equipping || this.stowing ||
        (this.bot.__manjiEquipmentBusy && this.bot.__manjiEquipmentBusy !== 'weapon')) return false;
    const now = Date.now();
    if (now < this.retryAt) return false;

    const held = this.bot.heldItem;
    if (!held || !isStowableHandItem(held.name)) {
      this.clearRestoreState();
      this.attackWindowUntil = 0;
      return true;
    }

    this.stowing = true;
    this.bot.__manjiEquipmentBusy = 'weapon';
    try {
      // First restore the non-combat item that was in the hand before the
      // weapon was drawn. This swaps the sword back into its original slot and
      // works even when every other inventory slot is occupied.
      const restoreItem = this.getRestoreItem();
      if (restoreItem) {
        await withTimeout(this.bot.equip(restoreItem, 'hand'), this.operationTimeoutMs, 'restore previous hand item');
        if (!this.bot.heldItem || this.bot.heldItem.name !== this.restoreName) {
          throw new Error(`previous hand item ${this.restoreName} was not restored`);
        }
        const weaponReturned = this.bot.inventory.slots[this.restoreSlot];
        if (!weaponReturned || !isCombatWeaponName(weaponReturned.name)) {
          throw new Error('weapon was not confirmed in its original inventory slot');
        }
        const returnedName = weaponReturned.name;
        this.clearRestoreState();
        this.retryAt = 0;
        this.attackWindowUntil = 0;
        this.log(`[Combat][Equipment] Weapon stowed: ${returnedName}; previous hand item restored.`);
        return true;
      }

      const slots = this.bot.inventory && this.bot.inventory.slots;
      const selectedQuickBar = Number.isInteger(this.bot.quickBarSlot) ? this.bot.quickBarSlot : -1;
      const selectedSlot = selectedQuickBar >= 0 && selectedQuickBar <= 8 ? 36 + selectedQuickBar : -1;

      // First try moving the selected sword/tool out of the active hotbar slot
      // into an empty main-inventory slot. This makes the selected slot itself
      // empty, so the server's held-item state becomes empty too.
      const emptyMainSlot = Array.isArray(slots)
        ? slots.findIndex((item, index) => index >= 9 && index <= 35 && item == null)
        : -1;
      const selectedItem = selectedSlot >= 36 && selectedSlot <= 44 ? slots[selectedSlot] : null;
      if (emptyMainSlot >= 9 && selectedItem && selectedItem.name === held.name &&
          typeof this.bot.moveSlotItem === 'function') {
        let moveError = null;
        try {
          await withTimeout(this.bot.moveSlotItem(selectedSlot, emptyMainSlot), this.operationTimeoutMs, 'move weapon out of selected hotbar slot');
        } catch (error) {
          moveError = error;
        }
        await this.waitForHandClear(700);
        const movedItem = this.bot.inventory.slots[emptyMainSlot];
        if ((!this.bot.heldItem || !isStowableHandItem(this.bot.heldItem.name)) &&
            movedItem && movedItem.name === held.name) {
          const stowedName = held.name;
          this.clearRestoreState();
          this.retryAt = 0;
          this.attackWindowUntil = 0;
          this.log(`[Combat][Equipment] Weapon/tool stowed: ${stowedName}; moved from selected hotbar slot ${selectedSlot} to inventory slot ${emptyMainSlot}.`);
          return true;
        }
        if (moveError && /timed out/i.test(errorDescription(moveError))) throw moveError;
      }

      // Next, select an empty hotbar slot. The weapon remains in its original
      // slot; no inventory item is discarded or overwritten.
      const emptyHotbar = Array.isArray(slots)
        ? slots.findIndex((item, index) => index >= 36 && index <= 44 && item == null)
        : -1;
      if (emptyHotbar >= 36 && typeof this.bot.setQuickBarSlot === 'function') {
        await withTimeout(Promise.resolve(this.bot.setQuickBarSlot(emptyHotbar - 36)), this.operationTimeoutMs, 'select empty hotbar slot');
        await this.waitForHandClear(700);
        if (!this.bot.heldItem || !isStowableHandItem(this.bot.heldItem.name)) {
          const stowedName = held.name;
          this.clearRestoreState();
          this.retryAt = 0;
          this.attackWindowUntil = 0;
          this.log(`[Combat][Equipment] Weapon/tool stowed: ${stowedName}; selected empty hotbar slot ${emptyHotbar - 36}.`);
          return true;
        }
      }

      // A full hotbar may still contain a harmless utility item. Select it
      // rather than leaving a sword or pickaxe visibly in the hand.
      const utilityHotbar = Array.isArray(slots)
        ? slots.findIndex((item, index) => index >= 36 && index <= 44 && item && !isStowableHandItem(item.name))
        : -1;
      if (utilityHotbar >= 36 && typeof this.bot.setQuickBarSlot === 'function') {
        await withTimeout(Promise.resolve(this.bot.setQuickBarSlot(utilityHotbar - 36)), this.operationTimeoutMs, 'select utility hotbar item');
        await this.waitForHandClear(700);
        if (!this.bot.heldItem || !isStowableHandItem(this.bot.heldItem.name)) {
          const stowedName = held.name;
          this.clearRestoreState();
          this.retryAt = 0;
          this.attackWindowUntil = 0;
          this.log(`[Combat][Equipment] Weapon/tool hidden: ${stowedName}; selected utility hotbar slot ${utilityHotbar - 36}.`);
          return true;
        }
      }

      // Last fallback: use Mineflayer's inventory operation only when a free
      // slot exists. Its hand-unequip implementation may otherwise toss items.
      if (!this.hasFreeInventorySlot()) {
        throw new Error('no safe empty inventory/hotbar slot and no non-weapon hotbar item; refusing to drop the weapon/tool');
      }
      await withTimeout(this.bot.unequip('hand'), this.operationTimeoutMs, 'stow weapon');
      await this.waitForHandClear(700);
      if (this.bot.heldItem && isStowableHandItem(this.bot.heldItem.name)) {
        throw new Error('stow operation completed but a weapon/tool is still in the main hand');
      }
      const stowedName = held.name;
      this.clearRestoreState();
      this.retryAt = 0;
      this.attackWindowUntil = 0;
      this.log(`[Combat][Equipment] Weapon/tool stowed: ${stowedName}; no visible hostile target.`);
      return true;
    } catch (error) {
      this.retryAt = Date.now() + this.retryMs;
      if (Date.now() - this.lastFailureLogAt >= this.retryMs) {
        this.log(`[Combat][Equipment] Stow postponed: ${errorDescription(error)}. Retrying in ${Math.ceil(this.retryMs / 1000)}s.`);
        this.lastFailureLogAt = Date.now();
      }
      return false;
    } finally {
      this.stowing = false;
      if (this.bot && this.bot.__manjiEquipmentBusy === 'weapon') delete this.bot.__manjiEquipmentBusy;
    }
  }

  isAttackWindowActive() {
    return this.equipping || this.stowing || Date.now() < this.attackWindowUntil;
  }

  async waitForHandClear(timeoutMs = 700) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (typeof this.bot.updateHeldItem === 'function') this.bot.updateHeldItem();
      const held = this.bot.heldItem;
      if (!held || !isStowableHandItem(held.name)) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return !this.bot.heldItem || !isStowableHandItem(this.bot.heldItem.name);
  }

  findSlotForItem(item) {
    const slots = this.bot && this.bot.inventory && this.bot.inventory.slots;
    if (!Array.isArray(slots)) return -1;
    const exact = slots.findIndex((candidate) => candidate === item);
    if (exact >= 0) return exact;
    return slots.findIndex((candidate) => candidate && candidate.name === item.name &&
      candidate.type === item.type && candidate.count === item.count);
  }

  getRestoreItem() {
    if (!Number.isInteger(this.restoreSlot) || !this.restoreName) return null;
    const slots = this.bot && this.bot.inventory && this.bot.inventory.slots;
    const candidate = Array.isArray(slots) ? slots[this.restoreSlot] : null;
    if (!candidate || candidate.name !== this.restoreName || isCombatWeaponName(candidate.name)) return null;
    return candidate;
  }

  hasFreeInventorySlot() {
    const slots = this.bot && this.bot.inventory && this.bot.inventory.slots;
    if (!Array.isArray(slots)) return false;
    // Main inventory plus hotbar. Equipment, crafting, and result slots are excluded.
    return slots.slice(9, 45).some((item) => item == null);
  }

  clearRestoreState() {
    this.restoreSlot = null;
    this.restoreName = null;
    this.lastEquippedName = null;
  }
}

module.exports = { WeaponController, isCombatWeaponName, isStowableToolName, isStowableHandItem, withTimeout, errorDescription, WEAPON_PRIORITY };
