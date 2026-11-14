# Investigación técnica y selección de bibliotecas

Consulta realizada el 13 de noviembre de 2026. Los datos de npm/GitHub pueden cambiar; las indicaciones de soporte de un fork se tratan como afirmaciones de su mantenedor, no como una garantía de Mojang.

## Fuentes principales

| Proyecto/fuente | Información comprobada | Decisión para Manji |
|---|---|---|
| [Mineflayer upstream](https://github.com/PrismarineJS/mineflayer) | MIT; README declara Node.js >=18 y soporte de Minecraft hasta 26.1 en la consulta. | No se sustituye la versión 26.3 del proyecto por upstream: la versión upstream consultada no declara 26.3. |
| [`@wp2508/mineflayer` 4.42.7](https://www.npmjs.com/package/@wp2508/mineflayer) | Fork de Mineflayer, declara soporte 26.3/protocolo 777, Node >=18 y licencia MIT; lista 20 dependencias y 0 dependientes en la ficha consultada. Publicación reciente (~12 días en la ficha). | Se conserva porque es el cliente existente que declara compatibilidad con 26.3. Es un fork no oficial, con historial corto y sin pruebas de este servidor; riesgo principal de compatibilidad. |
| [`@wp2508/minecraft-data` 3.111.7](https://www.npmjs.com/package/@wp2508/minecraft-data) | Fork de `minecraft-data`; declara datos para 26.3/protocolo 777, licencia MIT y 0 dependencias. | Se conserva, porque Mineflayer/pathfinder necesitan tablas actualizadas de entidades, bloques e ítems. Declaración del fork pendiente de validación live. |
| [`@wp2508/prismarine-physics` 1.12.4](https://www.npmjs.com/package/@wp2508/prismarine-physics) | Fork de `prismarine-physics` para 26.3; 3 dependencias; MIT. | Se mantiene como override transitivo declarado por el proyecto original. No se añade una segunda biblioteca de físicas. |
| [`mineflayer-pathfinder` 2.4.5](https://github.com/PrismarineJS/mineflayer-pathfinder) | MIT; A*; costes por movimiento y funciones de navegación; npm lista 7 dependencias. La API documenta `getPathFromTo` como generador, con presupuesto por llamada `tickTimeout`, y `getPathTo` como llamada síncrona. | Se conserva como motor de bajo nivel. V12.1 usa `getPathFromTo` en segmentos de 4 ms y cede el event loop entre segmentos. Añade un segundo grupo de desvíos locales cuando no pasa la primera tanda de rutas y un backoff de reintento. La dependencia declarada en V12.1 es `^2.4.5`; no se incluye lockfile, así que la resolución final debe comprobarse con `npm install` en el PC de despliegue. Pathfinder no toma por sí solo las decisiones de alto nivel. |
| [Railway Volumes](https://docs.railway.com/volumes/reference) | Volúmenes para datos persistentes; las réplicas no se pueden usar con volúmenes. | Se recomienda una réplica para Manji y un volumen de memoria; no escalar réplicas del cliente de juego. |
| [Railway Restart Policy](https://docs.railway.com/deployments/restart-policy) | `On Failure` es el valor predeterminado documentado con hasta 10 reinicios; `Always` depende del plan y no está disponible en Free/Trial. | Configurar y verificar la política en el panel; no prometer recuperación ilimitada sin conocer el plan. |
| [Node.js Process API — `uncaughtException`](https://nodejs.org/api/process.html#event-uncaughtexception) | Node.js advierte que una excepción no capturada deja el proceso en estado potencialmente indefinido; recomienda limpiar recursos y terminar, usando un supervisor externo para reiniciar. | V12.1 no intenta seguir operando tras un fallo de proceso no controlado. |
| [Railway Restart Policy](https://docs.railway.com/deployments/restart-policy) | `On Failure` es el valor predeterminado documentado con hasta 10 reinicios; `Always` depende del plan y no está disponible en Free/Trial en la consulta. | Se indica que la política del host es una capa externa y puede limitar reinicios; debe verificarse en el panel. |
| [Railway Volumes](https://docs.railway.com/volumes/reference) | Los volúmenes montan almacenamiento persistente; las réplicas no se pueden usar con volúmenes en el mismo servicio. | Se documenta una sola réplica y persistencia de memoria en `/data`. |
| [Minecraft Java 1.21.2 – notas oficiales](https://www.minecraft.net/da-dk/article/minecraft-java-edition-1-21-2) | Mojang introdujo `pause-when-empty-seconds`, default 60; un valor positivo pausa el servidor cuando no hay jugadores online. | El ejemplo de `server.properties` en el paquete usa 0 para deshabilitar esa pausa vanilla. Esto no evita suspensión del proveedor o del equipo. |
| [Mob AI / Brain (Minecraft Wiki)](https://minecraft.wiki/w/Mob_AI) | Referencia comunitaria sobre brain providers, módulos de memoria, sensores, actividades y prioridades de comportamientos. | Se usa como modelo conceptual de arquitectura, no como código oficial de Mojang portado. |

## Bibliotecas evaluadas y no incorporadas

| Proyecto | Situación observada | Motivo para no añadirlo en esta fase |
|---|---|---|
| `mineflayer-statemachine` 1.7.0 | MIT; 10 dependencias; publicación indicada hace unos 4 años. | No hace falta sumar otro framework de estados: el `ActivityBrain` propio es pequeño, testeable y permite definir prioridades/interrupciones sin introducir dependencias. |
| `mineflayer-collectblock` 1.6.0 | MIT; 3 dependencias (Mineflayer, Pathfinder y `mineflayer-tool`); publicación indicada hace 2 años. | No está en el alcance funcional actual de Manji (no se ha pedido minería/recolección). Añadirlo arrastraría otra dependencia y más interacciones de navegación. |
| `mineflayer-pvp` 1.3.2 | MIT; requiere Pathfinder; la última publicación indicada es de hace 4 años. | El proyecto ya tiene defensa personalizada con raycast LOS, exclusión de jugadores, armas, retirada y comportamiento de creeper. Sustituirla por un controlador adicional podría generar dos propietarios del pathfinder. |
| `mineflayer-auto-eat` 5.0.3 | La ficha advierte que es ESM-only y no soporta CommonJS; publicación indicada hace un año. | `index.js` es CommonJS. Se mantiene auto-eat local y se añade exclusión mutua/cooldown, sin conversión parcial del proyecto a ESM. |
| `mineflayer-tool` 1.2.0 | MIT; última publicación indicada hace 5 años. | No hace falta selección de herramienta/minería para los comportamientos pedidos. Evita dependencia innecesaria y no aporta nada al combate actual. |
| `mineflayer-armor-manager` 2.0.1 | MIT; peer dependency Mineflayer `^4.10.0`; publicación indicada hace 3 años. | La gestión de armadura no se pidió. Su autoequipamiento podría interferir con la política de tener el arma en la mano solo durante combate. |

## Arquitectura de IA elegida

Se implementa una combinación ligera de:

1. **Priority/activity controller** (ActivityBrain): compara señales por prioridad y TTL. Emergencia > combate > recuperación > investigación > observación breve > exploración > idle.
2. **Sensors**: construyen snapshots periódicos del estado del bot, entidades, agua/lava y número de jugadores humanos. Ese número es informativo y no detiene la IA.
3. **Behaviors interruptibles**: navegación/exploración, investigación de entidad cercana, emergencia por lava y autodefensa preexistente. El pathfinder sigue siendo el propietario de locomoción de cada comportamiento; prioridades detienen la exploración antes de que otro objetivo la sustituya.
4. **Short/long operational memory**: ubicaciones visitadas, celdas fallidas, observaciones de entidades, estadísticas y última actividad; JSON con TTL/cupos y persistencia atómica.
5. **A* planner above Pathfinder**: genera destinos dentro del radio, evalúa varios candidatos en forma incremental y penaliza ascensos innecesarios, vueltas, visitas y fallos recientes.

La inspiración en los aldeanos es el patrón sensors + memories + activities + priorities descrito por la documentación comunitaria del sistema Brain. No se ha replicado su código Java interno, POI, profesiones, camas ni horarios.

## Límites de la investigación

- No existe una API pública de Mineflayer que convierta una entidad jugador en un NPC de servidor con el tick nativo de IA de aldeanos. Manji sigue siendo un cliente Java conectado al servidor.
- La compatibilidad declarada por `@wp2508` para 26.3 necesita ser comprobada contra el software concreto del servidor y los plugins que use.
- No se ha realizado auditoría completa de issues/PRs de todos los proyectos; las fichas y repositorios consultados son una evaluación técnica de integración, no una certificación de seguridad.
- Las licencias principales de los proyectos enumerados son MIT según sus fichas/repo. Se conserva la licencia y el código original del proyecto. No se copió código fuente de esos plugins dentro de Manji.


## Cambios V12.1 y APIs usadas

- [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md): `bot.equip`, `bot.unequip`, estado de inventario, `food`, `foodSaturation` y eventos de entidad. V12.1 envuelve operaciones de equipamiento con timeout y comprueba el resultado recibido; las pruebas de unidad no sustituyen una prueba real de ventana/inventario.
- [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder): `GoalFollow`, `GoalNear`, `GoalCompositeAny`, `getPathFromTo`, `path_reset` y `path_update`. El controlador usa estos primitives para flanqueo y desvíos; no se incorpora el código fuente de la IA vanilla de aldeanos/saqueadores.
- [Efecto Saturation y comando effect](https://minecraft.wiki/w/Commands/effect): la saturación permanente se gestiona en servidor mediante efecto repetido o plugin, no manipulando valores locales del cliente.


## V12.1.1 — Armor equipment API
- Mineflayer API, `bot.equip(item, destination)` y destinos documentados `head`, `torso`, `legs`, `feet`, `hand`, `off-hand`: https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
- La compatibilidad con prendas de un mod depende de que el servidor acepte el ítem en un destino de equipamiento reconocido. Los nombres personalizados se clasifican mediante las palabras clave configurables de `settings.json`.


## V12.2 implementation references

- Mineflayer API — `bot.equip(item, destination)`, `bot.unequip(destination)`, `bot.getEquipmentDestSlot(destination)`, and inventory slot updates: https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
- Mineflayer Pathfinder — movement configuration and pathfinder `stuck` / `path_update` events: https://github.com/PrismarineJS/mineflayer-pathfinder

These references document API contracts; they do not certify in-game behavior with a modded server or a specific collision setup.
