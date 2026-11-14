# Informe de validación — Manji V12.2.5 (Legacy Damage Hash Compatibility)

Entorno de construcción: Node.js 22.16.0.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| `npm run check` — sintaxis de módulos, parche y prueba del parche | PASS |
| `npm test` — Node test runner | PASS: 89 pruebas, 0 fallos |
| Conversión del tag NBT antiguo `Damage=0` a ausencia del componente (valor predeterminado) | PASS: prueba del hash en fixture ejecutable |
| Conversión del tag NBT antiguo `Damage` positivo al componente moderno `damage` | PASS: prueba del hash en fixture ejecutable |
| Rechazo de NBT adicional, mal formado o ambiguo | PASS |
| `postinstall`: aplicación del parche a la ruta de Mineflayer esperada | PASS: fixture sintético |
| Idempotencia del parche de Mineflayer | PASS: segunda ejecución no vuelve a modificar el archivo |
| Rechazo seguro si la estructura de `item_hash.js` no coincide | PASS |
| Resto de pruebas de combate, navegación, memoria, inventario y ciclo de vida de Manji | PASS |

## Qué modifica el hotfix

El log real de V12.2.4 mostró que `bot.equip()` falla dentro de `toHashedSlot()` al encontrar un NBT que contiene únicamente `Damage: int:0`, mientras `components` está vacío. Minecraft sustituyó el antiguo tag NBT `Damage` por el componente `minecraft:damage`; el valor predeterminado para objetos dañables es cero. Este hotfix permite exclusivamente ese tag heredado aislado: omite el cero predeterminado y traduce valores positivos al hash del componente `damage`.

El parche se ejecuta mediante `postinstall`. Si el archivo de Mineflayer no contiene exactamente el guard y el punto de inserción esperados, el script detiene la instalación sin modificar código desconocido. No se suprimen ni descartan tags NBT adicionales.

## Límites

- La prueba ejecutable del hash utiliza un fixture sintético con la misma estructura relevante de `toHashedSlot`; no es una prueba de integración contra el paquete real ni contra BiggestWorld.
- Aún no se ha verificado que BiggestWorld acepte el clic de inventario ni que Manji aparezca equipado. Es necesaria la prueba en vivo.
- El registro sigue mostrando un `PartialReadError` en el paquete de avances (`packet 0x85`). Este hotfix no intenta corregir ese problema separado.
- No se ha realizado una prueba de 24 horas.

## Estado

`12.2.5-legacy-damage-hash-compatibility`. Hotfix focalizado pendiente de validación en el servidor real. No se cambian las dependencias principales ni la configuración del servidor.
