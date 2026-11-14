# Manji V12.2 — Corner Recovery + Adaptive Equipment (alpha.1)

Esta versión parte de V12.1.1. Mantiene el endpoint, autenticación offline, memoria, lógica autónoma, reconexión y parámetros generales; los cambios funcionales se concentran en inventario/equipamiento y recuperación de navegación.

## Cambios funcionales

### Armadura
- Escaneo explícito de las ranuras 9..44 del inventario del jugador (mochila y barra rápida), sin depender de que `inventory.items()` devuelva una vista completa.
- Tras equipar, espera y verifica que el ítem aparece realmente en la ranura solicitada.
- Vuelve a revisar después de `updateSlot` y periódicamente cada 8 segundos.
- Registra qué prendas detectó, su ranura de origen y qué nombres vio cuando no reconoce armadura; así se pueden añadir palabras clave de mods con evidencia.
- Conserva la pieza sustituida y no tira equipamiento.

### Espada y herramientas
- Al iniciar, intenta guardar espada/hacha/herramienta ya seleccionada.
- Mantiene la espada guardada durante la persecución. Solo la saca al entrar en distancia de golpe, después de comprobar que el objetivo sigue presente y visible. La guarda de nuevo al terminar el intento.
- Las herramientas identificadas (pico, pala, azada, tijeras, mechero, cepillo y caña) no se restauran automáticamente en la mano tras un combate.
- Si el inventario está lleno y no existe una ranura para guardarla, no la tira al suelo; registra el aplazamiento.
- Los jugadores siguen excluidos como objetivos de ataque.

### Recuperación de esquinas y obstáculos
- Ante `stuck`, `noPath` o ausencia de progreso, primero genera desvíos cortos alrededor de la posición del bot para dejar de empujar contra la cara/esquina del bloque.
- Filtra candidatos por suelo y espacio libre de dos bloques, y previsualiza rutas con Pathfinder antes de seleccionar el destino.
- Rota las direcciones en reintentos sucesivos; si no encuentra un desvío cercano, recurre a flanqueos previos.
- El umbral de atasco de combate se ajusta mediante `navigation.combatStuckTimeoutMs` (por defecto 1450 ms). Las pruebas A* están acotadas por tiempo y ceden al event loop; no se añaden pausas largas ni desconexiones.

## Compatibilidad y límites
- La equipación vanilla se implementa con los destinos Mineflayer `head`, `torso`, `legs`, `feet`; un servidor/mod puede rechazar una prenda no compatible con esas ranuras.
- Los atributos térmicos reales del mod de estaciones aún no se leen: la preferencia de invierno sigue siendo heurística por nombre. Hace falta el nombre del mod y sus identificadores internos para integrarlo.
- La recuperación de esquina está orientada al combate/persecución. El explorador conserva su watchdog y recuperación A* anteriores; no se promete resolver cualquier mapa, colisión de mod o hueco físico.
- No se ha probado en vivo con BiggestWorld ni con una sesión de 24 horas.
