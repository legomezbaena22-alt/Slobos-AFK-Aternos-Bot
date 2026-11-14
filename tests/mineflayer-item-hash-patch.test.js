'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ERROR_MESSAGE,
  PATCH_MARKER,
  readLegacyDamageValue,
  patchSource,
  patchInstalledFile
} = require('../scripts/patch-mineflayer-item-hash');

const originalGuard = "if (item.nbt && Object.keys(item.nbt.value ?? {}).length) throw new Error('Cannot hash legacy item NBT as a modern component patch')";
const removedAnchor = 'const removed = new Set(item.removedComponents.map(component => componentName(component.type)))';
const sourceFixture = `function toHashedSlot (item) {
  ${originalGuard}
  if (!Array.isArray(item.components) || !Array.isArray(item.removedComponents)) throw new Error('Missing modern item component patch')
  const added = new Set()
  const components = item.components.map(component => {
    const type = componentName(component.type)
    if (added.has(type)) throw new Error('duplicate')
    added.add(type)
    return { type, hash: componentHash(type, component.data) | 0 }
  })
  ${removedAnchor}
  return { itemId: item.type, itemCount: item.count, components, removeComponents: [...removed].map(type => ({ type })) }
}`;

test('legacy Damage int tag is read', () => {
  assert.equal(readLegacyDamageValue({ nbt: { type: 'compound', value: { Damage: { type: 'int', value: 0 } } } }), 0);
  assert.equal(readLegacyDamageValue({ nbt: { type: 'compound', value: { Damage: { type: 'int', value: 37 } } } }), 37);
});

test('empty or absent NBT does not create a legacy damage value', () => {
  assert.equal(readLegacyDamageValue({}), null);
  assert.equal(readLegacyDamageValue({ nbt: { type: 'compound', value: {} } }), null);
});

test('only a lone non-negative integer Damage tag is accepted', () => {
  assert.throws(() => readLegacyDamageValue({ nbt: { value: { Damage: { type: 'string', value: '0' } } } }), new RegExp(ERROR_MESSAGE));
  assert.throws(() => readLegacyDamageValue({ nbt: { value: { Damage: { type: 'int', value: -1 } } } }), new RegExp(ERROR_MESSAGE));
  assert.throws(() => readLegacyDamageValue({ nbt: { value: { Damage: { type: 'int', value: 0 }, Custom: { type: 'int', value: 1 } } } }), new RegExp(ERROR_MESSAGE));
  assert.throws(() => readLegacyDamageValue({ nbt: { value: 'not-a-compound' } }), new RegExp(ERROR_MESSAGE));
});

test('Mineflayer hash patch maps positive legacy Damage and omits default zero', () => {
  const result = patchSource(sourceFixture);
  assert.equal(result.changed, true);
  assert.ok(result.source.includes(PATCH_MARKER));
  assert.ok(result.source.includes("componentHash('damage', legacyDamage) | 0"));
  assert.ok(result.source.includes("if (legacyDamage > 0)"));
  assert.ok(result.source.includes("modernDamageAlreadyPresent"));
  assert.equal((result.source.match(new RegExp(PATCH_MARKER, 'g')) || []).length, 2);
});

test('Mineflayer hash patch is idempotent', () => {
  const once = patchSource(sourceFixture).source;
  const twice = patchSource(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.alreadyPatched, true);
  assert.equal(twice.source, once);
});

test('patcher refuses unknown Mineflayer source instead of modifying it blindly', () => {
  assert.throws(() => patchSource('function toHashedSlot (item) { return null }'), /Unexpected .* layout/);
});


test('patched hash function hashes legacy Damage zero as default and positive values as modern damage', () => {
  const executableFixture = `
    function componentName (type) { return String(type); }
    function componentHash (type, data) {
      if (type !== 'damage') throw new Error('unexpected component');
      return data * 101;
    }
    ${sourceFixture}
    module.exports = toHashedSlot;
  `;
  const patched = patchSource(executableFixture).source;
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(patched, sandbox);
  const toHashedSlot = sandbox.module.exports;

  const base = { type: 5, count: 1, components: [], removedComponents: [] };
  const zero = toHashedSlot({
    ...base,
    nbt: { type: 'compound', value: { Damage: { type: 'int', value: 0 } } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(zero)), {
    itemId: 5, itemCount: 1, components: [], removeComponents: []
  });

  const damaged = toHashedSlot({
    ...base,
    nbt: { type: 'compound', value: { Damage: { type: 'int', value: 3 } } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(damaged)), {
    itemId: 5, itemCount: 1,
    components: [{ type: 'damage', hash: 303 }],
    removeComponents: []
  });
});


test('postinstall patch modifies only the expected Mineflayer file and is repeat-safe', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manji-item-hash-patch-'));
  const target = path.join(projectDir, 'node_modules', '@wp2508', 'mineflayer', 'lib', 'item_hash.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sourceFixture, 'utf8');

  const originalLog = console.log;
  console.log = () => {};
  try {
    const first = patchInstalledFile(projectDir);
    assert.equal(first.changed, true);
    assert.ok(fs.readFileSync(target, 'utf8').includes(PATCH_MARKER));

    const second = patchInstalledFile(projectDir);
    assert.equal(second.changed, false);
    assert.equal(second.alreadyPatched, true);
  } finally {
    console.log = originalLog;
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
