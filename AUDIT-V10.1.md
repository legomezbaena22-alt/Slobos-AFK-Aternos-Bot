# Auditoría técnica de la fuente aportada

## Fuente de referencia

Archivo auditado: `Slobos-AFK-Aternos-Bot-main(2).zip`, adjuntado en esta conversación. Se ha conservado intacto el ZIP original y se ha trabajado en una copia separada. El proyecto se etiqueta como v10.1 en el README de origen; el `package.json` original declaraba `2.3.0`. La fuente contiene un `index.js` monolítico de aproximadamente 104 KB, `settings.json`, `logger.js`, `leaveRejoin.js`, un ejemplo de `server.properties` y no contiene pruebas automatizadas ni `package-lock.json`.

## Comparación con artefactos anteriores disponibles

Además del ZIP actual se encontraron copias de trabajo anteriores en el entorno:

- **v8**: `manji-compare/v8/index.js` y `settings.json` (referencia previa marcada como estable).
- **v11**: `manji-compare/Manji-v11-Intelligent-Navigation/` (código y README de navegación inteligente).
- **v10.1**: el ZIP adjunto en esta conversación, usado como fuente primaria y preservado en `index.js.v10.1.backup`.

La comparación de código/configuración indica:

- v11 ya incluía evaluación de varios destinos con `getPathTo`, memoria temporal de visitados/fallos, progreso por nodos, detección de oscilación, `stuck`, límite de tiempo y penalización suave de subidas. V12 conserva esa lógica de navegación y la evoluciona al cálculo incremental `getPathFromTo` por segmentos, junto con memoria persistente y una capa de prioridades.
- Se mantienen en el controlador v12 los componentes de combate/defensa, raycast de línea de visión, lógica especial de creeper, gestión de arma y reacciones existentes; no se sustituyó el combate por `mineflayer-pvp`.
- Respecto a la configuración v11, se conservan el destino, radio y comportamiento funcional. La memoria de rutas amplía su caducidad de 90 segundos a 7 días; se evalúan hasta 4 candidatos en vez de 3 y se añade presupuesto total de preevaluación de 1.500 ms. El intervalo de espera inicial de reconexión continúa en 5 segundos y el máximo es 120 segundos.
- No se halló una versión local comprobable del repositorio remoto ni acceso a la instancia desplegada en Railway. Por tanto, la comparación llega a los ZIP/carpeta locales disponibles; **no certifica** que GitHub o Railway estén ejecutando exactamente ese contenido.

Esta comparación es estática de archivos y configuración. No representa pruebas de regresión en un servidor Minecraft real.

## Configuración y funciones observadas

- Cuenta/bot: `Manji`, autenticación `offline`.
- Servidor predeterminado: `BiggestWorld.aternos.me:63406`, versión `26.3`.
- Centro de exploración: `(-29.459, 70, 343.514)`, radio `60`.
- Pathfinder instalado como plugin; movimiento con `Movements`, `GoalNear` y `GoalFollow`.
- `canDig=false`; la configuración anterior desactivaba torres y parkour. El movimiento principal era un paseo procedural por waypoints, con detección elemental de falta de progreso; no evaluaba rutas alternativas con memoria persistente.
- La autoconexión estaba activada; el flujo `end` programa reconexión con backoff exponencial, jitter y límite configurado de 120 s. `keepAlive`, `respawn` y timeout de conexión también estaban habilitados.
- No había memoria persistente del cerebro, serialización de objetivos ni estadísticas de navegación guardadas.
- La ausencia de jugadores humanos no era una condición que pausara explícitamente los módulos del `index.js`.
- `leaveRejoin.js` contiene una rutina de salida/entrada programada, pero el `index.js` y el script `npm start` no la importan. Por tanto, no se ha atribuido esa desconexión al flujo real de arranque. En v12 el archivo se sustituye por un stub obsoleto inocuo para impedir que una importación futura reactive una salida voluntaria.
- El combate tiene dos caminos: `combat.attack-mobs` está en `false`, mientras `interactions.self-defence.enabled` está en `true`. El controlador avanzado de autodefensa es el activo. Comprueba visibilidad con raycast, excluye a jugadores como objetivos y trata especialmente a creepers. Se conserva esta separación para evitar dos controladores de ataque simultáneos.
- Las reacciones de chat/daño y el panel Express también existen.
- El ZIP incluye un log histórico de una ejecución anterior (10 de noviembre de 2026) que registró repetidamente `unsupported protocol version: 26.3` con un build anterior identificado como v2.5. Es una evidencia de un fallo de compatibilidad de aquella ejecución; no demuestra que el fork actual `@wp2508/mineflayer` 4.42.7 falle ni que funcione. El log histórico no se incluye en el ZIP instalable para no distribuir registros de ejecución antiguos.
- `server.properties.example.txt` tenía `pause-when-empty-seconds=60`, lo que permite que el servidor Java pause cuando se queda sin jugadores conectados durante ese periodo. Esto es configuración del servidor y no se puede corregir desde el proceso de Mineflayer.

