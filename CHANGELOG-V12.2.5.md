# Manji V12.2.5 — Legacy Damage Hash Compatibility

## Corrección enfocada del inventario
- Añade un `postinstall` que aplica un parche acotado a `@wp2508/mineflayer/lib/item_hash.js`.
- Convierte el tag NBT heredado `Damage` aislado en el componente moderno `damage` al calcular el HashedSlot de los clics de inventario.
- Si `Damage` vale `0`, no añade componente porque ese es el valor predeterminado para los objetos dañables.
- Si `Damage` es un entero positivo, calcula el hash mediante el `componentHash('damage', value)` ya implementado por Mineflayer.
- Rechaza NBT heredado adicional, tags mal formados o conflictos con componentes modernos. No elimina ni descarta NBT arbitrario.
- El parche es idempotente y falla de forma explícita si el código de Mineflayer no coincide con el formato esperado.

## Dependencias
- Mantiene `@wp2508/mineflayer` 4.42.8 y `@wp2508/minecraft-data` 3.111.7.
- No actualiza dependencias ni ejecuta `npm audit fix`.

## Estado de verificación
- Incluye pruebas para el lector del tag `Damage`, traducción de valores positivos, valor por defecto cero, rechazo de NBT no compatible, idempotencia, aplicación de `postinstall` y protección ante cambios inesperados del archivo de Mineflayer.
- Validación local: `npm run check` y 89 pruebas superadas.
- Las pruebas locales de proyecto y sintaxis deben ejecutarse antes de probar el servidor.
- **No se afirma que esté validado en BiggestWorld hasta que se pruebe en la sesión real.**
