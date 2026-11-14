# Manji V12.1 – Adaptive Villager AI (alpha.1)

## Cambios de esta versión

- Nuevo `WeaponController`: prioriza espadas, las equipa durante una amenaza y, al terminar, devuelve primero el objeto que estaba en la mano al hueco original. Si no hay objeto que restaurar, usa `unequip` solo cuando existe espacio libre. No tira objetos al suelo.
- Diagnóstico de equipamiento con motivo de error y verificación del objeto equipado/guardado. Las operaciones de equipamiento y orientación tienen tiempo límite para no bloquear indefinidamente el controlador.
- Nuevo supervisor de persecución: detecta falta de progreso y el evento `path_reset: stuck`; cancela la trayectoria directa y prueba objetivos de flanqueo alrededor del enemigo mediante `GoalCompositeAny`, conservando un `GoalFollow` dinámico.
- Nueva defensa básica frente a proyectiles: predice el punto de aproximación de flechas y otros proyectiles conocidos y prueba una esquiva lateral hacia posiciones con suelo y espacio libre. No afirma que haya encontrado cobertura si solo ha esquivado.
- Apuntado ajustado a la zona superior del torso para evitar mirar excesivamente hacia el suelo.
- Mensajes de consola más claros: arma extraída, arma guardada, ruta de combate bloqueada, evasión de proyectil, ataque enviado y objetivo eliminado (solo al recibir `entityDead` del servidor).
- Registro de hambre/saturación informado por el servidor. La alimentación automática queda desactivada: Manji no caza, mina ni fabrica comida.
- Navegación con parkour prudente configurable, sin excavar ni construir torres de 1x1.
- El registro del modo creativo ahora indica que el cambio fue informado por el servidor; V12.1 no solicita creativo por defecto.


- Exploración en dos fases: prueba primero objetivos normales y, si A* no encuentra uno, prueba un lote independiente de desvíos de corto alcance.
- Si ninguna tanda encuentra una ruta, cambia el rumbo de búsqueda y aplica una espera progresiva de hasta 8 segundos para evitar repetir el mismo ciclo cada pocos segundos.

## Lo que no se puede garantizar desde el cliente

La saturación la controla el servidor. Mineflayer solo recibe `food` y `foodSaturation`; no puede escribir estos valores en el servidor con una propiedad local. Para mantener saturación permanentemente se necesita un command block, permiso de operador o complemento del servidor. Consulta `SERVER-SATURATION.md`.

## Límites de la alpha

- No se ha realizado una sesión real de Minecraft 26.3 desde este entorno.
- No se puede garantizar que cada geometría, bloque, mod o latencia del servidor responda igual.
- La defensa de proyectiles es una predicción geométrica básica y no equivale a la IA de un saqueador del juego.
- No se implementa todavía búsqueda de cobertura con análisis completo del terreno, construcción de escaleras, minería, crafteo ni saqueo de recursos.
- El comportamiento toma ideas de navegación y combate de entidades de Minecraft, pero no incorpora ni copia código fuente propietario de Mojang. Usa APIs públicas de Mineflayer y Mineflayer-Pathfinder.
