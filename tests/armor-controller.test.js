'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ArmorController,
  classifyArmorSlot,
  getEnchantments,
  scoreArmorItem,
  flattenItemText,
  describeItemSerialization
} = require('../combat/armor-controller');

const EQUIPMENT_SLOTS = { head: 5, torso: 6, legs: 7, feet: 8 };

function makeBot({ inventoryItems = [], equipped = {} } = {}) {
  const slots = Array(46).fill(null);
  for (const item of inventoryItems) slots[item.slot] = { ...item };
  for (const [destination, item] of Object.entries(equipped)) {
    slots[EQUIPMENT_SLOTS[destination]] = { ...item, slot: EQUIPMENT_SLOTS[destination] };
  }

  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: {
      slots,
      items() { return slots.slice(9, 45).filter(Boolean); }
    },
    getEquipmentDestSlot(destination) { return EQUIPMENT_SLOTS[destination]; },
    async equip(item, destination) {
      const destinationSlot = EQUIPMENT_SLOTS[destination];
      const sourceSlot = slots.findIndex((candidate) => candidate === item);
      if (sourceSlot < 0) throw new Error('item not present in inventory');
      const previous = slots[destinationSlot];
      slots[destinationSlot] = { ...item, slot: destinationSlot };
      slots[sourceSlot] = previous ? { ...previous, slot: sourceSlot } : null;
    }
  };
}

test('armor item classifier recognizes vanilla armor and common modded clothing names', () => {
  assert.equal(classifyArmorSlot({ name: 'diamond_helmet' }), 'head');
  assert.equal(classifyArmorSlot({ name: 'winter_parka' }), 'torso');
  assert.equal(classifyArmorSlot({ name: 'fur_leggings' }), 'legs');
  assert.equal(classifyArmorSlot({ name: 'insulated_boots' }), 'feet');
  assert.equal(classifyArmorSlot({ name: 'iron_sword' }), null);
});

test('custom clothing keywords can map modded items to a specific armor slot', () => {
  assert.equal(
    classifyArmorSlot({ name: 'seasonal_outfit_07' }, { torso: ['seasonal_outfit'] }),
    'torso'
  );
});

test('controller equips all four armor slots from inventory without touching other items', async () => {
  const bot = makeBot({ inventoryItems: [
    { name: 'leather_helmet', type: 1, count: 1, slot: 9 },
    { name: 'iron_chestplate', type: 2, count: 1, slot: 10 },
    { name: 'chainmail_leggings', type: 3, count: 1, slot: 11 },
    { name: 'leather_boots', type: 4, count: 1, slot: 12 },
    { name: 'torch', type: 5, count: 16, slot: 13 }
  ] });
  const messages = [];
  const controller = new ArmorController(bot, { log: (message) => messages.push(message) });

  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(bot.inventory.slots[5].name, 'leather_helmet');
  assert.equal(bot.inventory.slots[6].name, 'iron_chestplate');
  assert.equal(bot.inventory.slots[7].name, 'chainmail_leggings');
  assert.equal(bot.inventory.slots[8].name, 'leather_boots');
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'torch'));
  assert.equal(messages.filter((message) => message.includes('Equipped ')).length, 4);
  assert.ok(messages.some((message) => message.includes('Player inventory scan')));
});

test('controller prefers stronger armor and enchanted pieces over weaker candidates', async () => {
  const ironHelmet = {
    name: 'iron_helmet', type: 1, count: 1, slot: 9,
    enchants: [{ name: 'protection', level: 4 }]
  };
  const diamondHelmet = { name: 'diamond_helmet', type: 2, count: 1, slot: 10 };
  const bot = makeBot({ inventoryItems: [diamondHelmet, ironHelmet] });
  const controller = new ArmorController(bot);

  assert.ok(scoreArmorItem(ironHelmet, 'head') > scoreArmorItem(diamondHelmet, 'head'));
  await controller.equipBestAvailable();
  assert.equal(bot.inventory.slots[5].name, 'iron_helmet');
});

test('controller upgrades equipped armor but keeps the displaced piece in inventory', async () => {
  const diamond = { name: 'diamond_chestplate', type: 1, count: 1, slot: 9 };
  const bot = makeBot({
    inventoryItems: [diamond],
    equipped: { torso: { name: 'leather_chestplate', type: 2, count: 1 } }
  });
  const controller = new ArmorController(bot);

  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(bot.inventory.slots[6].name, 'diamond_chestplate');
  assert.ok(bot.inventory.slots.some((item) => item && item.name === 'leather_chestplate'));
});

