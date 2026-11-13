MANJI LOCAL v10 — PERSISTENT HOME SERVER EDITION
================================================

BASE
- Parte de Manji v9 (que a su vez conserva las funciones estables de v8).
- Mantiene movimiento procedural, radio de exploración de 60 bloques,
  navegación con Pathfinder, prevención de atascos, nado de recuperación,
  combate/defensa, detección por línea de visión, reacciones y diálogos.

QUÉ CAMBIA EN v10
- Elimina la desconexión cuando no hay jugadores humanos conectados.
- Manji continúa explorando y ejecutando sus módulos aunque esté solo.
- Activa la reconexión automática después de cortes, reinicios o caídas del
  servidor, con espera exponencial de 5 s hasta un máximo de 120 s y jitter.
- El retraso de reconexión solo vuelve a cero después de 2 minutos de conexión
  estable para evitar bucles rápidos si la red está intermitente.
- Mantiene el keep-alive de protocolo y amplía la comprobación de timeout a 60 s.
- Activa el respawn automático de Mineflayer y añade registros de muerte/respawn.
- Permite configurar destino y versión mediante variables de entorno.
- El botón Stop del panel detiene Manji; Start lo inicia otra vez.

CONFIGURACIÓN PARA RAILWAY + SERVIDOR EN CASA
IMPORTANTE: Railway no puede usar BiggestWorld.aternos.me para llegar al ordenador de casa.
Ese localhost apunta al propio contenedor de Railway.

En Railway > Variables, configura:
  MC_HOST   = IP pública de tu casa o nombre DDNS
  MC_PORT   = puerto TCP del servidor Minecraft (normalmente 63406)
  MC_VERSION= 26.3
  MC_USERNAME = Manji (opcional; sustituye el usuario de settings.json)
  MC_AUTH   = offline (solo si el servidor acepta cuentas offline)

Si Manji se ejecuta en el mismo ordenador que el servidor, el valor por defecto
BiggestWorld.aternos.me:63406 puede funcionar sin abrir puertos. Pero desde Railway necesitas:
1. Que el servidor escuche en su puerto de juego normal.
2. Dejar server-ip= vacío en server.properties.
3. Redirigir SOLO el puerto TCP de Minecraft desde el router al PC del servidor.
4. Permitir ese puerto TCP en el firewall del PC.
5. Usar IP pública o DDNS en MC_HOST.

Si tu conexión está detrás de CGNAT, la redirección de puertos puede no funcionar.
En ese caso, ejecuta el bot dentro de casa o usa una red privada/túnel compatible.
No expongas RCON (25575) ni paneles de administración a Internet.

AUTENTICACIÓN
- settings.json usa auth=offline por compatibilidad con el perfil anterior.
- En modo offline, el servidor debe aceptar jugadores offline. No desactives
  online-mode en un servidor expuesto públicamente sin protegerlo: permite
  suplantar nombres. Para un servidor con online-mode=true, usa una cuenta
  Microsoft legítima y configura MC_AUTH=microsoft; completa el inicio de sesión
  que solicite Mineflayer en los registros.
- MC_AUTH_PASSWORD NO es la contraseña de Microsoft; sirve únicamente para
  servidores con plugin /login o /register.

SERVER.PROPERTIES (Minecraft Java 26.3)
Revisa estos valores en el servidor doméstico:
  player-idle-timeout=0
  pause-when-empty-seconds=60

player-idle-timeout=0 evita expulsar jugadores por inactividad. El servidor
Java 26.3 incorpora pause-when-empty-seconds: con valor 60 se pausa cuando no
queda ningún jugador conectado durante 60 segundos. Mientras Manji siga conectado
es un jugador conectado; al pulsar Stop en Railway, si nadie más está dentro,
el servidor puede volver a pausarse tras ese minuto para ahorrar energía.

Si el servidor se apaga por un script externo, panel, tarea programada o por
suspensión del propio ordenador, esta propiedad de Minecraft no lo controla.
Manji puede reconectar cuando el servidor vuelva a estar disponible, pero no
puede encender un PC apagado ni recuperar una conexión doméstica sin Internet.

INSTALACIÓN
1. Sustituye index.js y settings.json en el repositorio de GitHub por los de ZIP.
2. Conserva logger.js, package.json, package-lock.json y el resto de archivos del proyecto; no cambies dependencias.
3. Añade las variables de Railway indicadas arriba.
4. Despliega el proyecto y revisa /logs o la consola de Railway.
5. Verifica que aparezca "Successfully spawned on server" y después
   "Natural exploration enabled".
6. Para apagar Manji, pulsa Stop en su panel o detén el servicio de Railway.

COORDENADAS DE EXPLORACIÓN
Se conserva el centro anterior (-29.459, 70, 343.514) y el radio de 60 bloques.
Si el mundo doméstico es una copia de BiggestWorld, deja esos valores. Si es un
mundo distinto, cambia position.x, position.y y position.z por el punto de
referencia/spawn del mundo doméstico.

VALIDACIÓN REALIZADA EN ESTE PAQUETE
- Sintaxis de index.js comprobada con node --check.
- settings.json validado como JSON.
- Se revisó que no quedan condiciones que desconecten a Manji por ausencia de
  jugadores humanos.
- No se ha probado una conexión real contra tu servidor doméstico: faltan su
  dirección/puerto accesibles desde Railway y confirmar el modo de autenticación.
