# Saturación permanente para Manji (Minecraft Java)

## Importante

La comida (`food`) y saturación (`foodSaturation`) son datos autoritativos del servidor. El bot no puede fijarlos localmente desde Mineflayer. V12.1 no intenta falsificar paquetes ni modificar al cliente para engañar al servidor.

Con la barra de hambre por debajo de 18 puntos, la regeneración natural normal de salud se detiene; con hambre en cero puede producirse daño por inanición según la dificultad. El hambre baja no hace que un saqueador o zombi golpee más fuerte: reduce la capacidad de recuperación y, al llegar a cero, puede causar daño por sí misma. La saturación alta permite mantener la comida repuesta y aprovechar la regeneración natural si el servidor la tiene habilitada.

La alternativa limpia, sin que Manji tenga que buscar comida, es administrar el efecto desde el propio servidor. El efecto `minecraft:saturation` repone comida y saturación. En Java, si el efecto dura más de un tick, sigue restaurando 1 punto de hambre y 2 de saturación por tick. La duración se expresa en ticks; por eso el bloque repetitivo renueva un efecto de 2 ticks continuamente.

## Opción A: bloque de comandos repetitivo

Requiere que el servidor permita bloques de comandos y que una persona con permisos de operador pueda colocarlo/configurarlo.

1. Coloca un bloque de comandos.
2. Configúralo en **Repeat** (Repetir) y **Always Active** (Siempre activo).
3. Introduce este comando, sustituyendo `Manji` si cambias el nombre del bot:

```mcfunction
effect give Manji minecraft:saturation 2 0 true
```

4. Deja el bloque activo. Ejecutándose cada tick, el efecto de saturación se renueva continuamente y repone la barra de hambre/saturación sin que Manji tenga que comer, cazar, minar o fabricar.

## Opción B: complemento del servidor

En servidores Paper/Spigot u otra plataforma con plugins, se puede utilizar un complemento que mantenga `foodLevel` y `saturation` del jugador `Manji` en sus valores máximos de forma periódica. El complemento debe ser compatible con la versión real del servidor.

## Si no tienes permisos

No existe una forma fiable de imponer saturación infinita desde el proceso Node.js de Manji sin cooperación del servidor. Pide al administrador que active una de estas opciones. Mientras tanto, V12.1 desactiva la alimentación automática y avisa cuando el servidor informe de hambre/saturación bajas.

## Referencias

- Minecraft Wiki, efecto Saturation: https://minecraft.wiki/w/Saturation_(effect)
- Minecraft Wiki, comando `/effect`: https://minecraft.wiki/w/Commands/effect
- Mineflayer API, propiedades `food` y `foodSaturation`: https://github.com/PrismarineJS/mineflayer/blob/master/index.d.ts
