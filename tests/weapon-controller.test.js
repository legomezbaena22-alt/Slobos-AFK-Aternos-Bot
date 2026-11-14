'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WeaponController, isCombatWeaponName } = require('../combat/weapon-controller');

function makeBot({ heldItem = null, inventoryItems = [], emptySlots = true } = {}) {
  const slots = Array(46).fill(null);
  for (const item of inventoryItems) slots[item.slot] = item;
  if (emptySlots && !slots.slice(9, 45).some((item) => item == null)) slots[44] = null;
  const bot = {
    heldItem,
    inventory: {
      slots,
      items() { return slots.slice(9, 45).filter(Boolean); }
    },
    async equip(item) {
      const sourceSlot = item.slot;
      const previous = this.heldItem;
      slots[sourceSlot] = previous ? { ...previous, slot: sourceSlot } : null;
      this.heldItem = { ...item, slot: 36 };
    },
    async unequip() {
      const empty = slots.findIndex((item, index) => index >= 9 && index <= 44 && item == null);
      if (empty < 0) throw new Error('inventory full');
      slots[empty] = this.heldItem;
      this.heldItem = null;
    },
    updateHeldItem() {}
  };
  return bot;
}

test('combat weapon detection only classifies melee weapons', () => {
  assert.equal(isCombatWeaponName('diamond_sword'), true);
  assert.equal(isCombatWeaponName('minecraft:diamond_sword'), true);
  assert.equal(isCombatWeaponName('iron_axe'), true);
  assert.equal(isCombatWeaponName('bow'), false);
  assert.equal(isCombatWeaponName('crossbow'), false);
});

test('controller prefers a sword over an axe and equips only when asked', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 10 };
  const axe = { name: 'diamond_axe', type: 2, count: 1, slot: 11 };
  const bot = makeBot({ inventoryItems: [sword, axe] });
  const messages = [];
  const controller = new WeaponController(bot, { log: (message) => messages.push(message) });
  assert.equal(bot.heldItem, null);
  assert.equal(controller.hasWeapon(), true);
  assert.equal(await controller.equipForCombat(), true);
  assert.equal(bot.heldItem.name, 'iron_sword');
  assert.ok(messages.some((message) => message.includes('Weapon drawn: iron_sword')));
});

test('stowing restores the previous utility item by swapping it back, even when no spare slot exists', async () => {
  const sword = { name: 'diamond_sword', type: 1, count: 1, slot: 10 };
  const torch = { name: 'torch', type: 3, count: 32, slot: 36 };
  const bot = makeBot({ heldItem: torch, inventoryItems: [sword], emptySlots: false });
  const controller = new WeaponController(bot);
  assert.equal(await controller.equipForCombat(), true);
  assert.equal(bot.heldItem.name, 'diamond_sword');
  assert.equal(bot.inventory.slots[10].name, 'torch');
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(bot.heldItem.name, 'torch');
  assert.equal(bot.inventory.slots[10].name, 'diamond_sword');
});

test('stowing with an empty hand uses a free inventory slot', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 10 };
  const bot = makeBot({ inventoryItems: [sword] });
  const controller = new WeaponController(bot);
  assert.equal(await controller.equipForCombat(), true);
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(bot.heldItem, null);
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'iron_sword'));
});

test('stowing never drops a weapon when inventory is full and no previous hand item exists', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 10 };
  const fillers = Array.from({ length: 36 }, (_, index) => ({ name: `filler_${index}`, type: 10 + index, count: 1, slot: index + 9 }));
  fillers[1] = sword;
  const bot = makeBot({ inventoryItems: fillers, emptySlots: false });
  const controller = new WeaponController(bot, { retryMs: 1000 });
  // Put a weapon in hand as if it was selected before the controller started.
  bot.heldItem = sword;
  assert.equal(await controller.stowAfterThreat(), false);
  assert.equal(bot.heldItem.name, 'iron_sword');
});

test('idle controller stows a held pickaxe instead of leaving a tool visible', async () => {
  const pickaxe = { name: 'iron_pickaxe', type: 5, count: 1, slot: 36 };
  const bot = makeBot({ heldItem: pickaxe, inventoryItems: [{ name: 'torch', type: 6, count: 8, slot: 10 }] });
  const controller = new WeaponController(bot);
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(bot.heldItem, null);
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'iron_pickaxe'));
});

test('after combat a previously held pickaxe stays in inventory instead of being restored to hand', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 10 };
  const pickaxe = { name: 'iron_pickaxe', type: 2, count: 1, slot: 36 };
  const bot = makeBot({ heldItem: pickaxe, inventoryItems: [sword] });
  const controller = new WeaponController(bot);
  assert.equal(await controller.equipForCombat(), true);
  assert.equal(bot.heldItem.name, 'iron_sword');
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(bot.heldItem, null);
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'iron_pickaxe'));
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'iron_sword'));
});


test('stowing selects an empty hotbar slot and leaves the sword stored without unequip', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 36 };
  const slots = Array(46).fill(null);
  slots[36] = sword;
  slots[9] = { name: 'torch', type: 2, count: 8, slot: 9 };
  let selected = 0;
  const bot = {
    heldItem: sword,
    inventory: { slots, items() { return slots.slice(9, 45).filter(Boolean); } },
    setQuickBarSlot(slot) { selected = slot; this.heldItem = slots[36 + slot] || null; },
    updateHeldItem() { this.heldItem = slots[36 + selected] || null; },
    async unequip() { throw new Error('unequip should not be required'); }
  };
  const logs = [];
  const controller = new WeaponController(bot, { log: (message) => logs.push(message) });
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(selected, 1); // slot 37 is empty
  assert.equal(bot.heldItem, null);
  assert.equal(slots[36].name, 'iron_sword');
  assert.ok(logs.some((line) => line.includes('selected empty hotbar slot 1')));
});


test('stowing moves a selected weapon into an empty backpack slot and clears the selected hand', async () => {
  const sword = { name: 'iron_sword', type: 1, count: 1, slot: 36 };
  const slots = Array(46).fill(null);
  slots[36] = sword;
  let heldSlot = 36;
  const bot = {
    quickBarSlot: 0,
    heldItem: sword,
    inventory: { slots, items() { return slots.slice(9, 45).filter(Boolean); } },
    async moveSlotItem(source, destination) {
      slots[destination] = slots[source];
      slots[source] = null;
      this.heldItem = slots[heldSlot] || null;
    },
    updateHeldItem() { this.heldItem = slots[heldSlot] || null; }
  };
  const logs = [];
  const controller = new WeaponController(bot, { log: (message) => logs.push(message) });
  assert.equal(await controller.stowAfterThreat(), true);
  assert.equal(bot.heldItem, null);
  assert.equal(slots[36], null);
  assert.equal(slots[9].name, 'iron_sword');
  assert.ok(logs.some((line) => line.includes('moved from selected hotbar slot 36 to inventory slot 9')));
});
