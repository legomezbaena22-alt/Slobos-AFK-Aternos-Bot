# Manji v12.2.3 — Armor diagnostics

- Pins `@wp2508/mineflayer` to 4.42.8, matching the version installed in the tested environment.
- Adds rate-limited diagnostics when armor equip fails: item object keys, NBT presence/root keys, exposed component metadata, stack ID, slot and full error stack.
- Does not change armor selection, combat, navigation or inventory transaction behavior. This is a diagnostic build, not yet a confirmed armor fix.
