# Manji V12.2.4 — Equip Trace

## Diagnóstico de equipamiento
- Registra el error original de `bot.equip()` antes de intentar el método alternativo.
- Si `moveSlotItem()` también falla, conserva en el mensaje y la traza tanto el fallo primario como el del fallback.
- Amplía el resumen de serialización para mostrar el tipo y valor del tag NBT `Damage` cuando esté presente.
- No modifica `node_modules`, la lógica de hash de Mineflayer ni el protocolo de inventario.

## Dependencias
- Mantiene `@wp2508/mineflayer` 4.42.8 y `@wp2508/minecraft-data` 3.111.7.

## Alcance
Esta versión es de diagnóstico. No afirma corregir todavía el equipamiento; su objetivo es capturar el error original que la V12.2.3 ocultaba al fallar el método alternativo.