test('controller never replaces stronger equipped armor with a downgrade', async () => {
  const leather = { name: 'leather_helmet', type: 1, count: 1, slot: 9 };
  const bot = makeBot({ inventoryItems: [leather], equipped: { head: { name: 'netherite_helmet', type: 2, count: 1 } } });
  const controller = new ArmorController(bot);

  assert.equal(await controller.equipBestAvailable(), false);
  assert.equal(bot.inventory.slots[5].name, 'netherite_helmet');
  assert.equal(bot.inventory.slots[9].name, 'leather_helmet');
});

test('winter and thermal clothing receives a modest seasonal preference', () => {
  const plain = { name: 'leather_chestplate' };
  const warm = { name: 'winter_leather_jacket' };
  assert.ok(scoreArmorItem(warm, 'torso') > scoreArmorItem(plain, 'torso'));
});

test('NBT enchantments are read when the item API does not expose direct enchant fields', () => {
  const item = {
    name: 'iron_boots',
    nbt: {
      value: {
        Enchantments: {
          value: {
            value: [{
              value: {
                id: { type: 'string', value: 'minecraft:feather_falling' },
                lvl: { type: 'short', value: 4 }
              }
            }]
          }
        }
      }
    }
  };
  assert.equal(getEnchantments(item).get('feather_falling'), 4);
  assert.ok(scoreArmorItem(item, 'feet') > scoreArmorItem({ name: 'iron_boots' }, 'feet'));
});

test('controller pauses armor changes while the combat/equipment system is busy', async () => {
  const bot = makeBot({ inventoryItems: [{ name: 'iron_helmet', type: 1, count: 1, slot: 9 }] });
  let allowed = false;
  const controller = new ArmorController(bot, { canRun: () => allowed });

  assert.equal(await controller.equipBestAvailable(), false);
  assert.equal(bot.inventory.slots[5], null);
  allowed = true;
  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(bot.inventory.slots[5].name, 'iron_helmet');
});

test('controller does not remove existing armor when no candidate is available', async () => {
  const bot = makeBot({ equipped: { feet: { name: 'diamond_boots', type: 1, count: 1 } } });
  const controller = new ArmorController(bot);
  assert.equal(await controller.equipBestAvailable(), false);
  assert.equal(bot.inventory.slots[8].name, 'diamond_boots');
});

test('controller reads backpack slots 9..35 even if inventory.items() is empty or filtered', async () => {
  const slots = Array(46).fill(null);
  slots[12] = { name: 'leather_tunic', type: 20, count: 1, slot: 12 };
  slots[27] = { name: 'chainmail_leggings', type: 21, count: 1, slot: 27 };
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { slots, items() { return []; } },
    getEquipmentDestSlot(destination) { return EQUIPMENT_SLOTS[destination]; },
    async equip(item, destination) {
      const source = slots.findIndex((candidate) => candidate === item);
      const target = EQUIPMENT_SLOTS[destination];
      slots[target] = { ...item, slot: target };
      slots[source] = null;
    }
  };
  const controller = new ArmorController(bot);
  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(slots[6].name, 'leather_tunic');
  assert.equal(slots[7].name, 'chainmail_leggings');
});

test('armor classifier normalizes Spanish display names and mod equipment-slot metadata', () => {
  assert.equal(classifyArmorSlot({ name: 'mod:outfit_01', displayName: 'Túnica de cuero' }), 'torso');
  assert.equal(classifyArmorSlot({ name: 'mod:garment_01', equipmentSlot: 'feet' }), 'feet');
});


test('armor scan reports visible carried item names when no armor slot is recognized', async () => {
  const bot = makeBot({ inventoryItems: [{ name: 'strange_mod_item_07', type: 9, count: 1, slot: 15 }] });
  const messages = [];
  const controller = new ArmorController(bot, { log: (message) => messages.push(message) });
  assert.equal(await controller.equipBestAvailable(), false);
  assert.ok(messages.some((message) => message.includes('strange_mod_item_07')));
});


test('controller also equips armor found in the hotbar slots 36..44', async () => {
  const slots = Array(46).fill(null);
  slots[41] = { name: 'iron_chestplate', type: 31, count: 1 };
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { slots, items() { return []; } },
    getEquipmentDestSlot(destination) { return EQUIPMENT_SLOTS[destination]; },
    async equip(item, destination) {
      const source = slots.findIndex((candidate) => candidate === item);
      const target = EQUIPMENT_SLOTS[destination];
      slots[target] = { ...item, slot: target };
      slots[source] = null;
    }
  };
  const controller = new ArmorController(bot);
  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(slots[6].name, 'iron_chestplate');
  assert.equal(slots[41], null);
});


