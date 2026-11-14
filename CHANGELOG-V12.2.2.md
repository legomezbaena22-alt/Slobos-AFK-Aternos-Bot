# Manji V12.2.2 — Armor & Combat Persistence (alpha.3)

## Correcciones

### Armadura: bloqueo de integración corregido
- La comprobación `canRun` rechazaba la propia transacción después de que `ArmorController` estableciera `bot.__manjiEquipmentBusy = "armor"`.
- Ahora permite continuar cuando el bloqueo pertenece al propio controlador de armadura y sigue bloqueando transacciones simultáneas de arma/herramienta.
- Se añade una prueba de regresión que reproduce el bloqueo anterior.

### Combate: espada persistente y objetivo estable
- Para zombis, esqueletos y otros hostiles normales, Manji equipa la espada al iniciar el enfrentamiento y la mantiene en la mano mientras continúa el combate.
- Ya no guarda la espada después de cada golpe. Al terminar el combate, el supervisor de inventario vuelve a guardarla de forma segura.
- El objetivo actual se conserva durante un máximo de 6500 ms si se pierde momentáneamente la línea de visión y sigue dentro del radio de combate.
- El bot sigue necesitando línea de visión para atacar; el bloqueo solo evita que abandone el combate mientras rodea paredes o esquinas.
- Los creepers mantienen su lógica especial de golpe y retirada.
- Se añaden pruebas para la retención y caducidad del objetivo.

### Mensajes periódicos
- Se vuelven a activar los mensajes generales de BiggestWorld ya incluidos en `settings.json`.
- Se mantiene el intervalo de 300 segundos (5 minutos), sin aumentar la frecuencia.

## Validación
- `npm run check`: PASS.
- `npm test`: PASS — 79 pruebas, 0 fallos.
- No se ha ejecutado una sesión en vivo en BiggestWorld: el equipamiento real y el comportamiento del servidor deben confirmarse con una prueba en el juego.
