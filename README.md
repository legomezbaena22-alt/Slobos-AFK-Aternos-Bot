This package builds on V12.2.4 with a narrowly-scoped compatibility patch for the legacy NBT `Damage` tag encountered while Mineflayer builds hashed inventory slot claims. A lone non-negative integer `Damage` tag is translated into the modern `damage` component; zero is omitted as the default. Other legacy NBT and ambiguous/conflicting representations remain rejected. The patch is applied by `npm install` through a guarded, idempotent `postinstall` script. It does not change the configured server, bot identity, navigation, combat, or reconnect policy.

> **Important:** this is a targeted compatibility hotfix, not a claim of live-server success. The patcher only changes `@wp2508/mineflayer/lib/item_hash.js` if the expected source guard and insertion point are present. Run `npm install`, confirm the `[Manji] Applied safe legacy Damage...` message, then run `npm run check`, `npm test`, and finally test it on BiggestWorld. If `npm install` reports that the patch could not be applied, stop and send that message rather than editing `node_modules` manually.


## 1. Defaults preserved

The committed `settings.json` retains:

```dotenv
MC_HOST=BiggestWorld.aternos.me
MC_PORT=63406
MC_VERSION=26.3
MC_USERNAME=Manji
MC_AUTH=offline
```

These remain defaults only. Environment variables take precedence. The bot does not silently switch to `localhost`, `127.0.0.1`, or port `25565` when a variable is missing. The server destination and Java port must be reachable from the machine or cloud service running Manji.

Other preserved settings include the exploration anchor `(-29.459, 70, 343.514)`, radius `60`, `Manji` username, offline auth mode, `auto-reconnect`, chat/damage reactions, and enabled advanced self-defence. The legacy `combat.attack-mobs` remains `false`; the advanced `interactions.self-defence` controller is the active hostile-mob combat system. V12.2.2 retains the dedicated weapon controller and independent idle supervisor. General BiggestWorld chat messages are enabled again and rotate every 300 seconds (5 minutes). In ordinary hostile-mob combat, the weapon is drawn once and held until the encounter ends; the idle supervisor lease is renewed by each combat scan. The creeper-specific hit-and-retreat behavior remains separate. A shared equipment lock serializes armor and hand-slot transactions. Both normal exploration and combat pursuit now have local corner-recovery routes after a stuck/noPath or lack of progress; basic projectile trajectory prediction can request lateral evasions. The armor callback now explicitly permits the armor controller to run while it owns the shared `armor` lock, while still deferring to weapon transactions. Combat retains a tracked target for up to the configured grace period after a temporary line-of-sight interruption; actual attacks still require line of sight. These are bounded heuristics, not a copy of Mojang entity AI. Do not enable both combat implementations without a deliberate regression test.

## 2. Install and run