## Problemas/riesgos observados y respuesta en v12

| Hallazgo | Respuesta en v12 | Estado |
|---|---|---|
| Cerebro y navegación concentrados en `index.js` | Nuevos módulos para cerebro, sensores, memoria y planificador | Parcial: el controlador existente aún reside en `index.js` |
| Waypoints elegidos sin comparar rutas ni recordar fallos entre sesiones | Planificador superior con preevaluación A* por segmentos, puntuación de ruta y memoria temporal/persistente | Implementado en código; pendiente validar en mundo real |
| Detección de atasco básica | Seguimiento de nodos de ruta, oscilación, progreso, timeout y evento `path_reset: stuck` | Implementado en código; pendiente calibración real |
| Falta de memoria de largo plazo | JSON versionado, escritura atómica, TTL y límites por tipo | Implementado; pendiente prueba de reinicio/deploy |
| Observaciones sin caducidad propia | Caducidad por defecto de 30 días y límite máximo | Implementado y probado unitariamente |
| Lock mezclado con el directorio persistente | Lock en el filesystem de aplicación; memoria separada en el volumen | Implementado; aún exige una única réplica en host multi-instancia |
| Excepciones no controladas intentaban disparar una reconexión y seguir operando | Guardado final, limpieza y salida no cero; el supervisor externo decide reiniciar. Las desconexiones normales siguen con backoff | Implementado; la ruta de fallo se ha revisado estáticamente, no mediante un crash test inyectado |
| Reconexiones potencialmente infinitas ante errores permanentes de protocolo/autenticación | Clasificación de errores transitorios frente a fallos de configuración, prohibición o autenticación; detiene el reintento automático en causas permanentes | Implementado y probado unitariamente; validar mensajes reales del software servidor |
| Salida programada huérfana en `leaveRejoin.js` | Stub que no desconecta | Implementado |
| Reintentos/logs repetidos al guardar arma | Cooldown de 5 s, bloqueo concurrente, comprobación de ranura libre y log limitado | Implementado en controlador; no simulado contra inventario de servidor |
| Reintentos perpetuos también podían ser inútiles ante fallos permanentes | `connection/failure-policy.js` clasifica fallos transitorios vs. protocolo/autenticación/ban/whitelist | Política unitaria probada; comportamiento live pendiente |
| Auto-eat podía iniciar acciones solapadas | Mutex y cooldown | Implementado en controlador; pendiente prueba en servidor |
| Ejemplo del servidor permitía pausa cuando está vacío | Ejemplo actualizado a `pause-when-empty-seconds=0` | Documentado; requiere editar el `server.properties` real |
| Dashboard con endpoint `/command` sin autenticación propia | No se cambia la API existente; se advierte no exponer el puerto públicamente | Riesgo conocido pendiente de hardening |

## Compatibilidad de conexión

Se conservan exactamente los valores predeterminados solicitados y se respeta la prioridad de variables de entorno. La nueva validación rechaza un host vacío o un puerto inválido; no sustituye la configuración ausente por `localhost`, `127.0.0.1` o `25565`. El valor de la versión sigue siendo `26.3`.

El proyecto utiliza un fork tercero de Mineflayer para cubrir el protocolo 26.3. El Mineflayer upstream consultado anuncia soporte hasta 26.1, mientras que el fork `@wp2508/mineflayer` declara 26.3. Esa declaración del fork no equivale a certificación de Mojang ni a una prueba contra el servidor concreto del usuario. La instalación de dependencias no se pudo completar en este entorno; por ello, la compatibilidad efectiva de todo el árbol resuelto queda pendiente de validación de despliegue.

## Estado de auditoría

La evolución está construida sobre el ZIP adjunto, no sobre una descarga o una rama remota de GitHub. No se ha modificado GitHub ni Railway. `index.js.v10.1.backup` guarda la copia exacta del `index.js` de origen dentro del paquete v12, y el ZIP original sigue siendo el punto de retorno definitivo.
