# Manji V12.1.1 — Armor Equipment (alpha.1)

Esta revisión parte de V12.1 y limita los cambios funcionales al subsistema de equipamiento de armadura. Se conservan navegación, persecución, combate, proyectiles, memoria, conexión y configuración de servidor.

## Cambios
- Nuevo `combat/armor-controller.js`, activado por defecto.
- Comprueba cabeza, torso, piernas y pies al inicio y después cada 12 segundos.
- Equipa piezas si el hueco está vacío.
- Sustituye una pieza equipada solo cuando encuentra una puntuación superior; nunca degrada deliberadamente el equipo.
- Ordena por material, encantamientos de protección y utilidad, durabilidad disponible y palabras asociadas a ropa térmica/de invierno.
- Reconoce nombres habituales de armaduras vanilla y prendas modded comunes (`helmet`, `hood`, `coat`, `jacket`, `parka`, `pants`, `boots`, etc.).
- Permite añadir palabras clave por slot en `settings.json` para ítems de mods cuyo nombre no sea estándar.
- Pausa las operaciones de armadura mientras el controlador de combate está ocupado para reducir colisiones de operaciones de inventario.
- Añade pruebas unitarias específicas de clasificación, prioridad, mejoras, no degradación, encantamientos NBT y pausa durante combate.

## Límites conocidos
- Mineflayer puede equipar un ítem en los destinos `head`, `torso`, `legs` y `feet`; el servidor/mod debe aceptar ese ítem para el slot.
- Si un mod utiliza nombres opacos o una ranura de vestimenta propia, hay que añadir sus identificadores a `custom-slot-keywords` o adaptar el controlador a la API concreta del mod.
- La detección por palabras como `winter`, `thermal`, `insulated`, `warm`, `fur` o `padded` es heurística. No lee automáticamente la estación ni los atributos térmicos internos del mod.
- No se ha probado en un servidor Minecraft 26.3 con el mod de estaciones del usuario.