Requirements: Node.js 22 or newer (the package's project engine requirement), an accessible Minecraft Java server, and a host that allows a persistent process.

```bash
unzip Manji-v12.2.4-Equip-Trace.zip
cd Manji-v12.2.4-Equip-Trace
cp .env.example .env   # optional template only; export its values in your shell/host
npm install
npm run check
npm test
npm start
```

`npm start` starts one Node process. Node does not automatically load this `.env` file with the current start script; set the variables in the shell or hosting panel before launch (on Linux/macOS: `set -a && . ./.env && set +a`). `npm install` is still required on the deployment host; there is no committed lockfile in this package because the source archive did not contain one. Keep the resulting lockfile in your own deployment repository after a successful, reviewed installation so subsequent deployments resolve the same dependency tree.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MC_HOST` | `BiggestWorld.aternos.me` | Java server host/IP |
| `MC_PORT` | `63406` | Java TCP port |
| `MC_VERSION` | `26.3` | Protocol version |
| `MC_USERNAME` | `Manji` | Bot account name |
| `MC_AUTH` | `offline` | Mineflayer auth mode |
| `MC_AUTH_PASSWORD` | unset | In-game `/login` or `/register` plugin password only |
| `MANJI_DATA_DIR` | `./data` | Directory for persistent brain memory |
| `MANJI_MEMORY_FILE` | `${MANJI_DATA_DIR}/manji-memory.json` | Optional explicit memory path |
| `MANJI_LOCK_FILE` | `./.manji-process.lock` | Optional process lock override; keep this off the persistent data volume |
| `PORT` | `5000` | Existing Express dashboard port |

Do not put passwords, Microsoft tokens, Discord webhooks, or private server credentials in Git. For an online-mode server, use a legitimate Microsoft account flow rather than disabling authentication on a publicly reachable server. `MC_AUTH_PASSWORD` is not the Microsoft password.

## 3. Railway / 24-hour operation

1. Configure a single Railway replica for this service. A Railway volume cannot be used with multiple replicas, and two Manji clients must not control the same account at once. The local lock prevents duplicate processes only within the same filesystem/container. Railway documents the volume/replica limitation.
2. Attach a persistent volume to `/data` and set `MANJI_DATA_DIR=/data`. Without a persistent volume, local memory files can be lost when the container is replaced. Railway mounts the volume at the configured absolute path.
3. Review the service restart policy. Railway currently documents `On Failure` as the default with a maximum of 10 restarts; `Always` is not available on Free/Trial plans. This plan-specific limit can prevent a service from restarting indefinitely after repeated crashes, so verify your current plan and settings in the dashboard.
4. Set `MC_HOST`, `MC_PORT`, and `MC_VERSION` to the actual Java server endpoint when you move away from the retained default. Railway `localhost` is the Railway container itself, not your home PC.
5. Make sure the Minecraft server itself remains powered on and reachable, and that the hosting provider permits a continuous connection/process. A persistent Node service does not power on a stopped PC or prevent an external host from suspending its Minecraft instance.
6. For a self-managed vanilla Java server, review `server.properties`. This example uses `pause-when-empty-seconds=0` so the server does not enter vanilla's empty-server pause state; `player-idle-timeout=0` prevents idle-player kicking. Hosting-provider suspension rules are separate and cannot be overridden from Manji. The vanilla default for `pause-when-empty-seconds` is 60 seconds.
7. Use only the single service replica and the platform's supported restart policy. Manji retries transient connection failures with capped exponential backoff and jitter. Permanent protocol/authentication/ban/whitelist errors stop automatic retries so they do not loop pointlessly. It does not fake players, manipulate provider panels, or evade hosting restrictions.
8. Validate with a live server where Manji is the only player. Check that the server does not pause, that sensors continue running, and that the host does not stop the service.

`server.properties.example.txt` is an example for a self-managed Java server, not a file Railway can control remotely.

## 4. Architecture

- `brain/activity-brain.js`: priority arbitration for emergency, combat, recovery, investigation, exploration, observation, and idle.
- `perception/sensor-suite.js`: periodic world/entity/health/food/liquid/player-count snapshot. Player count is informational; it does not gate autonomous behavior.
- `memory/agent-memory.js`: persistent visited cells, temporary failed cells, broad entity observations, route metrics, and last session. Entries have TTL/caps; corrupt memory is preserved to a timestamped sidecar before recovery.
- `navigation/route-planner.js` and `navigation/waypoint-recovery.js`: time-sliced Pathfinder A* previews, route cost scoring, and a two-stage normal/local-detour candidate search.
- `connection/failure-policy.js`: classifies temporary socket/DNS failures separately from permanent protocol/version/authentication/ban/whitelist failures.
- `combat/weapon-controller.js`: sword priority, equip/stow verification, safe restoration of a previous non-tool hand item, keeping tools stowed, and no-drop behavior.
- `combat/armor-controller.js`: equips missing armor pieces and replaces equipped pieces only when a stronger/enchanted/durable option is found; supports common clothing names and configurable modded-item keywords.
- `combat/approach-recovery.js` and `combat/projectile-defense.js`: flank candidate generation and a basic geometric projectile predictor with lateral evasion points.
- `index.js`: Mineflayer startup, dashboard, modules, self-defence/combat, exploration controller, survival telemetry and reconnect lifecycle.
- `tests/`: built-in Node test runner tests; no additional test framework dependency.

This is a hybrid architecture: a small weighted priority/activity controller owns the high-level choice, the existing combat and investigation routines are interruptible behaviors, and Pathfinder remains the low-level A* movement engine. It is inspired by the broad sensor/memory/activity pattern of Minecraft entity AI, not a port of Mojang's Java classes or a server-native Minecraft NPC. The adaptation is heuristic/rule-based; it does **not** train a machine-learning model.

## 5. Navigation behavior and limitations

The high-level explorer chooses candidate standing points within the configured radius, rejects unsafe local positions, previews several candidate paths incrementally, and biases away from recently visited or failed cells. The route watchdog detects lack of progress, oscillation, Pathfinder's `stuck` reset and goal timeout, then marks the affected area temporarily and plans again. Ordinary one-block steps and stairs remain allowed; cautious Pathfinder parkour is configurable and enabled by default. Digging and one-block pillar towers are disabled. If the first candidate group has no route, the explorer probes a separate short-range detour group, then rotates its search heading and increases retry backoff. Water remains possible at a cost rather than being categorically forbidden.

This improves route choice and recovery but does not guarantee every maze is solvable. It cannot see unloaded chunks, infer arbitrary server plugins, or reason about all custom block collision shapes. The included tests simulate Pathfinder results; a real spiral maze, narrow corridor, stairwell, water escape and tree/roof case still require in-game tests.

## 6. Combat and inventory

The active self-defence controller still uses the project’s existing direct line-of-sight raycast and excludes players from hostile targets. In V12.2.2 a 1.2-second idle supervisor repeatedly checks the held slot even when the combat scan is inactive. During ordinary hostile-mob combat, the weapon remains equipped and the combat scan refreshes its lease; when combat ends, the supervisor returns to its safe stow behavior. Creepers retain the cautious hit-and-retreat behavior. Recognized tools are not automatically restored to the hand after combat. It keeps the special creeper approach/strike/retreat logic and prioritizes nearby creepers. A target that becomes temporarily occluded remains locked for `interactions.self-defence.target-lost-grace-ms` (default 6500 ms), but the bot will never attack through a wall. V12.2 retains the prior armor scoring rules and strengthens the inventory/equipment path: it scans live player inventory slots 9..44 (backpack and hotbar), checks head, torso, legs and feet slots, fills empty slots, and upgrades only when the candidate score is higher. It confirms the destination slot after every equip, merges the live player slots with Mineflayer’s inventory item list, rescans after inventory updates and every three seconds, and logs each detected item with its slot and recognized armor destination. It considers armor material, relevant protection/utility enchantments, durability and common warmth-related clothing names. It never removes armor merely because no candidate exists and does not drop displaced armor; Mineflayer swaps it into the inventory during `bot.equip(item, destination)`. It will not drop a weapon just to clear the hand. Combat pursuit supervises position progress and Pathfinder stuck/noPath/timeout events; after a stall it first previews short local detours around the bot position (including rotated directions to leave block corners), then falls back to the previous wider flank goals. A geometric projectile predictor can choose lateral dodge candidates when an incoming projectile is predicted. This does not yet perform full terrain-aware cover selection or reproduce vanilla pillager AI.

Automatic eating remains disabled in V12.2: Manji will not hunt, mine, cook, craft or consume food automatically. The client can only report server-fed `food`/`foodSaturation` values. To maintain saturation indefinitely, configure the Minecraft server using the instructions in `SERVER-SATURATION.md`.

These are code-path safeguards, not proof of successful inventory transfers under every server/plugin. The armor controller also tries a verified direct slot-transfer fallback if `bot.equip()` fails while the piece remains in its source slot. Verify in a real inventory; at least one free inventory slot makes stowing the selected weapon easier.

## 7. Persistence and lifecycle

Memory is written atomically using a temporary file and rename. The default file is `data/manji-memory.json`; set `MANJI_DATA_DIR=/data` on a persistent volume. Visited/failed locations and entity observations expire and are capped. Player usernames and chat contents are not persisted.

A local process lock prevents two instances using the same application filesystem. It is deliberately not written into the persistent memory volume, so a stale lock cannot survive a container redeploy via `/data`. Across separate Railway replicas, set replicas to one. On an ordinary Minecraft disconnect, Manji saves its session and retries with capped exponential backoff and jitter. On SIGTERM/SIGINT it stops, attempts a final memory save, releases the lock, and exits. An uncaught exception or non-network unhandled rejection is treated as a process failure: Manji attempts a final save and exits non-zero so the host supervisor, not a possibly corrupted Node process, is responsible for restarting it.

## 8. Dashboard security note

The uploaded source has an Express `/command` endpoint without built-in authentication, and the dashboard exposes start/stop/log-related routes. Do not expose port `5000` directly to the public internet. Keep it private behind the hosting platform's private network or an authenticated reverse proxy. This release preserves the existing dashboard rather than silently changing its API; adding authentication should be the next security-focused change before public exposure.

## 9. Restore / rollback

- The original input ZIP remains unchanged outside this package.
- `index.js.v10.1.backup` is a byte-for-byte copy of the uploaded source's `index.js`.
- For rollback, stop the process and launch the preserved V12 folder/archive instead. Keep V12.1, V12.1.1, V12.2, V12.2.1, V12.2.2, V12.2.3 and V12.2.4 in separate directories; do not overwrite the working V12 folder until live testing has passed.
- The original uploaded ZIP is the definitive rollback artifact.

## 10. Status

See `TEST-REPORT.md` for the exact commands and boundaries of verification. The current offline suite includes 79 unit tests; these do not substitute for live protocol, inventory, collision, projectile or pathfinding validation. Do not describe this build as proven 24/7 until a single-player (Manji-only) server test and a sustained server/host soak test have passed. The combat detour watchdog remains configurable through `navigation.combatStuckTimeoutMs` (default 1450 ms). Normal exploration now also attempts a bounded local A* escape after a stalled waypoint; its corner probe is capped at 1.1 seconds and yields between slices. These changes still require live validation against the server and modded block collision shapes.


## V12.2.4 — Equip Trace

Esta versión añade registro del error original de `bot.equip()`, combina su traza con la del método alternativo `moveSlotItem()` y muestra el valor del tag NBT `Damage` cuando está disponible. Es una versión de diagnóstico: no altera el algoritmo de hash de Mineflayer ni promete corregir aún el equipamiento.


## V12.2.4 diagnostic note

This build is intended to identify the first failure inside `bot.equip()`. If the fallback also fails, the CMD output now preserves both errors and stack traces. It also includes the exact NBT `Damage` tag type/value in the serialization summary. It keeps `@wp2508/mineflayer` 4.42.8 and does not modify its installed source.
