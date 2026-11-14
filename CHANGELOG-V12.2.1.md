# Manji V12.2.1 — Integration Fix (alpha.2)

Esta revisión responde a la prueba real del usuario: V12.2 no guardó la espada, no equipó la armadura y el atasco en esquinas siguió ocurriendo durante la exploración sin enemigos. No se modifican el host, puerto, versión Minecraft, autenticación, radio, memoria ni política de reconexión.

## Correcciones de integración añadidas en alpha.2

- Corregido un bloqueo lógico: la propia señal `recovery` que se generaba al detectar un atasco también impedía ejecutar la recuperación local. Ahora se permite esa maniobra y se siguen respetando emergencia, combate, investigación y observación.
- Para guardar una espada/herramienta, primero se intenta moverla desde la ranura activa a un hueco de la mochila, verificando que la mano queda libre. Después se prueban ranuras vacías u objetos no ofensivos de la barra rápida; nunca se tira el objeto.
- El controlador de armadura ahora tiene transferencia de ranura de respaldo cuando `bot.equip()` falla o no confirma el destino, siempre que el objeto siga en la ranura de origen. Se registran los errores y los bloqueos de transacción.

## Cambios incluidos

### Mano, espada y herramientas
- Añade un supervisor independiente que comprueba periódicamente la mano incluso cuando el controlador de combate no tiene objetivo.
- Primero intenta mover el objeto desde la ranura activa a un espacio vacío de la mochila, dejando vacía la mano.
- Si no puede, selecciona una ranura vacía de la barra rápida o una ranura con un objeto no ofensivo. `unequip` queda como último recurso con espacio disponible. Nunca tira objetos.
- Mantiene la selección de arma limitada a la ventana breve de ataque cuerpo a cuerpo validado.

### Armadura e inventario
- Combina la vista de ranuras 9..44 con `inventory.items()` para manejar mejor vistas filtradas de inventario.
- Interpreta `displayName` como texto, objetos de componente y listas de componentes.
- Registra objetos, posiciones, destinos de armadura reconocidos y objeto actualmente en la mano.
- Aumenta la frecuencia de comprobación a 3 segundos y mantiene el reescaneo al actualizar ranuras.
- Añade un bloqueo compartido para serializar transacciones de armadura y mano.

### Navegación sin enemigos y combate
- Introduce `navigation/corner-recovery.js`, que genera pequeñas rutas laterales rotatorias a partir de la posición actual.
- Cuando el watchdog de exploración detecta un atasco, prueba posiciones locales seguras y consulta A* antes de elegir un desvío.
- Conserva el sistema de desvíos y flanqueo de combate de V12.2.
- Los sondeos A* tienen un presupuesto máximo de 1.1 segundos y ceden al event loop; no se añaden esperas largas ni desconexiones voluntarias.

## Validación
- `npm run check`: PASS.
- `npm test`: 73 pruebas, 0 fallos.
- No se ha realizado una sesión real en BiggestWorld ni una prueba sostenida de 24 horas. Esta corrección resuelve dos fallos lógicos identificados en la integración anterior, pero el servidor real aún debe confirmarla. La prueba del usuario mostró que V12.2 no funcionaba correctamente en vivo; esta revisión añade integración y diagnósticos, pero requiere validación real.
