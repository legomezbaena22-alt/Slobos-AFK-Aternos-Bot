'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

test('connection defaults remain the requested Minecraft 26.3 target', () => {
  assert.equal(settings['bot-account'].username, 'Manji');
  assert.equal(settings.server.ip, 'BiggestWorld.aternos.me');
  assert.equal(settings.server.port, 63406);
  assert.equal(settings.server.version, '26.3');
});

test('autonomous controller has no player-count condition around the brain tick', () => {
  assert.match(indexSource, /sensors\.scan\(\)/);
  assert.match(indexSource, /Autonomous activity arbitration is independent of human player count/);
  assert.doesNotMatch(indexSource, /if\s*\(\s*Object\.keys\(bot\.players\)\.length\s*===\s*0\s*\)\s*return/);
});

test('leave/rejoin helper cannot initiate voluntary disconnects', () => {
  const helper = fs.readFileSync(path.join(root, 'leaveRejoin.js'), 'utf8');
  assert.doesNotMatch(helper, /bot\.(?:quit|end)\s*\(/);
  assert.doesNotMatch(helper, /setTimeout\s*\(/);
});

test('movement enables cautious parkour while forbidding digging and 1x1 towers', () => {
  assert.match(indexSource, /defaultMove\.canDig\s*=\s*false/);
  assert.match(indexSource, /defaultMove\.allow1by1towers\s*=\s*false/);
  assert.match(indexSource, /defaultMove\.allowParkour\s*=\s*navConfig\.allowParkour\s*!==\s*false/);
  assert.equal(settings.navigation.allowParkour, true);
  assert.match(indexSource, /defaultMove\.maxDropDown\s*=\s*3/);
  assert.match(indexSource, /defaultMove\.liquidCost\s*=\s*5/);
});

test('automatic food hunting is disabled and hunger is monitored from server state', () => {
  assert.equal(settings.combat['auto-eat'], false);
  assert.equal(settings.survival.saturation.source, 'server-side');
  assert.match(indexSource, /bot\.foodSaturation/);
  assert.match(indexSource, /Manji does not auto-hunt or craft food/);
});


test('V12.2.2 keeps the 24/7 reconnect policy and avoids unnecessary auto-auth', () => {
  assert.equal(settings.utils['auto-reconnect'], true);
  assert.equal(settings.utils['auto-auth'].enabled, false);
  assert.equal(settings.utils['max-reconnect-delay'], 120000);
  assert.equal(settings.navigation.combatStuckTimeoutMs, 1450);
  assert.equal(settings.equipment.armor['rescan-on-inventory-change'], true);
});

test('normal combat keeps its sword equipped until the encounter ends', () => {
  const combatStart = indexSource.indexOf('// Other hostile mobs: draw the weapon once');
  const equipCall = indexSource.indexOf('const weaponReady = await equipBestWeapon()', combatStart);
  const attackWindow = indexSource.indexOf('const attackWindow = targetDistance <= 3.35', equipCall);
  const attackCall = indexSource.indexOf('bot.attack(target)', attackWindow);
  const combatEnd = indexSource.indexOf("bot.on('entityDead'", attackCall);
  const attackBlock = indexSource.slice(equipCall, combatEnd);
  assert.ok(combatStart >= 0 && equipCall > combatStart && attackWindow > equipCall && attackCall > attackWindow);
  assert.doesNotMatch(attackBlock, /stowCombatWeapon\(\)/);
  assert.match(indexSource, /function stopCombat\(reason\)[\s\S]*?void stowCombatWeapon\(\)/);
  assert.match(indexSource, /target-lost-grace-ms/);
  assert.match(indexSource, /selectCombatTarget\(/);
});

test('periodic BiggestWorld chat messages are enabled every five minutes', () => {
  assert.equal(settings.utils['chat-messages'].enabled, true);
  assert.equal(settings.utils['chat-messages'].repeat, true);
  assert.equal(settings.utils['chat-messages']['repeat-delay'], 300);
  assert.ok(settings.utils['chat-messages'].messages.length >= 3);
});

test('armor lock policy permits its own transaction and blocks competing equipment actions', () => {
  const { canRunArmorTransaction } = require('../combat/armor-controller');
  const bot = {};
  const weaponController = { equipping: false, stowing: false };
  assert.equal(canRunArmorTransaction(bot, weaponController), true);
  bot.__manjiEquipmentBusy = 'armor';
  assert.equal(canRunArmorTransaction(bot, weaponController), true);
  bot.__manjiEquipmentBusy = 'weapon';
  assert.equal(canRunArmorTransaction(bot, weaponController), false);
  delete bot.__manjiEquipmentBusy;
  weaponController.stowing = true;
  assert.equal(canRunArmorTransaction(bot, weaponController), false);
});


test('exploration invokes corner recovery without blocking its own recovery signal', () => {
  assert.match(indexSource, /canInterruptForCornerRecovery\(activity\)/);
  assert.match(indexSource, /canInterruptForCornerRecovery\(activityBrain \? activityBrain\.update\(\) : 'explore'\)/);
});
