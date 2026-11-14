'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ERROR_MESSAGE = 'Cannot hash legacy item NBT as a modern component patch';
const PATCH_MARKER = 'MANJI_LEGACY_DAMAGE_TO_COMPONENT_COMPAT';

function readLegacyDamageValue (item) {
  const rawLegacyNbt = item && item.nbt ? item.nbt.value : null;
  if (rawLegacyNbt == null) return null;
  if (typeof rawLegacyNbt !== 'object' || Array.isArray(rawLegacyNbt)) {
    throw new Error(ERROR_MESSAGE);
  }
  const legacyNbt = rawLegacyNbt;
  const keys = Object.keys(legacyNbt);

  if (keys.length === 0) return null;

  // Be deliberately narrow: only translate the vanilla legacy durability tag.
  // Any other legacy NBT may carry custom data and must not be silently discarded.
  if (keys.length !== 1 || keys[0] !== 'Damage') {
    throw new Error(ERROR_MESSAGE);
  }

  const tag = legacyNbt.Damage;
  if (tag && typeof tag === 'object') {
    if (tag.type && String(tag.type).toLowerCase() !== 'int') {
      throw new Error(ERROR_MESSAGE);
    }
    if (!Number.isInteger(tag.value) || tag.value < 0) {
      throw new Error(ERROR_MESSAGE);
    }
    return tag.value;
  }

  if (!Number.isInteger(tag) || tag < 0) {
    throw new Error(ERROR_MESSAGE);
  }
  return tag;
}

function patchSource (source) {
  if (source.includes(PATCH_MARKER)) {
    return { source, changed: false, alreadyPatched: true };
  }

  const guard = /if \(item\.nbt && Object\.keys\(item\.nbt\.value \?\? \{\}\)\.length\) throw new Error\('Cannot hash legacy item NBT as a modern component patch'\)/;
  if (!guard.test(source)) {
    throw new Error('Unexpected @wp2508/mineflayer item_hash.js layout; no patch was applied.');
  }

  const damageDeclaration = `// ${PATCH_MARKER}
    // Minecraft replaced the legacy ItemStack Damage tag with the damage component.
    // Accept only a lone, valid legacy Damage tag; retain rejection of all other NBT.
    const legacyDamage = (${readLegacyDamageValue.toString()})(item);`;

  let patched = source.replace(guard, damageDeclaration);

  const removedAnchor = 'const removed = new Set(item.removedComponents.map(component => componentName(component.type)))';
  if (!patched.includes(removedAnchor)) {
    throw new Error('Could not find Mineflayer removed-components anchor; no patch was applied.');
  }

  const legacyDamageBlock = `${removedAnchor}
    // ${PATCH_MARKER}: translate legacy durability into the modern hashed component.
    if (legacyDamage !== null) {
      const modernDamageAlreadyPresent = added.has('damage') ||
        item.removedComponents.some(component => componentName(component.type) === 'damage');
      if (modernDamageAlreadyPresent) {
        throw new Error('Item contains both legacy NBT Damage and a modern damage component patch');
      }
      if (legacyDamage > 0) {
        added.add('damage');
        components.push({ type: 'damage', hash: componentHash('damage', legacyDamage) | 0 });
      }
    }`;
  patched = patched.replace(removedAnchor, legacyDamageBlock);

  return { source: patched, changed: true, alreadyPatched: false };
}

function patchInstalledFile (projectDir = process.cwd()) {
  const target = path.join(projectDir, 'node_modules', '@wp2508', 'mineflayer', 'lib', 'item_hash.js');
  if (!fs.existsSync(target)) {
    throw new Error(`Mineflayer item hash file not found: ${target}`);
  }

  const original = fs.readFileSync(target, 'utf8');
  const result = patchSource(original);
  if (result.changed) {
    fs.writeFileSync(target, result.source, 'utf8');
    console.log('[Manji] Applied safe legacy Damage → modern component compatibility patch to @wp2508/mineflayer.');
  } else {
    console.log('[Manji] Mineflayer legacy Damage compatibility patch is already applied.');
  }
  return result;
}

if (require.main === module) {
  try {
    patchInstalledFile();
  } catch (error) {
    console.error(`[Manji] Could not patch Mineflayer item hashing: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ERROR_MESSAGE,
  PATCH_MARKER,
  readLegacyDamageValue,
  patchSource,
  patchInstalledFile
};