test('armor classifier reads translated display-name components', () => {
  const item = { name: 'seasonal_outfit_07', displayName: { text: 'Túnica de cuero', extra: [{ text: 'de invierno' }] } };
  assert.equal(flattenItemText(item.displayName), 'Túnica de cuero de invierno');
  assert.equal(classifyArmorSlot(item), 'torso');
});

test('armor inventory merges live slots with inventory.items and preserves the true player slot', async () => {
  const slots = Array(46).fill(null);
  const helmet = { name: 'leather_helmet', type: 7, count: 1 };
  slots[12] = helmet;
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { slots, items() { return [{ ...helmet }]; } },
    getEquipmentDestSlot(destination) { return EQUIPMENT_SLOTS[destination]; },
    async equip(item, destination) {
      const source = slots.findIndex((candidate) => candidate && candidate.name === item.name);
      slots[EQUIPMENT_SLOTS[destination]] = { ...item, slot: EQUIPMENT_SLOTS[destination] };
      slots[source] = null;
    }
  };
  const controller = new ArmorController(bot);
  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(slots[5].name, 'leather_helmet');
});


test('armor controller falls back to a direct slot transfer when equip API is rejected', async () => {
  const chestplate = { name: 'leather_chestplate', type: 1, count: 1, slot: 12 };
  const bot = makeBot({ inventoryItems: [chestplate] });
  bot.equip = async () => { throw new Error('equip API unavailable in mocked fork'); };
  bot.moveSlotItem = async (source, destination) => {
    const previous = bot.inventory.slots[destination];
    bot.inventory.slots[destination] = { ...bot.inventory.slots[source], slot: destination };
    bot.inventory.slots[source] = previous ? { ...previous, slot: source } : null;
  };
  const logs = [];
  const controller = new ArmorController(bot, { log: (message) => logs.push(message) });
  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(bot.inventory.slots[6].name, 'leather_chestplate');
  assert.ok(logs.some((message) => message.includes('Used slot-transfer fallback')));
});


test('armor diagnostics expose the exact legacy Damage tag value', () => {
  const summary = describeItemSerialization({
    name: 'iron_chestplate',
    slot: 18,
    nbt: { type: 'compound', value: { Damage: { type: 'int', value: 7 } } },
    components: []
  });
  assert.match(summary, /Damage=int:7/);
  assert.match(summary, /components=array\(0\)/);
});

test('armor diagnostics retain both the primary equip error and fallback error', async () => {
  const chestplate = { name: 'iron_chestplate', type: 1, count: 1, slot: 12 };
  const bot = makeBot({ inventoryItems: [chestplate] });
  bot.equip = async () => { throw new Error('primary equip hash failure'); };
  bot.moveSlotItem = async () => { throw new Error('fallback legacy NBT hash failure'); };
  const logs = [];
  const controller = new ArmorController(bot, { log: (message) => logs.push(message) });

  assert.equal(await controller.equipBestAvailable(), false);
  const output = logs.join('\n');
  assert.match(output, /Primary bot\.equip\(\) failed.*primary equip hash failure/);
  assert.match(output, /fallback legacy NBT hash failure/);
  assert.match(output, /primary bot\.equip\(\): primary equip hash failure/);
});

test('armor controller may continue while its own armor lock is active, but defers to weapon transactions', async () => {
  const { canRunArmorTransaction } = require('../combat/armor-controller');
  const bot = makeBot({ inventoryItems: [{ name: 'iron_helmet', type: 1, count: 1, slot: 9 }] });
  const weaponController = { equipping: false, stowing: false };
  const controller = new ArmorController(bot, {
    canRun: () => canRunArmorTransaction(bot, weaponController)
  });

  assert.equal(await controller.equipBestAvailable(), true);
  assert.equal(bot.inventory.slots[5].name, 'iron_helmet');

  bot.inventory.slots[5] = null;
  bot.inventory.slots[9] = { name: 'iron_helmet', type: 1, count: 1, slot: 9 };
  weaponController.equipping = true;
  assert.equal(await controller.equipBestAvailable(), false);
  assert.equal(bot.inventory.slots[5], null);
});
