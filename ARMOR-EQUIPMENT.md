# Equipamiento automático de Manji V12.2.1

Manji revisa las ranuras 9..44 de su inventario (mochila y barra rápida), al iniciar, cuando cambia un slot y periódicamente cada 3 segundos. Comprueba `head`, `torso`, `legs` y `feet`. Si una ranura está vacía, equipa una pieza reconocida; si ya hay una pieza, solo la cambia cuando la candidata obtiene una puntuación superior. Combina las ranuras vivas del inventario del jugador con la vista de `inventory.items()`, interpreta nombres simples y componentes de texto traducidos, y registra cada objeto y su ranura. Tras llamar a `bot.equip(item, destination)`, espera y verifica el contenido real de la ranura; si falla y la pieza sigue en su casilla de origen, prueba `bot.moveSlotItem(sourceSlot, destinationSlot)` y vuelve a comprobar el resultado. Las operaciones de armadura y de mano comparten un bloqueo para no enviar cambios simultáneos del inventario. La pieza desplazada permanece en el inventario.

## Criterios de selección
- Material base (netherite, diamond, iron, chainmail, gold y leather).
- Encantamientos de protección y utilidad; penalización por durabilidad gastada cuando el dato está disponible.
- Preferencia heurística por nombres que contengan `winter`, `thermal`, `insulated`, `warm`, `fur`, `padded`, `wool`, `fleece`, `snow` o `down`.

## Ropa de mods
El clasificador reconoce palabras comunes en inglés y español, como `helmet`, `hood`, `hat`, `jacket`, `coat`, `parka`, `chestplate`, `tunic`, `pechera`, `peto`, `abrigo`, `pants`, `leggings`, `boots` y `zapatos`. También comprueba metadatos sencillos de ranura como `equipmentSlot`. Para nombres distintos, añade palabras del ID del ítem bajo `equipment.armor.custom-slot-keywords` en `settings.json`.

Si no reconoce ninguna prenda, el registro `[Equipment][Armor] Player inventory scan...` muestra los nombres de objetos que sí ha visto en las ranuras 9..44. Esos nombres ayudan a configurar las palabras clave correctas.

## Límite del mod de estaciones
La puntuación por palabras de invierno no equivale a leer el valor térmico real. No se detectan automáticamente estación, temperatura ni atributos internos del mod. Para integrarlos hace falta conocer el mod y los IDs/atributos de sus prendas.
