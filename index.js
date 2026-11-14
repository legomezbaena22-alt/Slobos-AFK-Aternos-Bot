"use strict";

const { addLog, getLogs } = require("./logger");
const path = require("node:path");
const { AgentMemory } = require("./memory/agent-memory");
const { ActivityBrain } = require("./brain/activity-brain");
const { SensorSuite } = require("./perception/sensor-suite");
const { RoutePlanner } = require("./navigation/route-planner");
const { planWaypointWithFallback } = require("./navigation/waypoint-recovery");
const { WeaponController, withTimeout } = require("./combat/weapon-controller");
const { ArmorController, canRunArmorTransaction } = require("./combat/armor-controller");
const { selectCombatTarget } = require("./combat/target-lock");
const { buildApproachCandidates } = require("./combat/approach-recovery");
const { buildCombatDetourCandidates } = require("./navigation/combat-detour");
const { buildCornerEscapeCandidates, canInterruptForCornerRecovery } = require("./navigation/corner-recovery");
const { findIncomingProjectile, buildLateralDodgePoints } = require("./combat/projectile-defense");
const { isPermanentConnectionFailure, isRecoverableNetworkFailure, reconnectAfterKick } = require("./connection/failure-policy");
const mineflayer = require("@wp2508/mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalFollow, GoalCompositeAny } = goals;
const config = require("./settings.json");
// Local-home-server deployment: Railway must receive the public host/port via
// environment variables. A Railway container's localhost is NOT the user's PC.
config.server.ip = process.env.MC_HOST || config.server.ip;
// Deliberately do not silently fall back to 25565 or localhost. The committed
// settings.json keeps the user's requested default until explicitly changed.
const configuredPort = process.env.MC_PORT && String(process.env.MC_PORT).trim() !== ""
  ? process.env.MC_PORT
  : config.server.port;
config.server.port = Number(configuredPort);
config.server.version = process.env.MC_VERSION || config.server.version;
config["bot-account"].username = process.env.MC_USERNAME || config["bot-account"].username;
config["bot-account"].type = process.env.MC_AUTH || config["bot-account"].type;
if (!config.server.ip || !Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
  throw new Error("Invalid Minecraft destination. Check MC_HOST and MC_PORT (valid TCP port: 1-65535).");
}
const express = require("express");
const http = require("http");
const https = require("https");

const memoryDirectory = process.env.MANJI_DATA_DIR || path.join(__dirname, "data");
const memoryFile = process.env.MANJI_MEMORY_FILE || path.join(memoryDirectory, "manji-memory.json");
const manjiMemory = new AgentMemory({ filePath: memoryFile });

// A filesystem lock prevents duplicate processes sharing the same data directory.
// On Railway, also keep the service replica count at exactly one: separate
// containers do not share a local lock file unless a shared volume is mounted.
// Keep the process lock on the container/local filesystem, not on the persistent
// memory volume. A stale lock must not survive a Railway redeploy in /data.
const processLockPath = process.env.MANJI_LOCK_FILE || path.join(__dirname, ".manji-process.lock");
let processLockOwned = false;
function acquireProcessLock() {
  require("node:fs").mkdirSync(path.dirname(processLockPath), { recursive: true });
  const fs = require("node:fs");
  const acquire = () => {
    const fd = fs.openSync(processLockPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    processLockOwned = true;
  };
  try { acquire(); return; }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(processLockPath, "utf8")); } catch (_) {}
  const pid = Number(existing && existing.pid);
  let alive = false;
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); alive = true; }
    catch (error) { alive = error.code === "EPERM"; }
  }
  if (alive) throw new Error(`Another Manji process appears to be running (PID ${pid}, lock ${processLockPath}).`);
  try { fs.unlinkSync(processLockPath); } catch (_) {}
  acquire();
}
function releaseProcessLock() {
  if (!processLockOwned) return;
  const fs = require("node:fs");
  try {
    const current = JSON.parse(fs.readFileSync(processLockPath, "utf8"));
    if (Number(current.pid) === process.pid) fs.unlinkSync(processLockPath);
  } catch (_) {}
  processLockOwned = false;
}
acquireProcessLock();

// ============================================================
// EXPRESS SERVER - Manji local-server control panel
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
          }

          main { width: 100%; max-width: 400px; }

          header { margin-bottom: 28px; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
          }
          header p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
            line-height: 1.5;
          }

          .status-section {
            border-radius: 12px;
            padding: 20px 24px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 16px;
            transition: background 0.3s, border-color 0.3s;
          }
          .status-section.online  { background: #0d2218; border: 2px solid #238636; }
          .status-section.offline { background: #200d0d; border: 2px solid #da3633; }

          .status-icon {
            width: 44px; height: 44px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; flex-shrink: 0;
            transition: background 0.3s;
          }
          .status-icon.online  { background: #238636; }
          .status-icon.offline { background: #da3633; }

          .status-label { font-size: 18px; font-weight: 700; line-height: 1.2; transition: color 0.3s; }
          .status-label.online  { color: #3fb950; }
          .status-label.offline { color: #f85149; }
          .status-detail { font-size: 13px; color: #8b949e; margin-top: 3px; }

          dl { margin: 0; }
          .stat-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 10px;
          }
          dt { font-size: 12px; color: #8b949e; font-weight: 600; margin-bottom: 4px; }
          dd { margin: 0; font-size: 17px; font-weight: 600; color: #e6edf3; line-height: 1.3; }
          .stat-detail { margin: 4px 0 0; font-size: 11px; color: #6e7681; }

          .controls { margin-top: 8px; }
          .btn-grid { display: grid; gap: 10px; margin-bottom: 10px; }
          .btn-grid-2 { grid-template-columns: 1fr 1fr; }

          .btn-primary {
            min-height: 52px; border-radius: 10px;
            font-size: 15px; font-weight: 700;
            cursor: pointer; letter-spacing: 0.3px;
            transition: opacity 0.2s, filter 0.2s;
            font-family: inherit;
          }
          .btn-primary:hover  { filter: brightness(1.1); }
          .btn-primary:active { opacity: 0.85; }
          .btn-start { border: 2px solid #238636; background: #0d2218; color: #3fb950; }
          .btn-stop  { border: 2px solid #da3633; background: #200d0d; color: #f85149; }

          .btn-secondary {
            min-height: 44px; border-radius: 10px;
            border: 1px solid #21262d; background: #161b22; color: #8b949e;
            font-size: 13px; font-weight: 500;
            text-decoration: none;
            display: flex; align-items: center; justify-content: center;
            font-family: inherit; cursor: pointer;
            transition: background 0.2s, color 0.2s;
          }
          .btn-secondary:hover { background: #21262d; color: #c9d1d9; }

          footer { margin-top: 20px; text-align: center; }
          footer p { font-size: 12px; color: #484f58; margin: 0; }
        </style>
      </head>
      <body>
        <main role="main" aria-label="AFK Bot Dashboard">

          <header>
            <h1>AFK Bot Dashboard</h1>
            <p>Minecraft server bot &middot; Live status</p>
          </header>

          <section
            id="status-section"
            role="status"
            aria-live="polite"
            aria-label="Bot connection status"
            class="status-section offline"
          >
            <div id="status-icon" aria-hidden="true" class="status-icon offline">&#x2717;</div>
            <div>
              <div id="status-label" class="status-label offline">Connecting…</div>
              <div id="status-detail" class="status-detail">Establishing connection</div>
            </div>
          </section>

          <section aria-label="Bot statistics">
            <dl>
              <div class="stat-card">
                <dt>Uptime</dt>
                <dd id="uptime-text">—</dd>
                <p class="stat-detail">Time since last connection</p>
              </div>
              <div class="stat-card">
                <dt>Coordinates</dt>
                <dd id="coords-text">Searching…</dd>
                <p class="stat-detail">Bot's current in-game position</p>
              </div>
              <div class="stat-card">
                <dt>Server address</dt>
                <dd>${config.server.ip}</dd>
                <p class="stat-detail">Minecraft server hostname</p>
              </div>
            </dl>
          </section>

          <section class="controls" aria-label="Bot controls">
            <div class="btn-grid btn-grid-2">
              <button class="btn-primary btn-start" onclick="startBot()" aria-label="Start bot">Start bot</button>
              <button class="btn-primary btn-stop" onclick="stopBot()" aria-label="Stop bot">Stop bot</button>
            </div>
            <div class="btn-grid btn-grid-2">
              <a href="/tutorial" class="btn-secondary" aria-label="View setup guide">Setup guide</a>
              <a href="/logs" class="btn-secondary" aria-label="View bot logs">View logs</a>
            </div>
          </section>

          <footer>
            <p>Status updates every 5 seconds</p>
          </footer>

        </main>

        <script>
          function formatUptime(s) {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
            if (m > 0) return m + 'm ' + sec + 's';
            return sec + ' seconds';
          }

          async function update() {
            try {
              const r = await fetch('/health');
              const data = await r.json();
              const online = data.status === 'connected';

              const section = document.getElementById('status-section');
              const icon    = document.getElementById('status-icon');
              const label   = document.getElementById('status-label');
              const detail  = document.getElementById('status-detail');

              section.className = 'status-section ' + (online ? 'online' : 'offline');
              icon.className    = 'status-icon '    + (online ? 'online' : 'offline');
              icon.textContent  = online ? '✓' : '✗';
              label.className   = 'status-label '   + (online ? 'online' : 'offline');
              label.textContent = online ? 'Connected' : 'Disconnected';
              detail.textContent = online ? 'Bot is active on the server' : 'Attempting to reconnect';

              document.getElementById('uptime-text').textContent = formatUptime(data.uptime);

              if (data.coords) {
                const x = Math.floor(data.coords.x);
                const y = Math.floor(data.coords.y);
                const z = Math.floor(data.coords.z);
                document.getElementById('coords-text').textContent = 'X ' + x + ', Y ' + y + ', Z ' + z;
              } else {
                document.getElementById('coords-text').textContent = 'Searching…';
              }
            } catch (e) {
              const label = document.getElementById('status-label');
              label.className = 'status-label offline';
              label.textContent = 'Unreachable';
            }
          }

          async function startBot() {
            const r = await fetch('/start', { method: 'POST' });
            const data = await r.json();
            alert(data.success ? 'Bot started!' : data.msg);
            update();
          }

          async function stopBot() {
            const r = await fetch('/stop', { method: 'POST' });
            const data = await r.json();
            alert(data.success ? 'Bot stopped!' : data.msg);
            update();
          }

          setInterval(update, 5000);
          update();
        </script>
      </body>
    </html>
  `);
});
app.get("/tutorial", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Setup Guide</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 560px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s, background 0.2s;
          }
          .back-btn:hover { background: #21262d; color: #c9d1d9; }

          header { margin-bottom: 32px; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
          }
          header p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
            line-height: 1.5;
          }

          .step-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 16px;
          }

          .step-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 18px;
          }

          .step-number {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #0d2218;
            border: 2px solid #238636;
            color: #3fb950;
            font-size: 14px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .step-title {
            font-size: 16px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
          }

          ol {
            margin: 0;
            padding: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          li {
            font-size: 14px;
            color: #8b949e;
            line-height: 1.6;
            padding-left: 20px;
            position: relative;
          }

          li::before {
            content: "·";
            position: absolute;
            left: 6px;
            color: #3fb950;
            font-weight: 700;
          }

          li strong { color: #e6edf3; font-weight: 600; }

          code {
            background: #21262d;
            border: 1px solid #30363d;
            padding: 2px 7px;
            border-radius: 5px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
            color: #e6edf3;
          }

          a { color: #58a6ff; text-decoration: none; }
          a:hover { text-decoration: underline; }

          footer {
            margin-top: 32px;
            text-align: center;
          }
          footer p { font-size: 12px; color: #484f58; margin: 0; }
        </style>
      </head>
      <body>
        <main>
          <a href="/" class="back-btn">&#8592; Back to Dashboard</a>

          <header>
            <h1>Setup Guide</h1>
            <p>Connect Manji to your own Java server</p>
          </header>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">1</div>
              <h2 class="step-title">Configure your home Minecraft server</h2>
            </div>
            <ol>
              <li>Start your own Java server and keep its game port reachable from Railway.</li>
              <li>In <code>server.properties</code>, set <code>player-idle-timeout=0</code>.</li>
              <li>Keep <code>server-ip=</code> empty and use your normal game port (usually <code>25565</code>).</li>
              <li>Leave the server's online authentication enabled when using a licensed Microsoft account.</li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">2</div>
              <h2 class="step-title">GitHub Setup</h2>
            </div>
            <ol>
              <li>Download this project as a ZIP and extract it.</li>
              <li>Edit <code>settings.json</code> with your server IP and port.</li>
              <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">3</div>
              <h2 class="step-title">Deploy on Railway</h2>
            </div>
            <ol>
              <li>Connect your GitHub repository to <strong>Railway</strong> and deploy it with <code>npm start</code>.</li>
              <li>In Railway Variables, set <code>MC_HOST</code> to your home's public IP or DDNS name.</li>
              <li>Set <code>MC_PORT</code> to your forwarded Minecraft TCP port, commonly <code>25565</code>.</li>
              <li>Use Railway's dashboard Stop control when you want Manji to disconnect.</li>
            </ol>
          </div>

          <footer>
            <p>Manji Local Dashboard &middot; ${config.name}</p>
          </footer>
        </main>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  });
});

app.get("/ping", (req, res) => res.send("pong"));

app.get("/logs", (req, res) => {
  const logs = getLogs();

  const escapeHTML = (str) =>
    str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );

  const logCount = logs.length;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Logs</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 760px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s, background 0.2s;
          }
          .back-btn:hover { background: #21262d; color: #c9d1d9; }

          .page-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-bottom: 20px;
            gap: 12px;
            flex-wrap: wrap;
          }

          .page-header-left h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
          }
          .page-header-left p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
          }

          .badge {
            font-size: 12px;
            font-weight: 600;
            color: #8b949e;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 20px;
            padding: 4px 12px;
            white-space: nowrap;
          }

          .log-card {
            background: #0d1117;
            border: 1px solid #21262d;
            border-radius: 12px;
            overflow: hidden;
          }

          .log-card-header {
            background: #161b22;
            border-bottom: 1px solid #21262d;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red   { background: #ff5f57; }
          .dot-yellow{ background: #ffbd2e; }
          .dot-green { background: #28c840; }

          .log-card-title {
            font-size: 12px;
            font-weight: 500;
            color: #484f58;
            margin-left: 4px;
          }

          .log-body {
            padding: 16px 18px;
            max-height: 560px;
            overflow-y: auto;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            line-height: 1.7;
          }

          .log-entry { display: block; padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
          .log-entry.error   { color: #ff7b72; }
          .log-entry.warn    { color: #e3b341; }
          .log-entry.success { color: #3fb950; }
          .log-entry.control { color: #58a6ff; }
          .log-entry.default { color: #8b949e; }

          .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #484f58;
            font-size: 13px;
          }

          .refresh-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            margin-top: 12px;
            font-size: 12px;
            color: #484f58;
          }
          .refresh-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            background: #3fb950;
            animation: pulse 2s infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          .console-row {
            display: flex;
            align-items: center;
            border-top: 1px solid #21262d;
            background: #0d1117;
            padding: 10px 18px;
            gap: 10px;
          }

          .console-prompt {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
            color: #3fb950;
            font-weight: 700;
            flex-shrink: 0;
            user-select: none;
          }

          .console-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            color: #e6edf3;
            caret-color: #3fb950;
          }

          .console-input::placeholder { color: #484f58; }

          .console-send {
            background: #0d2218;
            border: 1px solid #238636;
            color: #3fb950;
            font-size: 12px;
            font-weight: 600;
            padding: 5px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s;
            flex-shrink: 0;
          }
          .console-send:hover { background: #122d1a; }
          .console-send:disabled { opacity: 0.5; cursor: default; }

          .console-wrap {
            position: relative;
          }

          .cmd-suggestions {
            display: none;
            position: absolute;
            bottom: calc(100% + 6px);
            left: 0; right: 0;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 10;
          }

          .cmd-suggestions.visible { display: block; }

          .cmd-item {
            display: flex;
            align-items: baseline;
            gap: 12px;
            padding: 9px 16px;
            cursor: pointer;
            transition: background 0.12s;
            border-bottom: 1px solid #21262d;
          }
          .cmd-item:last-child { border-bottom: none; }
          .cmd-item:hover, .cmd-item.active {
            background: #21262d;
          }

          .cmd-name {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            font-weight: 700;
            color: #3fb950;
            flex-shrink: 0;
            min-width: 90px;
          }

          .cmd-desc {
            font-size: 12px;
            color: #6e7681;
          }

          footer { margin-top: 32px; text-align: center; }
          footer p { font-size: 12px; color: #484f58; margin: 0; }
        </style>
      </head>
      <body>
        <main>
          <a href="/" class="back-btn">&#8592; Back to Dashboard</a>

          <div class="page-header">
            <div class="page-header-left">
              <h1>Bot Logs</h1>
              <p>Live output from the AFK bot</p>
            </div>
            <span class="badge">${logCount} ${logCount === 1 ? "entry" : "entries"}</span>
          </div>

          <div class="log-card">
            <div class="log-card-header">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
              <span class="log-card-title">bot.log</span>
            </div>
            <div class="log-body" id="log-body">
              ${logCount === 0
                ? `<div class="empty-state">No log entries yet. Start the bot to see output.</div>`
                : logs.map((l) => {
                    const escaped = escapeHTML(l);
                    const lower = l.toLowerCase();
                    let cls = "default";
                    if (lower.includes("error") || lower.includes("fail")) cls = "error";
                    else if (lower.includes("warn")) cls = "warn";
                    else if (lower.includes("[control]")) cls = "control";
                    else if (lower.includes("connect") || lower.includes("join") || lower.includes("spawn")) cls = "success";
                    return `<span class="log-entry ${cls}">${escaped}</span>`;
                  }).join("")
              }
            </div>
            <div class="console-wrap">
              <div class="cmd-suggestions" id="cmd-suggestions"></div>
              <div class="console-row">
                <span class="console-prompt">&gt;</span>
                <input
                  id="console-input"
                  class="console-input"
                  type="text"
                  placeholder="Type / for commands, or any message…"
                  autocomplete="off"
                  spellcheck="false"
                >
                <button id="console-send" class="console-send">Send</button>
              </div>
            </div>
          </div>

          <div class="refresh-bar">
            <span class="refresh-dot"></span>
            <span id="refresh-label">Auto-refreshing every 5 seconds</span>
          </div>

          <footer>
            <p>Manji Local Dashboard &middot; ${config.name}</p>
          </footer>
        </main>

        <script>
          (function() {
            var logBody  = document.getElementById('log-body');
            var input    = document.getElementById('console-input');
            var sendBtn  = document.getElementById('console-send');
            var label    = document.getElementById('refresh-label');
            var sugBox   = document.getElementById('cmd-suggestions');
            var refreshTimer = null;
            var typing = false;
            var activeIdx = -1;

            var COMMANDS = [
              { name: '/help',   desc: 'Show all available commands' },
              { name: '/pos',    desc: "Show bot's current coordinates" },
              { name: '/status', desc: 'Show connection status & uptime' },
              { name: '/list',   desc: 'List players on the server' },
              { name: '/say',    desc: 'Send a chat message in-game' },
            ];

            function scrollBottom() {
              if (logBody) logBody.scrollTop = logBody.scrollHeight;
            }

            function scheduleRefresh() {
              clearTimeout(refreshTimer);
              if (!typing) {
                refreshTimer = setTimeout(function() { location.reload(); }, 5000);
              }
            }

            function appendLocalEntry(text, cls) {
              var span = document.createElement('span');
              span.className = 'log-entry ' + (cls || 'control');
              span.textContent = text;
              logBody.appendChild(span);
              scrollBottom();
            }

            function hideSuggestions() {
              sugBox.classList.remove('visible');
              sugBox.innerHTML = '';
              activeIdx = -1;
            }

            function setActive(idx) {
              var items = sugBox.querySelectorAll('.cmd-item');
              items.forEach(function(el, i) {
                el.classList.toggle('active', i === idx);
              });
              activeIdx = idx;
            }

            function showSuggestions(val) {
              var query = val.toLowerCase();
              var matches = COMMANDS.filter(function(c) {
                return c.name.startsWith(query);
              });

              if (!matches.length) { hideSuggestions(); return; }

              sugBox.innerHTML = matches.map(function(c, i) {
                return '<div class="cmd-item" data-cmd="' + c.name + '">' +
                  '<span class="cmd-name">' + c.name + '</span>' +
                  '<span class="cmd-desc">' + c.desc + '</span>' +
                '</div>';
              }).join('');

              sugBox.querySelectorAll('.cmd-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                  e.preventDefault();
                  input.value = el.dataset.cmd + ' ';
                  hideSuggestions();
                  input.focus();
                });
              });

              activeIdx = -1;
              sugBox.classList.add('visible');
            }

            input.addEventListener('input', function() {
              var val = input.value;
              if (val.startsWith('/')) {
                showSuggestions(val);
              } else {
                hideSuggestions();
              }
            });

            input.addEventListener('keydown', function(e) {
              var items = sugBox.querySelectorAll('.cmd-item');
              if (sugBox.classList.contains('visible') && items.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive(Math.min(activeIdx + 1, items.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(Math.max(activeIdx - 1, 0));
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) {
                  e.preventDefault();
                  var chosen = items[activeIdx >= 0 ? activeIdx : 0];
                  input.value = chosen.dataset.cmd + ' ';
                  hideSuggestions();
                  return;
                }
                if (e.key === 'Escape') {
                  hideSuggestions();
                  return;
                }
              }
              if (e.key === 'Enter') sendCommand();
            });

            function sendCommand() {
              var cmd = input.value.trim();
              if (!cmd) return;
              hideSuggestions();
              input.value = '';
              sendBtn.disabled = true;
              appendLocalEntry('> ' + cmd, 'control');

              fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
              })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.msg) {
                  data.msg.split('\\n').forEach(function(line) {
                    appendLocalEntry(line, data.success ? 'default' : 'error');
                  });
                }
              })
              .catch(function() {
                appendLocalEntry('Failed to send command.', 'error');
              })
              .finally(function() {
                sendBtn.disabled = false;
                input.focus();
                scheduleRefresh();
              });
            }

            sendBtn.addEventListener('click', sendCommand);

            input.addEventListener('focus', function() {
              typing = true;
              clearTimeout(refreshTimer);
              label.textContent = 'Auto-refresh paused while typing';
            });
            input.addEventListener('blur', function() {
              setTimeout(function() {
                hideSuggestions();
                typing = false;
                label.textContent = 'Auto-refreshing every 5 seconds';
                scheduleRefresh();
              }, 150);
            });

            scrollBottom();
            scheduleRefresh();
          })();
        </script>
      </body>
    </html>
  `);
});

let botRunning = true;

// Manji Local mode: autonomous movement/combat remains active with zero human players.

app.post("/start", (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  isReconnecting = false;
  clearBotTimeouts();
  createBot();
  addLog("[Control] Bot started manually from dashboard");

  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  if (!botRunning) return res.json({ success: false, msg: "Already stopped" });

  botRunning = false;
  isReconnecting = false;
  clearBotTimeouts();
  clearAllIntervals();

  if (bot) {
    const activeBot = bot;
    bot = null;
    try { activeBot.quit("Stopped from Manji dashboard"); } catch (e) {
      try { activeBot.end(); } catch (_) {}
    }
  }

  addLog("[Control] Bot stopped");

  res.json({ success: true });
});

app.post("/command", express.json(), (req, res) => {
  const cmd = (req.body.command || "").trim();
  if (!cmd) return res.json({ success: false, msg: "Empty command." });

  addLog(`[Console] > ${cmd}`);

  if (cmd === "/help") {
    const lines = [
      "Available commands:",
      "  /help          - Show this help message",
      "  /pos           - Show bot's current coordinates",
      "  /status        - Show bot connection status",
      "  /list          - Ask server for player list",
      "  /say <message> - Send a chat message in-game",
      "  /<anything>    - Send any Minecraft command directly",
      "  <text>         - Send plain chat (no slash needed)",
    ];
    lines.forEach((l) => addLog(`[Console] ${l}`));
    return res.json({ success: true, msg: lines.join("\n") });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const pos = bot && bot.entity ? bot.entity.position : null;
    const msg = pos
      ? `Position: X=${Math.floor(pos.x)}  Y=${Math.floor(pos.y)}  Z=${Math.floor(pos.z)}`
      : "Position unavailable (bot not spawned).";
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const status = botState.connected ? "Connected" : "Disconnected";
    const uptime = Math.floor((Date.now() - botState.startTime) / 1000);
    const msg = `Status: ${status} | Uptime: ${uptime}s | Reconnects: ${botState.reconnectAttempts}`;
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!bot || typeof bot.chat !== "function") {
    const msg = bot
      ? "Bot is still connecting — try again in a moment."
      : "Bot is not running.";
    addLog(`[Console] ${msg}`);
    return res.json({ success: false, msg });
  }

  try {
    bot.chat(cmd);
    addLog(`[Console] Sent to server: ${cmd}`);
    return res.json({ success: true, msg: `Sent: ${cmd}` });
  } catch (err) {
    addLog(`[Console] Error: ${err.message}`);
    return res.json({ success: false, msg: err.message });
  }
});

// ============================================================
//                    END OF WEB TOOLS
//============================================================

// FIX: handle port conflict gracefully - try next port if taken
const server = app.listen(PORT, "0.0.0.0", () => {
  addLog(`[Server] HTTP server started on port ${server.address().port} `);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const fallbackPort = PORT + 1;
    addLog(`[Server] Port ${PORT} in use - trying port ${fallbackPort} `);
    server.listen(fallbackPort, "0.0.0.0");
  } else {
    addLog(`[Server] HTTP server error: ${err.message} `);
  }
});

// Format bot uptime for the dashboard
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s} s`;
}

// ============================================================
// HTTP health endpoint for Railway monitoring; no self-ping loop is used.


// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(
  () => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    addLog(`[Memory] Heap: ${heapMB} MB`);
  },
  5 * 60 * 1000,
);

// ============================================================
// BOT CREATION AND RECONNECTION MANAGEMENT
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let stableConnectionTimerId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
  if (stableConnectionTimerId) {
    clearTimeout(stableConnectionTimerId);
    stableConnectionTimerId = null;
  }
}

// FIX: Discord rate limiting - track last send time
let lastDiscordSend = 0;
const DISCORD_RATE_LIMIT_MS = 5000; // min 5s between webhook calls

function clearAllIntervals() {
  addLog(`[Cleanup] Clearing ${activeIntervals.length} intervals`);
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  if (botState.wasThrottled) {
    botState.wasThrottled = false;
    const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
    addLog(
      `[Bot] Throttle detected - using extended delay: ${throttleDelay / 1000}s`,
    );
    return throttleDelay;
  }

  // FIX: read auto-reconnect-delay from settings as base delay
  const baseDelay = config.utils["auto-reconnect-delay"] || 3000;
  const maxDelay = config.utils["max-reconnect-delay"] || 30000;
  const delay = Math.min(
    baseDelay * Math.pow(2, botState.reconnectAttempts),
    maxDelay,
  );
  const jitter = Math.floor(Math.random() * 2000);
  return Math.min(maxDelay, delay + jitter);
}

function createBot() {
  if (!botRunning) {
    addLog("[Bot] Start ignored because the bot is stopped. Use the dashboard Start button.");
    return;
  }
  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  // Cleanup previous bot properly to avoid ghost bots
  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      addLog("[Cleanup] Error ending previous bot:", e.message);
    }
    bot = null;
  }

  addLog(`[Bot] Creating bot instance...`);
  addLog(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  try {
    // Minecraft 26.3 uses Java protocol 777. Pin the version so Mineflayer
    // selects the matching protocol tables instead of relying on status autodetection.
    const botVersion = config.server.version || "26.3";
    addLog(`[Bot] Using Minecraft Java protocol version ${botVersion}`);
    bot = mineflayer.createBot({
      username: config["bot-account"].username,
      password: config["bot-account"].password || undefined,
      auth: config["bot-account"].type,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false,
      keepAlive: true,
      checkTimeoutInterval: 60000,
      respawn: true,
    });

    bot.__manjiReconnectAllowed = true;
    bot.loadPlugin(pathfinder);

    bot.on("death", () => {
      addLog("[Bot] Death detected; Mineflayer automatic respawn is enabled.");
    });
    bot.on("respawn", () => {
      addLog("[Bot] Respawn transition received; movement controller will continue after spawn.");
    });

    // Connection timeout - end the old bot before reconnecting to avoid ghost bots
    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        addLog("[Bot] Connection timeout - no spawn received");
        try {
          bot.removeAllListeners();
          bot.end();
        } catch (e) {
          /* ignore */
        }
        bot = null;
        scheduleReconnect();
      }
    }, 120000); // 120s connection window for a local server booting or loading chunks

    // Each bot instance handles its first spawn once; reconnections create a fresh instance.
    let spawnHandled = false;

    bot.once("spawn", () => {
      if (spawnHandled) return;
      spawnHandled = true;

      clearBotTimeouts();
      botState.connected = true;
      botState.lastActivity = Date.now();
      isReconnecting = false;
      // Do not reset retry backoff on a short-lived connection. Reset only
      // after two stable minutes to avoid rapid reconnect loops on flapping links.
      stableConnectionTimerId = setTimeout(() => {
        stableConnectionTimerId = null;
        if (botState.connected) botState.reconnectAttempts = 0;
      }, 120000);
      addLog("[Local] Autonomous mode enabled: Manji remains connected and active without human players.");

      addLog(
        `[Bot] [+] Successfully spawned on server! (Version: ${bot.version})`,
      );
      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.connect
      ) {
        sendDiscordWebhook(
          `[+] **Connected** to \`${config.server.ip}\``,
          0x4ade80,
        );
      }

      // Use the negotiated bot.version so minecraft-data matches the server
      const mcData = require("@wp2508/minecraft-data")(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      // Safe, conservative navigation. Keep stairs and ordinary one-block
      // steps; never dig, pillar, or parkour. Swimming remains available as a
      // recovery route, but dry paths are preferred by a moderate liquid cost.
      defaultMove.allow1by1towers = false;
      defaultMove.allowParkour = config.navigation?.allowParkour !== false;
      defaultMove.maxDropDown = 3;
      defaultMove.liquidCost = 5;
      defaultMove.allowSprinting = true;

      initializeAutonomy(bot, defaultMove);
      initializeModules(bot, mcData, defaultMove);

      // Attempt creative mode (only works if bot has OP and enabled in settings)
      setTimeout(() => {
        if (bot && botState.connected && config.server["try-creative"]) {
          bot.chat("/gamemode creative");
          addLog("[INFO] Attempted to set creative mode (requires OP)");
        }
      }, 3000);

      bot.on("messagestr", (message) => {
        if (
          message.includes("commands.gamemode.success.self") ||
          message.includes("Set own game mode to Creative Mode")
        ) {
          addLog("[Server] Server reported that Manji is now in Creative Mode; V12.1 did not request this (try-creative is disabled by default).");
        }
      });
    });

    // FIX: 'kicked' fires before 'end'. Remove the scheduleReconnect from 'kicked'
    // so that 'end' is the single source of reconnect truth, preventing double-trigger.
    bot.on("kicked", (reason) => {
      // FIX: stringify reason if it's an object to make it readable in logs
      const kickReason =
        typeof reason === "object" ? JSON.stringify(reason) : reason;
      addLog(`[Bot] Kicked: ${kickReason}`);
      botState.connected = false;
      botState.errors.push({
        type: "kicked",
        reason: kickReason,
        time: Date.now(),
      });
      clearAllIntervals();

      bot.__manjiReconnectAllowed = reconnectAfterKick(kickReason);
      if (!bot.__manjiReconnectAllowed) {
        botRunning = false;
        addLog("[Bot] Kick looks permanent (protocol/version/auth/ban/whitelist). Automatic reconnect stopped; correct the setting and start Manji manually.");
      }
      const reasonStr = String(kickReason).toLowerCase();
      if (
        reasonStr.includes("throttl") ||
        reasonStr.includes("wait before reconnect") ||
        reasonStr.includes("too fast")
      ) {
        addLog(
          "[Bot] Throttle kick detected - will use extended reconnect delay",
        );
        botState.wasThrottled = true;
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(`[!] **Kicked**: ${kickReason}`, 0xff0000);
      }
      // NOTE: do NOT call scheduleReconnect() here - 'end' will fire right after 'kicked' and handle it
    });

    // FIX: 'end' is the single reconnect trigger
    bot.on("end", (reason) => {
      addLog(`[Bot] Disconnected: ${reason || "Unknown reason"}`);
      botState.connected = false;
      try {
        if (bot && bot.entity && bot.__manjiMemory) {
          bot.__manjiMemory.setSession(bot.entity.position, bot.__manjiBrain?.current || 'disconnected');
          void bot.__manjiMemory.save();
        }
      } catch (_) {}
      clearBotTimeouts();
      clearAllIntervals();
      spawnHandled = false; // reset for next connection

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[-] **Disconnected**: ${reason || "Unknown"}`,
          0xf87171,
        );
      }

      // Local-server mode: keep the service in desired-running state and retry
      // with exponential backoff until the user presses Stop in the dashboard.
      const retryAllowed = !bot || bot.__manjiReconnectAllowed !== false;
      if (botRunning && config.utils["auto-reconnect"] === true && retryAllowed && !isPermanentConnectionFailure(reason)) {
        scheduleReconnect();
      } else {
        botRunning = false;
        addLog("[Bot] Automatic reconnection is disabled; use the dashboard Start button.");
      }
    });

    bot.on("error", (err) => {
      const msg = err.message || "";
      addLog(`[Bot] Error: ${msg}`);
      botState.errors.push({ type: "error", message: msg, time: Date.now() });
      // Don't reconnect on error - let 'end' event handle it
    });
  } catch (err) {
    addLog(`[Bot] Failed to create bot: ${err.message}`);
    if (isRecoverableNetworkFailure(err)) {
      scheduleReconnect();
    } else {
      botRunning = false;
      isReconnecting = false;
      addLog("[Bot] Non-transient startup failure; automatic retries stopped to avoid an endless loop. Check protocol/version/authentication and start Manji manually after correction.");
    }
  }
}

function scheduleReconnect() {
  clearBotTimeouts();

  if (!botRunning || config.utils["auto-reconnect"] !== true) {
    botRunning = false;
    isReconnecting = false;
    addLog("[Bot] Reconnect skipped: automatic reconnection is disabled.");
    return;
  }

  // FIX: don't stack reconnect if already waiting
  if (isReconnecting) {
    addLog("[Bot] Reconnect already scheduled, skipping duplicate.");
    return;
  }

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  addLog(
    `[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// AUTONOMOUS BRAIN, SENSORS AND MEMORY
// ============================================================
function startInvestigationBehavior(bot, defaultMove, brain) {
  let targetId = null;
  let investigationGoal = null;
  let emergencyGoal = null;
  let emergencyStartedAt = 0;
  let startedAt = 0;
  let retryAfter = 0;
  const hostileNames = new Set([
    'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian',
    'ender_dragon', 'endermite', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk',
    'illusioner', 'magma_cube', 'phantom', 'piglin_brute', 'pillager', 'ravager',
    'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex',
    'vindicator', 'warden', 'witch', 'wither', 'wither_skeleton', 'zoglin', 'zombie',
    'zombie_villager', 'zombified_piglin'
  ]);

  function releaseOwnedGoal() {
    if (investigationGoal && bot.pathfinder && bot.pathfinder.goal === investigationGoal) {
      try { bot.pathfinder.setGoal(null); } catch (_) {}
    }
    targetId = null;
    investigationGoal = null;
    brain.setSignal('investigate', false);
  }

  function findDryEmergencyPoint() {
    if (!bot.entity || typeof bot.blockAt !== 'function') return null;
    const current = bot.entity.position;
    const baseX = Math.floor(current.x);
    const baseZ = Math.floor(current.z);
    const candidates = [];
    for (let radius = 2; radius <= 8; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          for (const dy of [0, -1, 1, -2, 2]) {
            const x = baseX + dx;
            const y = Math.floor(current.y) + dy;
            const z = baseZ + dz;
            const feetPos = current.offset(x + 0.5 - current.x, y - current.y, z + 0.5 - current.z);
            const floor = bot.blockAt(feetPos.offset(0, -1, 0));
            const feet = bot.blockAt(feetPos);
            const head = bot.blockAt(feetPos.offset(0, 1, 0));
            const isWet = (block) => !!block && /water|lava/.test(String(block.name || '').toLowerCase());
            if (floor && floor.boundingBox === 'block' && !isWet(floor) &&
                feet && feet.boundingBox === 'empty' && !isWet(feet) &&
                head && head.boundingBox === 'empty' && !isWet(head)) {
              candidates.push({ x, y, z, score: Math.hypot(dx, dz) + Math.abs(dy) * 1.6 });
            }
          }
        }
      }
      if (candidates.length) break;
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  addInterval(() => {
    if (!botState.connected || !bot.entity || !bot.pathfinder || !bot.entities) return;
    const now = Date.now();
    const activity = brain.update();
    if (activity === 'emergency') {
      releaseOwnedGoal();
      const position = bot.entity.position;
      if (emergencyGoal && bot.pathfinder.goal !== emergencyGoal) emergencyGoal = null;
      if (!emergencyGoal || now - emergencyStartedAt > 18_000) {
        if (emergencyGoal && bot.pathfinder.goal === emergencyGoal) {
          try { bot.pathfinder.setGoal(null); } catch (_) {}
        }
        const safePoint = findDryEmergencyPoint();
        emergencyGoal = null;
        if (safePoint) {
          emergencyGoal = new goals.GoalNear(safePoint.x, safePoint.y, safePoint.z, 1);
          try {
            bot.pathfinder.setMovements(defaultMove);
            bot.pathfinder.setGoal(emergencyGoal);
            emergencyStartedAt = now;
            addLog('[Survival] Lava detected; navigating toward the nearest dry, supported position.');
          } catch (error) {
            emergencyGoal = null;
            addLog('[Survival] Could not set an emergency escape route:', error.message || String(error));
          }
        } else {
          // Do not let the previous exploration path continue when an emergency
          // destination cannot yet be found in the loaded chunks.
          try { bot.pathfinder.setGoal(null); } catch (_) {}
          for (const control of ['forward', 'back', 'left', 'right', 'sprint', 'jump']) {
            try { bot.setControlState(control, false); } catch (_) {}
          }
          emergencyStartedAt = now;
          addLog('[Survival] Lava detected but no dry standing point is currently loaded nearby; movement paused while sensors retry.');
        }
      }
      if (emergencyGoal && position.distanceTo({ x: emergencyGoal.x + 0.5, y: emergencyGoal.y, z: emergencyGoal.z + 0.5 }) < 1.8) {
        if (bot.pathfinder.goal === emergencyGoal) {
          try { bot.pathfinder.setGoal(null); } catch (_) {}
        }
        emergencyGoal = null;
      }
      return;
    }
    if (emergencyGoal && bot.pathfinder.goal === emergencyGoal) {
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      emergencyGoal = null;
    }
    if (activity === 'combat' || activity === 'recovery') {
      releaseOwnedGoal();
      return;
    }
    if (now < retryAfter) return;

    const targetStillExists = targetId && bot.entities[targetId] && bot.entities[targetId].position;
    if (targetStillExists) {
      const target = bot.entities[targetId];
      const distance = bot.entity.position.distanceTo(target.position);
      if (distance <= 3.8) {
        releaseOwnedGoal();
        brain.setSignal('observe', true, { ttlMs: 2400, details: 'finished nearby investigation' });
        retryAfter = now + 9000;
        try { bot.lookAt(target.position.offset(0, Math.max(0.5, (target.height || 1) * 0.7), 0), true).catch(() => {}); } catch (_) {}
        addLog(`[Brain] Finished investigating ${target.name || 'nearby entity'}.`);
        return;
      }
      if (now - startedAt > 15000) {
        const failedPosition = target.position;
        releaseOwnedGoal();
        if (manjiMemory) manjiMemory.markFailed(failedPosition, 'investigation-timeout', 30_000);
        retryAfter = now + 12_000;
        addLog('[Brain] Investigation timed out; this target will be ignored temporarily.');
        return;
      }
      return;
    }

    if (targetId) releaseOwnedGoal();
    const candidates = Object.values(bot.entities).filter((entity) => {
      if (!entity || !entity.position || entity.id === bot.entity.id || entity.type === 'player') return false;
      if (hostileNames.has(String(entity.name || '').toLowerCase())) return false;
      const d = bot.entity.position.distanceTo(entity.position);
      return entity.type === 'mob' && d >= 5 && d <= 13;
    }).sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));

    const target = candidates[0];
    if (!target) return;
    try {
      const { GoalNear } = goals;
      investigationGoal = new GoalNear(target.position.x, target.position.y, target.position.z, 3);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(investigationGoal);
      targetId = target.id;
      startedAt = now;
      brain.setSignal('investigate', true, { details: { entity: target.name || 'unknown' } });
      addLog(`[Brain] Investigating nearby ${target.name || 'entity'} at ${target.position.x.toFixed(1)}, ${target.position.y.toFixed(1)}, ${target.position.z.toFixed(1)}.`);
    } catch (error) {
      targetId = null;
      investigationGoal = null;
      retryAfter = now + 5000;
      addLog('[Brain] Could not start investigation:', error.message || String(error));
    }
  }, 1200);
}

function initializeAutonomy(bot, defaultMove) {
  const brain = new ActivityBrain();
  const sensors = new SensorSuite(bot, manjiMemory);
  bot.__manjiBrain = brain;
  bot.__manjiSensors = sensors;
  bot.__manjiMemory = manjiMemory;
  brain.onChange(({ previous, current }) => {
    addLog(`[Brain] Activity changed: ${previous} -> ${current}.`);
  });
  startInvestigationBehavior(bot, defaultMove, brain);
  addInterval(() => {
    if (!botState.connected || !bot.entity) return;
    try {
      const snapshot = sensors.scan();
      if (!snapshot) return;
      const emergency = snapshot.inLava;
      brain.setSignal('emergency', emergency, { details: emergency ? 'critical health / lava' : null });
      brain.update();
      manjiMemory.setSession(bot.entity.position, brain.current);
    } catch (error) {
      addLog('[Sensors] Observation error:', error.message || String(error));
    }
  }, 1200);
  addInterval(() => {
    void manjiMemory.save().catch((error) => addLog('[Memory] Save failed:', error.message));
  }, 30000);
  let lastHungerWarningAt = 0;
  addInterval(() => {
    if (!botState.connected || !bot.entity) return;
    const food = Number(bot.food);
    const saturation = Number(bot.foodSaturation);
    if (!Number.isFinite(food) || !Number.isFinite(saturation)) return;
    if ((food < 18 || saturation < 2) && Date.now() - lastHungerWarningAt >= 30000) {
      addLog(`[Survival] Server-reported hunger is low (food=${food}/20, saturation=${saturation.toFixed(1)}). Manji does not auto-hunt or craft food; configure server-side saturation for permanent supply.`);
      lastHungerWarningAt = Date.now();
    }
  }, 5000);
  addLog(`[Brain] Sensor suite active; persistent memory file: ${memoryFile}`);
  addLog('[Brain] Autonomous activity arbitration is independent of human player count.');
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  addLog("[Modules] Initializing all modules...");

  // React to damage without attacking players or changing server gameplay.
  damageReactionModule(bot, defaultMove);

  // ---------- AUTO AUTH (REACTIVE) ----------
  if (config.utils["auto-auth"] && config.utils["auto-auth"].enabled) {
    const password = process.env.MC_AUTH_PASSWORD || config.utils["auto-auth"].password;
    let authHandled = false;
    if (!password) {
      addLog("[Auth] Auto-auth is enabled but no password is configured. Set MC_AUTH_PASSWORD in Railway Variables.");
    }

    const tryAuth = (type) => {
      if (!password || authHandled || !bot || !botState.connected) return;
      authHandled = true;
      if (type === "register") {
        bot.chat(`/register ${password} ${password}`);
        addLog("[Auth] Detected register prompt - sent /register");
      } else {
        bot.chat(`/login ${password}`);
        addLog("[Auth] Detected login prompt - sent /login");
      }
    };

    bot.on("messagestr", (message) => {
      if (authHandled) return;
      const msg = message.toLowerCase();
      if (
        msg.includes("/register") ||
        msg.includes("register ") ||
        msg.includes("지정된 비밀번호")
      ) {
        tryAuth("register");
      } else if (
        msg.includes("/login") ||
        msg.includes("login ") ||
        msg.includes("로그인")
      ) {
        tryAuth("login");
      }
    });

    // Failsafe: if no prompt after 10s, try login anyway
    setTimeout(() => {
      if (password && !authHandled && bot && botState.connected) {
        addLog(
          "[Auth] No prompt detected after 10s, sending /login as failsafe",
        );
        bot.chat(`/login ${password}`);
        authHandled = true;
      }
    }, 10000);
  }

  // ---------- CHAT MESSAGES ----------
  if (config.utils["chat-messages"] && config.utils["chat-messages"].enabled) {
    const messages = config.utils["chat-messages"].messages;
    if (config.utils["chat-messages"].repeat) {
      let i = 0;
      addInterval(() => {
        if (bot && botState.connected) {
          bot.chat(messages[i]);
          botState.lastActivity = Date.now();
          i = (i + 1) % messages.length;
        }
      }, config.utils["chat-messages"]["repeat-delay"] * 1000);
    } else {
      messages.forEach((msg, idx) => {
        setTimeout(() => {
          if (bot && botState.connected) bot.chat(msg);
        }, idx * 1000);
      });
    }
  }

  // The procedural movement controller below owns all normal positioning.
  // It uses config.position as a fixed centre rather than deriving new points
  // from Manji's current position (which caused the old circle walk to drift).

  // ---------- ANTI-AFK ----------
  // Normal movement now provides the AFK activity. Do not randomly change the
  // hotbar: that used to replace a sword with unrelated blocks during combat.
  if (config.utils["anti-afk"] && config.utils["anti-afk"].enabled) {
    try {
      if (typeof bot.setControlState === "function") {
        bot.setControlState("sneak", false);
        bot.setControlState("jump", false);
      }
    } catch (e) {}
  }

  // ---------- MOVEMENT MODULES ----------
  // FIX: check top-level movement.enabled flag
  if (config.movement && config.movement.enabled !== false) {
    // FIX: circle-walk and random-jump both jump - only run one jumping mechanism
    // random-jump is skipped if anti-afk jump is handled elsewhere; we only use random-jump here
    if (
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    ) {
      startProceduralMovement(bot, defaultMove);
    }
    // FIX: only run random-jump if circle-walk is NOT running (circle-walk also keeps bot moving)
    if (
      config.movement["random-jump"] &&
      config.movement["random-jump"].enabled &&
      !(
        config.movement["circle-walk"] && config.movement["circle-walk"].enabled
      )
    ) {
      startRandomJump(bot);
    }
    if (
      config.movement["look-around"] &&
      config.movement["look-around"].enabled
    ) {
      startLookAround(bot);
    }
  }

  // ---------- CUSTOM MODULES ----------
  // FIX: avoidMobs AND combatModule conflict - if combat is enabled, don't run avoidMobs at the same time
  if (config.modules.avoidMobs && !config.modules.combat) {
    avoidMobs(bot);
  }
  if (config.modules.combat) {
    combatModule(bot, mcData);
  }
  if (config.modules.beds) {
    bedModule(bot, mcData);
  }
  if (config.modules.chat) {
    chatModule(bot);
  }

  addLog("[Modules] All modules initialized!");
}

// ============================================================
// MOVEMENT HELPERS
// ============================================================
function startProceduralMovement(bot, defaultMove) {
  const pos = config.position || {};
  const configured = pos.enabled !== false &&
    Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.z));
  const centerX = configured ? Number(pos.x) : bot.entity.position.x;
  const centerY = configured && Number.isFinite(Number(pos.y)) ? Number(pos.y) : bot.entity.position.y;
  const centerZ = configured ? Number(pos.z) : bot.entity.position.z;
  const explorationRadius = configured ? Math.max(20, Number(pos.radius) || 60) : 60;
  const returnRadius = explorationRadius * 0.82;
  const emergencyRadius = explorationRadius * 1.3;

  const navConfig = (config.navigation && typeof config.navigation === 'object') ? config.navigation : {};
  const replanCandidates = Math.max(2, Math.min(5, Number(navConfig.routeCandidates) || 4));
  const stuckTimeoutMs = Math.max(2400, Number(navConfig.stuckTimeoutMs) || 3500);
  const maxGoalTimeMs = Math.max(20000, Number(navConfig.maxGoalTimeMs) || 45000);
  const memoryTtlMs = Math.max(30000, Number(navConfig.memoryTtlMs) || 7 * 24 * 60 * 60 * 1000);
  const agentMemory = bot.__manjiMemory || manjiMemory;
  const activityBrain = bot.__manjiBrain || null;
  const routePlanner = new RoutePlanner({
    pathfinder: bot.pathfinder,
    movements: defaultMove,
    memory: agentMemory,
    candidates: replanCandidates,
    totalTimeoutMs: Math.max(700, Number(navConfig.totalProbeBudgetMs) || 1500),
    tickTimeoutMs: 4
  });
  const cornerRoutePlanner = new RoutePlanner({
    pathfinder: bot.pathfinder,
    movements: defaultMove,
    memory: agentMemory,
    candidates: 6,
    totalTimeoutMs: 1100,
    tickTimeoutMs: 4
  });
  let planning = false;
  let localRecoveryInProgress = false;
  let cornerRecoveryCycle = 0;
  let consecutivePlanningFailures = 0;

  // Soft movement preferences: no digging or 1x1 pillars. Parkour is allowed
  // only through Pathfinder safe movement checks; the bot does not build towers.
  defaultMove.canDig = false;
  defaultMove.allow1by1towers = false;
  defaultMove.allowParkour = navConfig.allowParkour !== false;
  defaultMove.allowFreeMotion = false;
  defaultMove.maxDropDown = 3;
  defaultMove.liquidCost = 5;
  defaultMove.allowSprinting = true;
  if ('allowEntityDetection' in defaultMove) defaultMove.allowEntityDetection = true;
  if ('entityCost' in defaultMove) defaultMove.entityCost = Math.max(Number(defaultMove.entityCost) || 0, 1.5);

  let currentGoal = null;
  let activePathGoal = null;
  let activeRoute = [];
  let routeCursor = 0;
  let nextActionAt = Date.now() + 1200;
  let goalStartedAt = 0;
  let lastRouteProgressAt = Date.now();
  let lastSampleAt = 0;
  let lastVisitedAt = 0;
  let heading = Math.random() * Math.PI * 2;
  let turnBias = Math.random() < 0.5 ? -1 : 1;
  let routePreferenceY = bot.entity.position.y;
  const blockedWaypoints = new Map();
  const failedCells = new Map();
  const visitedCells = new Map();
  const positionSamples = [];

  function distanceFromAnchor(position) {
    return Math.hypot(position.x - centerX, position.z - centerZ);
  }

  function isLiquid(block) {
    return !!block && /water|lava/.test(String(block.name || '').toLowerCase());
  }

  function cellKey(x, y, z) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  function pointKey(point) {
    return cellKey(point.x, point.y, point.z);
  }

  function pruneMemory(now = Date.now()) {
    for (const [key, expiry] of blockedWaypoints) if (expiry <= now) blockedWaypoints.delete(key);
    for (const [key, expiry] of failedCells) if (expiry <= now) failedCells.delete(key);
    for (const [key, seenAt] of visitedCells) if (now - seenAt > memoryTtlMs) visitedCells.delete(key);
  }

  function memoryStepCost(block) {
    if (!block || !block.position) return 0;
    const p = block.position;
    const now = Date.now();
    const failedUntil = failedCells.get(cellKey(p.x, p.y, p.z)) || 0;
    const persistedFailed = agentMemory && agentMemory.isFailed(p, now);
    let cost = failedUntil > now || persistedFailed ? 7 : 0;
    const seenAt = visitedCells.get(cellKey(p.x, p.y, p.z));
    const persistedVisitAge = agentMemory ? agentMemory.visitAge(p, now) : Infinity;
    if ((seenAt && now - seenAt < memoryTtlMs) || Number.isFinite(persistedVisitAge)) {
      // A modest cost nudges A* toward less-travelled corridors without making
      // revisiting a necessary passage impossible.
      const age = Math.min(seenAt ? now - seenAt : Infinity, persistedVisitAge);
      cost += 1.15 * (1 - age / memoryTtlMs);
    }
    // Avoid unnecessary climbs onto roofs/trees when both the current level
    // and the requested destination are lower. This is a soft cost, not a ban.
    const unnecessaryRise = p.y - routePreferenceY - 1;
    if (unnecessaryRise > 0) cost += Math.min(8, unnecessaryRise * 1.6);
    return cost;
  }

  if (Array.isArray(defaultMove.exclusionAreasStep)) {
    defaultMove.exclusionAreasStep.push(memoryStepCost);
  }

  function noteVisited(position, now = Date.now()) {
    const key = cellKey(position.x, position.y, position.z);
    visitedCells.set(key, now);
    if (agentMemory) agentMemory.markVisited(position, now);
    if (visitedCells.size > 700) pruneMemory(now);
  }

  function findSafePointsNear(idealX, idealZ, preferredY) {
    if (!bot.entity || typeof bot.blockAt !== 'function') return [];
    const current = bot.entity.position;
    const baseX = Math.floor(idealX);
    const baseZ = Math.floor(idealZ);
    const offsets = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2]
    ];
    // Prefer the current floor and small steps; larger height changes remain
    // possible when the terrain provides no comparable lower alternative.
    const verticalOffsets = [0, -1, 1, -2, 2, -3, 3];
    const candidates = [];
    const now = Date.now();

    for (const [ox, oz] of offsets) {
      const x = baseX + ox;
      const z = baseZ + oz;
      for (const dy of verticalOffsets) {
        const y = Math.floor(preferredY) + dy;
        const feetPos = current.offset(x + 0.5 - current.x, y - current.y, z + 0.5 - current.z);
        const floor = bot.blockAt(feetPos.offset(0, -1, 0));
        const feet = bot.blockAt(feetPos);
        const head = bot.blockAt(feetPos.offset(0, 1, 0));
        if (!floor || floor.boundingBox !== 'block' || isLiquid(floor) ||
            !feet || feet.boundingBox !== 'empty' || isLiquid(feet) ||
            !head || head.boundingBox !== 'empty' || isLiquid(head)) continue;

        const point = { x, y, z };
        if ((blockedWaypoints.get(pointKey(point)) || 0) > now) continue;
        const horizontal = Math.hypot((x + 0.5) - idealX, (z + 0.5) - idealZ);
        const vertical = Math.abs(y - preferredY);
        const visitedAt = visitedCells.get(pointKey(point)) || 0;
        const revisitPenalty = visitedAt && now - visitedAt < memoryTtlMs
          ? 2.0 * (1 - (now - visitedAt) / memoryTtlMs)
          : 0;
        const failedUntil = failedCells.get(pointKey(point)) || 0;
        const failedPenalty = failedUntil > now ? 8 : 0;
        point.localScore = horizontal + vertical * 3.2 + revisitPenalty + failedPenalty;
        candidates.push(point);
      }
    }
    candidates.sort((a, b) => a.localScore - b.localScore);
    return candidates.slice(0, 3);
  }

  function generateWaypointCandidates(shortRange = false) {
    if (!bot.entity) return [];
    const current = bot.entity.position;
    const radialDistance = distanceFromAnchor(current);
    const candidates = [];
    const seen = new Set();

    if (radialDistance > explorationRadius) {
      const radialAngle = Math.atan2(current.z - centerZ, current.x - centerX);
      const desiredRadius = radialDistance > emergencyRadius
        ? explorationRadius * 0.88
        : returnRadius + Math.random() * explorationRadius * 0.04;
      for (const angleOffset of [0, -0.38, 0.38, -0.8, 0.8]) {
        const angle = radialAngle + angleOffset;
        const idealX = centerX + Math.cos(angle) * desiredRadius;
        const idealZ = centerZ + Math.sin(angle) * desiredRadius;
        for (const point of findSafePointsNear(idealX, idealZ, current.y)) {
          const key = pointKey(point);
          if (seen.has(key)) continue;
          seen.add(key);
          point.localScore += Math.abs(distanceFromAnchor(point) - returnRadius) * 0.15;
          candidates.push(point);
        }
      }
    } else {
      const nearBoundary = radialDistance > explorationRadius * 0.78;
      const attempts = shortRange ? 12 : 18;
      for (let attempt = 0; attempt < attempts; attempt++) {
        let angle;
        if (nearBoundary) {
          const radialAngle = Math.atan2(current.z - centerZ, current.x - centerX);
          angle = Math.random() < 0.7
            ? radialAngle + turnBias * (Math.PI / 2 + (Math.random() - 0.5) * 0.85)
            : radialAngle + Math.PI + (Math.random() - 0.5) * 0.8;
        } else {
          angle = heading + (Math.random() - 0.5) * (shortRange ? 2.0 : 1.45);
        }
        const stepLength = shortRange ? 3.5 + Math.random() * 2.5 : 6 + Math.random() * 8;
        const idealX = current.x + Math.cos(angle) * stepLength;
        const idealZ = current.z + Math.sin(angle) * stepLength;
        for (const point of findSafePointsNear(idealX, idealZ, current.y)) {
          const key = pointKey(point);
          if (seen.has(key)) continue;
          seen.add(key);
          const radial = distanceFromAnchor(point);
          if (radial > explorationRadius * 1.035) continue;
          const targetAngle = Math.atan2((point.z + 0.5) - current.z, (point.x + 0.5) - current.x);
          let turnCost = Math.abs(Math.atan2(Math.sin(targetAngle - heading), Math.cos(targetAngle - heading)));
          point.localScore += turnCost * 0.35;
          point.localScore += Math.max(0, radial - explorationRadius * 0.86) * 0.22;
          if (Math.hypot((point.x + 0.5) - current.x, (point.z + 0.5) - current.z) < (shortRange ? 2.2 : 3.2)) continue;
          candidates.push(point);
        }
      }
      if (Math.random() < 0.16) turnBias *= -1;
    }

    candidates.sort((a, b) => a.localScore - b.localScore);
    return candidates.slice(0, 12);
  }

  async function chooseReachableWaypoint() {
    const primaryCandidates = generateWaypointCandidates(false);
    const fallbackCandidates = generateWaypointCandidates(true);
    if (!primaryCandidates.length && !fallbackCandidates.length) return null;
    if (!bot.pathfinder || typeof bot.pathfinder.getPathFromTo !== 'function') {
      addLog('[Navigation] This Pathfinder build lacks getPathFromTo; using the first safe local target without pre-check.');
      return primaryCandidates[0] || fallbackCandidates[0] || null;
    }
    try {
      return await planWaypointWithFallback({
        routePlanner,
        primaryCandidates,
        fallbackCandidates,
        currentPosition: bot.entity.position.clone()
      });
    } catch (error) {
      addLog('[Navigation] Incremental route planning failed:', error.message || String(error));
      return null;
    }
  }

  function releaseMovementInputs() {
    if (!bot || typeof bot.setControlState !== 'function') return;
    for (const control of ['forward', 'back', 'left', 'right', 'sprint', 'jump']) {
      try { bot.setControlState(control, false); } catch (e) {}
    }
  }

  function markFailedArea(point) {
    if (!point) return;
    const now = Date.now();
    failedCells.set(pointKey(point), now + 30000);
    if (agentMemory) agentMemory.markFailed(point, 'navigation-no-progress', 60_000, now);
    if (activityBrain) activityBrain.setSignal('recovery', true, { ttlMs: 1800, details: 'navigation stuck' });
    if (agentMemory) agentMemory.increment('recoveryAttempts');
    for (const [key, expiry] of blockedWaypoints) if (expiry <= now) blockedWaypoints.delete(key);
    for (const [key, expiry] of failedCells) if (expiry <= now) failedCells.delete(key);
  }

  async function tryLocalCornerRecovery(origin, reason) {
    if (localRecoveryInProgress || planning || !origin || !botState.connected || !bot.entity || !bot.pathfinder) return false;
    const activity = activityBrain ? activityBrain.update() : 'explore';
    if (!canInterruptForCornerRecovery(activity) ||
        (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) return false;
    localRecoveryInProgress = true;
    planning = true;
    const startedAt = Date.now();
    try {
      const raw = buildCornerEscapeCandidates(origin, cornerRecoveryCycle++);
      const candidates = [];
      const liquid = (block) => !!block && /water|lava/.test(String(block.name || '').toLowerCase());
      for (const point of raw) {
        const feetPos = origin.offset(point.x + 0.5 - origin.x, point.y - origin.y, point.z + 0.5 - origin.z);
        const floor = bot.blockAt(feetPos.offset(0, -1, 0));
        const feet = bot.blockAt(feetPos);
        const head = bot.blockAt(feetPos.offset(0, 1, 0));
        if (!floor || floor.boundingBox !== 'block' || liquid(floor) ||
            !feet || feet.boundingBox !== 'empty' || liquid(feet) ||
            !head || head.boundingBox !== 'empty' || liquid(head)) continue;
        if ((blockedWaypoints.get(pointKey(point)) || 0) > Date.now()) continue;
        candidates.push(point);
      }
      const target = await cornerRoutePlanner.choose(candidates, origin.clone());
      if (!target || !botState.connected || !bot.entity || !bot.pathfinder ||
          !canInterruptForCornerRecovery(activityBrain ? activityBrain.update() : 'explore') ||
          (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) return false;

      const now = Date.now();
      bot.pathfinder.setMovements(defaultMove);
      activePathGoal = new GoalNear(target.x, target.y, target.z, 0.8);
      bot.pathfinder.setGoal(activePathGoal);
      currentGoal = { ...target, recoveryDetour: true };
      goalStartedAt = now;
      lastRouteProgressAt = now;
      activeRoute = [];
      routeCursor = 0;
      positionSamples.length = 0;
      nextActionAt = now + 1000;
      addLog(`[Navigation] Local corner recovery (${reason}); A* selected escape waypoint (${target.x}, ${target.y}, ${target.z}) after ${Date.now() - startedAt}ms.`);
      return true;
    } catch (error) {
      addLog(`[Navigation] Local corner recovery failed: ${error.message || String(error)}.`);
      return false;
    } finally {
      planning = false;
      localRecoveryInProgress = false;
    }
  }

  function abandonCurrentGoal(reason) {
    if (!currentGoal) return;
    const now = Date.now();
    blockedWaypoints.set(pointKey(currentGoal), now + 60000);
    const currentPos = bot.entity ? bot.entity.position : null;
    if (currentPos) {
      // Penalize the exact cell where progress stopped, not the whole corridor.
      markFailedArea({ x: currentPos.x, y: currentPos.y, z: currentPos.z });
    }
    if (agentMemory) agentMemory.increment('routesAbandoned');
    addLog(`[Navigation] Route abandoned (${reason}); remembered the failed location and will probe alternatives.`);
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    releaseMovementInputs();
    currentGoal = null;
    activePathGoal = null;
    activeRoute = [];
    routeCursor = 0;
    nextActionAt = now + 1800;
    lastRouteProgressAt = now;
    positionSamples.length = 0;
    if (currentPos) void tryLocalCornerRecovery(currentPos, reason).then((recovered) => {
      if (!recovered && botState.connected && !currentGoal) nextActionAt = Date.now() + 500;
    });
  }

  function routeNodeDistance(position, node) {
    return Math.hypot(position.x - (node.x + 0.5), position.y - node.y, position.z - (node.z + 0.5));
  }

  function updateRouteProgress(position, now) {
    if (!activeRoute.length) return false;
    const start = Math.max(0, routeCursor);
    const end = Math.min(activeRoute.length - 1, start + 7);
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    for (let i = start; i <= end; i++) {
      const d = routeNodeDistance(position, activeRoute[i]);
      if (d < nearestDistance) { nearestDistance = d; nearestIndex = i; }
    }
    if (nearestIndex >= 0 && nearestDistance <= 1.35 && nearestIndex > routeCursor) {
      routeCursor = nearestIndex;
      lastRouteProgressAt = now;
      return true;
    }
    // If we are close to the currently expected node, advance across nodes
    // already covered by the bot's hitbox to avoid false stall detections.
    while (routeCursor < activeRoute.length - 1 &&
           routeNodeDistance(position, activeRoute[routeCursor]) <= 1.0) {
      routeCursor++;
      lastRouteProgressAt = now;
    }
    return false;
  }

  function isOscillating(position, now) {
    if (now - lastSampleAt < 700) return false;
    lastSampleAt = now;
    positionSamples.push({ position: position.clone(), at: now });
    while (positionSamples.length && now - positionSamples[0].at > 3600) positionSamples.shift();
    if (positionSamples.length < 4) return false;

    const first = positionSamples[0].position;
    const net = position.distanceTo(first);
    let travel = 0;
    for (let i = 1; i < positionSamples.length; i++) {
      travel += positionSamples[i].position.distanceTo(positionSamples[i - 1].position);
    }
    // High cumulative motion with almost no net displacement is a back-and-
    // forth loop. Low cumulative motion is a hard collision/stationary stall.
    return (travel > 1.0 && net < 0.42) || (travel < 0.4 && now - goalStartedAt > 3200);
  }

  function clearCurrentGoal(reached = false) {
    if (reached && agentMemory) agentMemory.increment('routesReached');
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    currentGoal = null;
    activePathGoal = null;
    activeRoute = [];
    routeCursor = 0;
    positionSamples.length = 0;
    lastRouteProgressAt = Date.now();
    nextActionAt = Date.now() + (reached ? 1600 + Math.floor(Math.random() * 3500) : 900);
  }

  bot.on('path_update', (result) => {
    if (!currentGoal || (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) return;
    if (!result) return;
    if (Array.isArray(result.path) && result.path.length) {
      activeRoute = result.path.map((node) => ({ x: node.x, y: node.y, z: node.z }));
      routeCursor = 0;
    }
    if (result.status === 'noPath' && (!result.path || result.path.length === 0)) {
      abandonCurrentGoal('pathfinder reported noPath');
    }
  });

  bot.on('path_reset', (reason) => {
    if (reason === 'stuck' && currentGoal && !(bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) {
      abandonCurrentGoal('pathfinder stuck event');
    }
  });

  bot.on('goal_reached', (goal) => {
    if (activePathGoal && goal === activePathGoal && currentGoal) clearCurrentGoal(true);
  });

  addLog(`[Navigation] Adaptive explorer enabled: A* pre-checks, route memory, stuck recovery, cautious parkour=${defaultMove.allowParkour}, no digging/towers; anchor=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}, ${centerZ.toFixed(2)}), radius=${explorationRadius}.`);

  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity || !bot.pathfinder) return;
    if ((activityBrain && activityBrain.isHigherPriorityThanExploration()) ||
        (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) {
      routePlanner.cancel();
      return;
    }

    const now = Date.now();
    const position = bot.entity.position;
    pruneMemory(now);
    if (now - lastVisitedAt >= 1000) {
      noteVisited(position, now);
      lastVisitedAt = now;
    }

    // Combat may temporarily replace our exploration goal. Drop the stale
    // pointer after combat so the explorer does not supervise the combat path.
    if (currentGoal && activePathGoal && bot.pathfinder.goal !== activePathGoal) {
      currentGoal = null;
      activePathGoal = null;
      activeRoute = [];
      routeCursor = 0;
      positionSamples.length = 0;
      nextActionAt = now + 900;
    }

    if (currentGoal) {
      const goalDistance = Math.hypot(
        position.x - (currentGoal.x + 0.5),
        position.y - currentGoal.y,
        position.z - (currentGoal.z + 0.5)
      );
      if (goalDistance <= 1.65) {
        clearCurrentGoal(true);
        return;
      }

      updateRouteProgress(position, now);
      const oscillating = isOscillating(position, now);
      const routeStalled = activeRoute.length > 0 && now - lastRouteProgressAt > stuckTimeoutMs;
      const noRouteStall = activeRoute.length === 0 && now - goalStartedAt > 3200 && oscillating;
      const routeDeadline = Math.min(maxGoalTimeMs, 17000 + Math.max(0, activeRoute.length) * 950);
      if (routeStalled || noRouteStall || now - goalStartedAt > routeDeadline) {
        abandonCurrentGoal(routeStalled ? 'route nodes stopped advancing' :
          noRouteStall ? 'oscillation / no route progress' : 'waypoint time limit');
      }
      return;
    }

    if (now < nextActionAt) return;

    // Small idle pauses and head movement make the controller less mechanical.
    if (Math.random() < 0.16) {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() - 0.5) * 0.32;
      bot.look(yaw, pitch, false).catch(() => {});
      nextActionAt = now + 1200 + Math.floor(Math.random() * 2600);
      return;
    }

    if (planning) return;
    planning = true;
    void chooseReachableWaypoint().then((target) => {
      if (!botState.connected || !bot.entity || !bot.pathfinder) return;
      if ((activityBrain && activityBrain.isHigherPriorityThanExploration()) ||
          (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) return;
      const planningNow = Date.now();
      if (!target) {
        consecutivePlanningFailures = Math.min(4, consecutivePlanningFailures + 1);
        const retryDelay = Math.min(8000, 1000 * (2 ** (consecutivePlanningFailures - 1)));
        // Change heading after a failed batch so the next candidates explore a
        // genuinely different sector instead of probing the same corridor.
        heading += (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.9);
        turnBias *= -1;
        nextActionAt = planningNow + retryDelay;
        addLog(`[Navigation] No reachable route after primary and local-detour probes; rotating search direction and retrying in ${(retryDelay / 1000).toFixed(1)}s.`);
        return;
      }
      consecutivePlanningFailures = 0;
      try {
      const currentPosition = bot.entity.position;
      routePreferenceY = Math.max(currentPosition.y, target.y);
      bot.pathfinder.setMovements(defaultMove);
      activePathGoal = new GoalNear(target.x, target.y, target.z, 1);
      bot.pathfinder.setGoal(activePathGoal);
      currentGoal = target;
      if (agentMemory) agentMemory.increment('routesStarted');
      goalStartedAt = planningNow;
      lastRouteProgressAt = planningNow;
      activeRoute = [];
      routeCursor = 0;
      positionSamples.length = 0;
      heading = Math.atan2((target.z + 0.5) - currentPosition.z, (target.x + 0.5) - currentPosition.x);
      botState.lastActivity = planningNow;
      addLog(`[Navigation] Selected ${target.recoveryDetour ? 'local recovery detour' : 'reachable waypoint'} (${target.x}, ${target.y}, ${target.z}) via ${target.previewStatus || 'pathfinder'} route (${target.previewLength || '?'} nodes); spawn distance=${distanceFromAnchor(currentPosition).toFixed(1)}.`);
      } catch (e) {
        currentGoal = null;
        activePathGoal = null;
        nextActionAt = Date.now() + 1200;
        addLog('[Navigation] Could not set route goal:', e.message || String(e));
      }
    }).catch((error) => {
      addLog('[Navigation] Route planner task rejected:', error.message || String(error));
    }).finally(() => { planning = false; });
  }, 500);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      bot.setControlState("jump", true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === "function")
          bot.setControlState("jump", false);
      }, 300);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[RandomJump] Error:", e.message);
    }
  }, config.movement["random-jump"].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    if ((bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now()) ||
        (bot.__manjiBrain && bot.__manjiBrain.isHigherPriorityThanExploration())) return;
    try {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() * Math.PI) / 2 - Math.PI / 4;
      bot.look(yaw, pitch, false);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[LookAround] Error:", e.message);
    }
  }, config.movement["look-around"].interval);
}

// ============================================================
// CUSTOM MODULES
// ============================================================

// Avoid mobs/players
// FIX: e.username only exists on players; use e.name for mobs - now handled properly
function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      const entities = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" ||
          (e.type === "player" && e.username !== bot.username),
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState("back", true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === "function")
              bot.setControlState("back", false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      addLog("[AvoidMobs] Error:", e.message);
    }
  }, 2000);
}

// Combat module
// FIX: attack cooldown for 1.9+ (600ms minimum between attacks)
// FIX: lock onto a target for multiple ticks instead of randomly switching every tick
// FIX: autoEat - use i.foodPoints directly (mineflayer item property) instead of broken mcData lookup
function combatModule(bot, mcData) {
  let lastAttackTime = 0;
  let eating = false;
  let lastEatAttemptAt = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  // FIX: use physicsTick (not the deprecated physicTick)
  bot.on("physicsTick", () => {
    if (!bot || !botState.connected) return;
    if (!config.combat["attack-mobs"]) return;

    const now = Date.now();
    // FIX: 1.9+ attack cooldown - respect at least 600ms between swings
    if (now - lastAttackTime < 620) return;

    try {
      // FIX: only pick a new target if current one is gone or lock expired
      if (
        lockedTarget &&
        now < lockedTargetExpiry &&
        bot.entities[lockedTarget.id] &&
        lockedTarget.position
      ) {
        const dist = bot.entity.position.distanceTo(lockedTarget.position);
        if (dist < 4) {
          bot.attack(lockedTarget);
          lastAttackTime = now;
          return;
        } else {
          lockedTarget = null;
        }
      }

      // Pick a new target
      const mobs = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" &&
          e.position &&
          bot.entity.position.distanceTo(e.position) < 4,
      );
      if (mobs.length > 0) {
        lockedTarget = mobs[0];
        lockedTargetExpiry = now + 3000; // stick to same mob for 3 seconds
        bot.attack(lockedTarget);
        lastAttackTime = now;
      }
    } catch (e) {
      addLog("[Combat] Error:", e.message);
    }
  });

  // FIX: autoEat - check foodPoints property on the item directly (works reliably)
  bot.on("health", async () => {
    if (!config.combat["auto-eat"] || eating || !botState.connected) return;
    if (Date.now() - lastEatAttemptAt < 2500 || Number(bot.food) >= 14) return;
    const food = bot.inventory.items().find((item) => Number(item.foodPoints) > 0);
    if (!food) return;
    eating = true;
    lastEatAttemptAt = Date.now();
    try {
      await bot.equip(food, "hand");
      if (Number(bot.food) < 20 && botState.connected) await bot.consume();
    } catch (e) {
      addLog("[AutoEat] Error:", e.message);
    } finally {
      eating = false;
    }
  });
}

// Bed module
// FIX: bot.isSleeping can be stale; use a local isTryingToSleep guard to prevent double-sleep errors
// FIX: place-night was false in default settings - documentation note added
function bedModule(bot, mcData) {
  let isTryingToSleep = false;

  addInterval(async () => {
    if (!bot || !botState.connected) return;
    if (!config.beds["place-night"]) return; // FIX: check flag (was always skipping before)

    try {
      const isNight =
        bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;

      // FIX: use local guard instead of stale bot.isSleeping
      if (isNight && !isTryingToSleep) {
        const bedBlock = bot.findBlock({
          matching: (block) => block.name.includes("bed"),
          maxDistance: 8,
        });

        if (bedBlock) {
          isTryingToSleep = true;
          try {
            await bot.sleep(bedBlock);
            addLog("[Bed] Sleeping...");
          } catch (e) {
            // Can't sleep - maybe not night enough or monsters nearby
          } finally {
            isTryingToSleep = false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;
      addLog("[Bed] Error:", e.message);
    }
  }, 10000);
}

// Damage reaction and self-defence module
// Mineflayer's entityHurt event identifies the victim, not always the exact
// source. We only act when there is one plausible nearby attacker.
function damageReactionModule(bot, defaultMove) {
  const root = config.interactions || {};
  const settings = root["damage-reactions"] || {};
  const combat = root["self-defence"] || {};
  const navigationConfig = config.navigation || {};
  const combatStuckTimeoutMs = Math.max(900, Number(navigationConfig.combatStuckTimeoutMs) || 1450);
  const reactionsEnabled = settings.enabled !== false;
  const combatEnabled = combat.enabled === true;

  // Armor maintenance is independent of hostile scanning. It is serialized
  // only against simultaneous weapon equip/stow transactions.
  let controllerBusy = false;
  let currentMode = null;
  let weaponController = null;
  const armorSettings = (config.equipment && config.equipment.armor) || {};
  if (armorSettings.enabled !== false) {
    const armorController = new ArmorController(bot, {
      log: addLog,
      customSlotKeywords: armorSettings["custom-slot-keywords"] || {},
      operationTimeoutMs: armorSettings["operation-timeout-ms"] || 2500,
      upgradeMargin: armorSettings["upgrade-margin"] ?? 0.25,
      // Armor is safe to maintain during movement/combat. Only serialize with
      // another hand-slot transaction; pausing for the whole combat tick could
      // starve armor checks because hostile scanning runs continuously.
      canRun: () => canRunArmorTransaction(bot, weaponController)
    });
    const armorIntervalMs = Math.max(2500, Number(armorSettings["check-interval-ms"]) || 3000);
    let armorRefreshTimer = null;
    const refreshArmorSoon = () => {
      if (armorRefreshTimer) clearTimeout(armorRefreshTimer);
      armorRefreshTimer = setTimeout(() => {
        armorRefreshTimer = null;
        if (bot && botState.connected) void armorController.equipBestAvailable();
      }, 300);
    };
    if (bot.inventory && typeof bot.inventory.on === 'function') {
      // Picking up armor or having a slot updated triggers a quick re-check.
      if (armorSettings['rescan-on-inventory-change'] !== false) {
        bot.inventory.on('updateSlot', refreshArmorSoon);
        if (typeof bot.on === 'function') bot.on('windowUpdate', refreshArmorSoon);
      }
    }
    setTimeout(() => {
      if (bot && botState.connected) void armorController.equipBestAvailable();
    }, 1800);
    addInterval(() => {
      if (bot && botState.connected) void armorController.equipBestAvailable();
    }, armorIntervalMs);
  }

  if (!reactionsEnabled && !combatEnabled) return;

  const baseCooldown = Math.max(1000, Number(settings["base-cooldown-ms"]) || 5000);
  const rapidCooldown = Math.max(1000, Number(settings["rapid-cooldown-ms"]) || 1800);
  const rapidWindow = Math.max(1000, Number(settings["rapid-window-ms"]) || 10000);
  const attackerRadius = Math.max(2, Number(settings["attacker-radius"]) || 12);
  const detectionRadius = Math.max(4, Number(combat["detection-radius"]) || 12);
  const combatRadius = Math.max(detectionRadius, Number(combat["combat-radius"]) || 16);
  const safeDistance = Math.max(8, Number(combat["safe-distance"]) || 14);
  const fleeDistance = Math.max(8, Number(combat["flee-distance"]) || 16);
  const targetLostGraceMs = Math.max(1000, Number(combat["target-lost-grace-ms"]) || 6500);

  let lastReactionAt = 0;
  let lastDamageAt = 0;
  let previousMessage = null;
  let currentTargetId = null;
  let lastTargetConfirmedAt = 0;
  let lastGoalRefresh = 0;
  let lastAttackAt = 0;
  weaponController = new WeaponController(bot, { log: addLog, retryMs: 5000, operationTimeoutMs: 1800 });
  // Put an already-selected sword/axe/tool away on startup and keep a small
  // idle supervisor active even when the combat scan exits early. It never
  // interrupts the brief validated melee attack window.
  void weaponController.stowAfterThreat();
  addInterval(() => {
    if (!botState.connected || !bot.entity || !weaponController || weaponController.isAttackWindowActive()) return;
    void weaponController.stowAfterThreat();
  }, 1200);
  let combatRecoveryCycle = 0;
  let combatRecovery = { targetId: null, lastPosition: null, lastTargetPosition: null, lastProgressAt: 0, lastReplanAt: 0, attempts: 0, requested: false, replanning: false, detour: null };
  let projectileDodgeUntil = 0;
  let lastProjectileDodgeAt = 0;
  let lastNoDodgeSpotLogAt = 0;
  let creeperPhase = null;
  let lastNoWeaponLog = 0;
  let lastCreeperWarningAt = 0;
  let fleePlan = null;
  let fleeRouteIndex = 0;
  const combatDetourPlanner = new RoutePlanner({
    pathfinder: bot.pathfinder,
    movements: defaultMove,
    memory: bot.__manjiMemory || manjiMemory,
    candidates: 6,
    totalTimeoutMs: 520,
    tickTimeoutMs: 3,
    goalFactory: (x, y, z, range) => new GoalNear(x, y, z, range)
  });

  const hostileMobs = new Set([
    "blaze", "bogged", "breeze", "cave_spider", "creeper", "drowned",
    "elder_guardian", "ender_dragon", "endermite", "evoker", "ghast",
    "guardian", "hoglin", "husk", "illusioner", "magma_cube", "phantom",
    "piglin_brute", "pillager", "ravager", "shulker", "silverfish",
    "skeleton", "slime", "spider", "stray", "vex", "vindicator", "warden",
    "witch", "wither", "wither_skeleton", "zoglin", "zombie",
    "zombie_villager", "zombified_piglin"
  ]);
  const mobNames = {
    blaze: "blaze", bogged: "bogged", breeze: "breeze", cave_spider: "araña de cueva",
    creeper: "creeper", drowned: "ahogado", elder_guardian: "guardián anciano",
    ender_dragon: "Ender Dragon", endermite: "endermite", evoker: "invocador",
    ghast: "ghast", guardian: "guardián", hoglin: "hoglin", husk: "zombi momificado",
    illusioner: "ilusionista", magma_cube: "cubo de magma", phantom: "phantom",
    piglin_brute: "piglin bruto", pillager: "saqueador", ravager: "devastador",
    shulker: "shulker", silverfish: "pez de plata", skeleton: "esqueleto",
    slime: "slime", stray: "esqueleto glacial", vex: "vex",
    vindicator: "vindicador", warden: "warden", witch: "bruja", wither: "Wither",
    wither_skeleton: "esqueleto del Wither", zoglin: "zoglin", zombie: "zombi",
    zombie_villager: "aldeano zombi", zombified_piglin: "piglin zombificado"
  };
  const playerMessages = Array.isArray(settings["player-messages"]) && settings["player-messages"].length
    ? settings["player-messages"]
    : ["¡Eh, {name}! ¿Qué haces?", "¡Deja de pegarme, {name}!", "¡Oye, que estoy aquí!"];
  const mobMessages = Array.isArray(settings["mob-messages"]) && settings["mob-messages"].length
    ? settings["mob-messages"]
    : ["¡Un {mob} me está atacando!", "¡Cuidado, un {mob}!", "¡Que alguien me ayude con ese {mob}!"];
  const generalMessages = Array.isArray(settings["general-messages"]) && settings["general-messages"].length
    ? settings["general-messages"]
    : ["¡Ouch!", "¡Ay! ¡Eso ha dolido!", "¡Eh, que duele!"];

  function distanceTo(entity) {
    return entity && entity.position && bot.entity
      ? entity.position.distanceTo(bot.entity.position)
      : Infinity;
  }

  // Mineflayer on this server classifies hostile mobs as type "hostile",
  // not necessarily "mob". Identify known hostile mobs by their entity name.
  // Players are explicitly excluded so Manji never initiates player attacks.
  function isHostileMobEntity(entity) {
    if (!entity || entity.type === "player") return false;
    return hostileMobs.has(String(entity.name || "").toLowerCase());
  }

  // Real line-of-sight test: Mineflayer does not expose a direct entity-visibility method.
  // Its synchronous world (bot.world) does expose raycast(from, direction, range).
  // We test several points on the mob's body so a partially visible target counts,
  // while walls, floors and ceilings still block enemies in other rooms/levels.
  const hostileSightCache = new Map();
  function canSeeHostile(entity) {
    if (!entity || !entity.position || !bot.entity || !bot.world ||
        typeof bot.world.raycast !== "function") return false;

    const now = Date.now();
    const cached = hostileSightCache.get(entity.id);
    if (cached && now - cached.checkedAt < 180) return cached.visible;

    try {
      const Vec3 = bot.entity.position.constructor;
      const playerHeight = Number(bot.entity.height) || 1.8;
      const eye = bot.entity.position.offset(0, Math.min(1.62, playerHeight * 0.9), 0);
      const mobHeight = Math.max(0.8, Number(entity.height) || 1.5);
      const width = Math.max(0.12, Math.min(0.28, (Number(entity.width) || 0.6) * 0.32));
      const bodyY = [0.28, 0.55, 0.82];
      const samples = [
        ...bodyY.map((ratio) => entity.position.offset(0, mobHeight * ratio, 0)),
        entity.position.offset(width, mobHeight * 0.55, 0),
        entity.position.offset(-width, mobHeight * 0.55, 0),
        entity.position.offset(0, mobHeight * 0.55, width),
        entity.position.offset(0, mobHeight * 0.55, -width)
      ];

      let visible = false;
      for (const point of samples) {
        const dx = point.x - eye.x;
        const dy = point.y - eye.y;
        const dz = point.z - eye.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= 0.2) { visible = true; break; }
        const direction = new Vec3(dx / distance, dy / distance, dz / distance);
        // Stop the ray just before the sampled point inside the entity hitbox.
        // A returned block means a collision shape obstructs that sightline.
        const obstruction = bot.world.raycast(eye, direction, Math.max(0.05, distance - 0.16));
        if (!obstruction) { visible = true; break; }
      }

      hostileSightCache.set(entity.id, { checkedAt: now, visible });
      if (hostileSightCache.size > 128) {
        for (const [id, value] of hostileSightCache) {
          if (now - value.checkedAt > 1000) hostileSightCache.delete(id);
        }
      }
      return visible;
    } catch (e) {
      // Fail closed on an actual raycast error: don't attack through unknown blocks.
      return false;
    }
  }

  function getHostiles(maxDistance = Infinity) {
    if (!bot.entity || !bot.entities) return [];
    return Object.values(bot.entities).filter((entity) => {
      if (!entity || entity.id === bot.entity.id || !entity.position) return false;
      return isHostileMobEntity(entity) && distanceTo(entity) <= maxDistance && canSeeHostile(entity);
    }).sort((a, b) => distanceTo(a) - distanceTo(b));
  }

  function findLikelyAttacker() {
    if (!bot.entity || !bot.entities) return null;
    const candidates = Object.values(bot.entities).filter((candidate) => {
      if (!candidate || candidate.id === bot.entity.id || !candidate.position) return false;
      if (distanceTo(candidate) > attackerRadius) return false;
      if (candidate.type === "player") return true;
      return isHostileMobEntity(candidate);
    });
    candidates.sort((a, b) => distanceTo(a) - distanceTo(b));
    return candidates[0] || null;
  }

  function randomMessage(pool, replacements = {}) {
    let choices = pool.map((template) => {
      let message = String(template);
      for (const [key, value] of Object.entries(replacements)) message = message.split(`{${key}}`).join(String(value));
      return message.replace(/\{(?:name|mob)\}/g, "").replace(/\s{2,}/g, " ").trim();
    }).filter(Boolean);
    if (!choices.length) choices = generalMessages;
    if (choices.length > 1 && previousMessage !== null) {
      const filtered = choices.filter((message) => message !== previousMessage);
      if (filtered.length) choices = filtered;
    }
    const message = choices[Math.floor(Math.random() * choices.length)];
    previousMessage = message;
    return message;
  }

  async function equipBestWeapon() {
    return weaponController.equipForCombat();
  }

  async function stowCombatWeapon() {
    return weaponController.stowAfterThreat();
  }

  function hasWeapon() {
    return weaponController.hasWeapon();
  }

  function resetCombatRecovery(target) {
    combatRecovery = {
      targetId: target ? target.id : null,
      lastPosition: bot.entity && bot.entity.position ? bot.entity.position.clone() : null,
      lastTargetPosition: target && target.position ? target.position.clone() : null,
      lastProgressAt: Date.now(),
      lastReplanAt: 0,
      attempts: 0,
      requested: false,
      replanning: false,
      detour: null
    };
  }

  function findSafeCombatDetourCandidates(target) {
    if (!bot.entity || typeof bot.blockAt !== 'function') return [];
    const current = bot.entity.position;
    const raw = buildCombatDetourCandidates(current, target.position, combatRecoveryCycle++);
    const safe = [];
    const isLiquidBlock = (block) => !!block && /water|lava/.test(String(block.name || '').toLowerCase());
    for (const point of raw) {
      const feetPos = current.offset(point.x + 0.5 - current.x, point.y - current.y, point.z + 0.5 - current.z);
      const floor = bot.blockAt(feetPos.offset(0, -1, 0));
      const feet = bot.blockAt(feetPos);
      const head = bot.blockAt(feetPos.offset(0, 1, 0));
      if (!floor || floor.boundingBox !== 'block' || isLiquidBlock(floor) ||
          !feet || feet.boundingBox !== 'empty' || isLiquidBlock(feet) ||
          !head || head.boundingBox !== 'empty' || isLiquidBlock(head)) continue;
      safe.push(point);
      if (safe.length >= 18) break;
    }
    return safe;
  }

  async function replanCombatApproach(target, reason) {
    if (!target || !target.position || !bot.entity || !bot.pathfinder || combatRecovery.replanning) return false;
    const now = Date.now();
    if (now - combatRecovery.lastReplanAt < 1100) return false;
    combatRecovery.replanning = true;
    combatRecovery.lastReplanAt = now;
    try {
      // First escape the exact corner/block face where the bot is stuck.
      // Candidate points are checked for two-block body clearance and previewed
      // through the same incremental A* engine before a short hop is selected.
      const localCandidates = findSafeCombatDetourCandidates(target);
      const localTarget = await combatDetourPlanner.choose(localCandidates, bot.entity.position.clone());
      if (!botState.connected || !bot.entity || !bot.pathfinder || currentTargetId !== target.id) return false;

      if (localTarget) {
        bot.pathfinder.setGoal(null);
        releaseMovementControls();
        bot.pathfinder.setMovements(defaultMove);
        const detourGoal = new GoalNear(localTarget.x, localTarget.y, localTarget.z, 0.8);
        bot.pathfinder.setGoal(detourGoal);
        combatRecovery.detour = {
          x: localTarget.x, y: localTarget.y, z: localTarget.z,
          startedAt: now, lastProgressAt: now,
          lastPosition: bot.entity.position.clone(),
          expiresAt: now + 4200
        };
        combatRecovery.lastPosition = bot.entity.position.clone();
        combatRecovery.lastTargetPosition = target.position.clone();
        combatRecovery.lastProgressAt = now;
        combatRecovery.attempts += 1;
        combatRecovery.requested = false;
        lastGoalRefresh = now;
        addLog(`[Navigation] Corner recovery (${reason}); selected a reachable local detour at (${localTarget.x}, ${localTarget.y}, ${localTarget.z}) before resuming pursuit (attempt ${combatRecovery.attempts}).`);
        return true;
      }

      // If no local escape point can be previewed, retain the earlier flank
      // strategy as a bounded fallback; never dig or build a pillar.
      const candidates = buildApproachCandidates(bot.entity.position, target.position, combatRecoveryCycle++);
      const goalsToTry = candidates.map((point) => new GoalNear(point.x, point.y, point.z, 1));
      goalsToTry.push(new GoalFollow(target, 2.2));
      bot.pathfinder.setGoal(null);
      releaseMovementControls();
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalCompositeAny(goalsToTry), true);
      combatRecovery.lastPosition = bot.entity.position.clone();
      combatRecovery.lastTargetPosition = target.position.clone();
      combatRecovery.lastProgressAt = now;
      combatRecovery.attempts += 1;
      combatRecovery.requested = false;
      lastGoalRefresh = now;
      addLog(`[Navigation] No reachable local detour found (${reason}); trying ${candidates.length} wider flank positions around the target.`);
      return true;
    } catch (error) {
      combatRecovery.requested = false;
      addLog(`[Navigation] Combat route recovery failed: ${error.message || String(error)}.`);
      return false;
    } finally {
      combatRecovery.replanning = false;
    }
  }

  function superviseCombatApproach(target, targetDistance) {
    if (!target || !target.position || !bot.entity || !bot.pathfinder) return;
    if (currentMode === 'projectile-dodge' && Date.now() < projectileDodgeUntil) return;
    const now = Date.now();
    if (combatRecovery.targetId !== target.id || !combatRecovery.lastPosition) resetCombatRecovery(target);
    if (combatRecovery.replanning) return;

    const position = bot.entity.position;
    if (combatRecovery.detour) {
      const detour = combatRecovery.detour;
      const distanceToDetour = Math.hypot(position.x - (detour.x + 0.5), position.y - detour.y, position.z - (detour.z + 0.5));
      const movedDuringDetour = position.distanceTo(detour.lastPosition);
      if (movedDuringDetour >= 0.22) {
        detour.lastPosition = position.clone();
        detour.lastProgressAt = now;
      }
      if (distanceToDetour <= 1.2) {
        combatRecovery.detour = null;
        combatRecovery.lastPosition = position.clone();
        combatRecovery.lastProgressAt = now;
        combatRecovery.lastTargetPosition = target.position.clone();
        combatRecovery.requested = false;
        try {
          bot.pathfinder.setMovements(defaultMove);
          bot.pathfinder.setGoal(new GoalFollow(target, 2.2), true);
          addLog('[Navigation] Local detour reached; resuming direct hostile pursuit.');
        } catch (error) {
          combatRecovery.requested = true;
          addLog(`[Navigation] Could not resume pursuit after detour: ${error.message || String(error)}.`);
        }
        return;
      }
      if (combatRecovery.requested || now - detour.lastProgressAt >= combatStuckTimeoutMs || now >= detour.expiresAt) {
        combatRecovery.detour = null;
        combatRecovery.requested = true;
        try { bot.pathfinder.setGoal(null); } catch (_) {}
        releaseMovementControls();
      } else {
        return;
      }
    }

    if (targetDistance <= 3.4) {
      combatRecovery.lastPosition = position.clone();
      combatRecovery.lastProgressAt = now;
      combatRecovery.requested = false;
      return;
    }

    const moved = position.distanceTo(combatRecovery.lastPosition);
    const targetMoved = combatRecovery.lastTargetPosition
      ? target.position.distanceTo(combatRecovery.lastTargetPosition)
      : Infinity;
    if (moved >= 0.28) {
      combatRecovery.lastPosition = position.clone();
      combatRecovery.lastProgressAt = now;
      combatRecovery.attempts = 0;
    }

    if (combatRecovery.lastReplanAt && targetMoved >= 1.25 && now - combatRecovery.lastReplanAt >= 1100) {
      combatRecovery.requested = true;
    }
    const stalled = now - combatRecovery.lastProgressAt >= combatStuckTimeoutMs;
    if ((stalled || combatRecovery.requested) && now - combatRecovery.lastReplanAt >= 1100) {
      void replanCombatApproach(target, stalled ? `no position progress for ${Math.round(combatStuckTimeoutMs)}ms` : 'target moved away from detour/flank');
    }
  }

  bot.on('path_reset', (reason) => {
    if (reason === 'stuck' && (currentMode === 'attack' || currentMode === 'creeper-approach')) {
      combatRecovery.requested = true;
    }
  });
  bot.on('path_update', (result) => {
    if (result && (result.status === 'noPath' || result.status === 'timeout') &&
        (currentMode === 'attack' || currentMode === 'creeper-approach')) {
      combatRecovery.requested = true;
    }
  });

  function stopCombat(reason) {
    if (bot.__manjiBrain) bot.__manjiBrain.setSignal('combat', false);
    if (currentMode === null && currentTargetId === null) {
      void stowCombatWeapon();
      return;
    }
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
    addLog(`[Combat] Combat behaviour ended: ${reason}.`);
    currentTargetId = null;
    lastTargetConfirmedAt = 0;
    currentMode = null;
    resetCombatRecovery(null);
    creeperPhase = null;
    fleePlan = null;
    lastGoalRefresh = 0;
    bot.__manjiCombatUntil = Date.now() + 700;
    void stowCombatWeapon();
  }

  function findEscapeStandingSpot(idealX, idealZ, preferredY) {
    if (!bot.entity || typeof bot.blockAt !== 'function') return null;
    const current = bot.entity.position;
    const baseX = Math.floor(idealX);
    const baseZ = Math.floor(idealZ);
    const offsets = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2]
    ];
    const candidates = [];
    for (const [ox, oz] of offsets) {
      const x = baseX + ox;
      const z = baseZ + oz;
      for (const dy of [0, -1, 1, -2, 2, -3]) {
        const y = Math.floor(preferredY) + dy;
        const feetPos = current.offset(x + 0.5 - current.x, y - current.y, z + 0.5 - current.z);
        const floor = bot.blockAt(feetPos.offset(0, -1, 0));
        const feet = bot.blockAt(feetPos);
        const head = bot.blockAt(feetPos.offset(0, 1, 0));
        const liquid = (b) => !!b && /water|lava/.test(String(b.name || '').toLowerCase());
        if (floor && floor.boundingBox === 'block' && !liquid(floor) &&
            feet && feet.boundingBox === 'empty' && !liquid(feet) &&
            head && head.boundingBox === 'empty' && !liquid(head)) {
          candidates.push({ x, y, z, score: Math.hypot((x + 0.5) - idealX, (z + 0.5) - idealZ) + Math.abs(y - preferredY) * 1.5 });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  let fleePlanRevision = 0;

  function releaseMovementControls() {
    if (typeof bot.setControlState !== "function") return;
    for (const control of ["forward", "back", "left", "right", "sprint", "jump"]) {
      try { bot.setControlState(control, false); } catch (e) {}
    }
  }

  function tryDodgeIncomingProjectile() {
    if (!bot.entity || !bot.pathfinder || !bot.entities) return false;
    const now = Date.now();
    if (now < projectileDodgeUntil) return true;
    if (now - lastProjectileDodgeAt < 850) return false;

    const threat = findIncomingProjectile(Object.values(bot.entities), bot.entity.position, {
      maxDistance: 12, maxTicks: 12, hitRadius: 1.45
    });
    if (!threat) return false;

    const points = buildLateralDodgePoints(bot.entity.position, threat.velocity, 3.4);
    const safeSpots = points
      .map((point) => findEscapeStandingSpot(point.x, point.z, bot.entity.position.y))
      .filter(Boolean);
    if (!safeSpots.length) {
      if (now - lastNoDodgeSpotLogAt >= 3000) {
        addLog(`[Combat][Defense] Incoming ${threat.name} predicted, but no safe lateral standing spot is available.`);
        lastNoDodgeSpotLogAt = now;
      }
      return false;
    }

    try {
      const dodgeGoals = safeSpots.map((spot) => new GoalNear(spot.x, spot.y, spot.z, 1));
      bot.pathfinder.setGoal(null);
      releaseMovementControls();
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalCompositeAny(dodgeGoals));
      currentMode = 'projectile-dodge';
      projectileDodgeUntil = now + 950;
      lastProjectileDodgeAt = now;
      addLog(`[Combat][Defense] Incoming ${threat.name} predicted in ${threat.timeToClosest.toFixed(1)} ticks; executing lateral dodge.`);
      return true;
    } catch (error) {
      addLog(`[Combat][Defense] Could not set projectile evasion route: ${error.message || String(error)}.`);
      return false;
    }
  }

  function setFleeGoal(target, retreatDistance = fleeDistance) {
    if (!target || !target.position || !bot.entity || !bot.pathfinder) return;
    const current = bot.entity.position;
    let dx = current.x - target.position.x;
    let dz = current.z - target.position.z;
    let length = Math.hypot(dx, dz);
    if (length < 0.25) {
      const angle = Math.random() * Math.PI * 2;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      length = 1;
    }
    const awayAngle = Math.atan2(dz / length, dx / length);
    const currentThreatDistance = distanceTo(target);

    // Give Pathfinder several safe retreat endpoints at once. GoalCompositeAny
    // lets A* choose an endpoint it can actually reach, instead of insisting on
    // one straight-away point that may sit behind a market wall or building.
    // Rotate bearings and vary distance on every retry so a blocked route does
    // not produce the same failed destination over and over.
    const turn = fleePlanRevision % 2 === 0 ? 1 : -1;
    const distanceScales = [1, 1.18, 0.9, 1.08];
    const distanceScale = distanceScales[fleePlanRevision % distanceScales.length];
    const baseOffsets = [0, 0.72, -0.72, 1.42, -1.42, 2.25, -2.25, Math.PI];
    const rotationStart = fleePlanRevision % baseOffsets.length;
    const orderedOffsets = baseOffsets.map((_, index) => baseOffsets[(index + rotationStart) % baseOffsets.length] * turn);
    fleePlanRevision += 1;

    const goalsToTry = [];
    const destinationCandidates = [];
    const used = new Set();
    for (const offset of orderedOffsets) {
      const angle = awayAngle + offset;
      const scaledDistance = retreatDistance * distanceScale;
      const idealX = current.x + Math.cos(angle) * scaledDistance;
      const idealZ = current.z + Math.sin(angle) * scaledDistance;
      const candidate = findEscapeStandingSpot(idealX, idealZ, current.y);
      if (!candidate) continue;
      const key = `${candidate.x},${candidate.y},${candidate.z}`;
      if (used.has(key)) continue;
      used.add(key);

      const threatDistance = Math.hypot(
        (candidate.x + 0.5) - target.position.x,
        (candidate.z + 0.5) - target.position.z
      );
      // Sideways movement is allowed to get around an obstacle, but the final
      // escape point must still increase separation from the hostile mob.
      if (threatDistance < currentThreatDistance + 1.5) continue;

      goalsToTry.push(new GoalNear(candidate.x, candidate.y, candidate.z, 1));
      destinationCandidates.push(candidate);
    }

    // Cancel any stale straight-ahead control before assigning the new escape
    // plan. If no safe point is available, stop and retry rather than pushing
    // into the block and wasting the creeper's fuse time.
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    releaseMovementControls();

    if (goalsToTry.length === 0) {
      fleePlan = {
        targetId: target.id,
        destinations: [],
        startedAt: Date.now(),
        lastProgressAt: Date.now(),
        lastPosition: current.clone(),
        forceReplan: false,
        retryAt: Date.now() + 900
      };
      addLog("[Combat] No safe escape point nearby; pausing briefly and checking another direction.");
      return;
    }

    try {
      bot.pathfinder.setMovements(defaultMove);
      const escapeGoal = goalsToTry.length === 1 ? goalsToTry[0] : new GoalCompositeAny(goalsToTry);
      bot.pathfinder.setGoal(escapeGoal);
      lastGoalRefresh = Date.now();
      fleePlan = {
        targetId: target.id,
        destinations: destinationCandidates,
        startedAt: Date.now(),
        lastProgressAt: Date.now(),
        lastPosition: current.clone(),
        forceReplan: false,
        retryAt: 0
      };
      addLog(`[Combat] Escape route set with ${goalsToTry.length} alternative reachable-area targets around obstacles.`);
    } catch (e) {
      addLog("[Combat] Could not set escape route:", e.message);
      fleePlan = {
        targetId: target.id,
        destinations: [],
        startedAt: Date.now(),
        lastProgressAt: Date.now(),
        lastPosition: current.clone(),
        forceReplan: false,
        retryAt: Date.now() + 900
      };
    }
  }

  function fleeNeedsReplan(target) {
    if (!fleePlan || fleePlan.targetId !== target.id || fleePlan.forceReplan) return true;
    const now = Date.now();
    if (fleePlan.retryAt) return now >= fleePlan.retryAt;
    const current = bot.entity.position;
    const moved = current.distanceTo(fleePlan.lastPosition);
    if (moved >= 0.35) {
      fleePlan.lastPosition = current.clone();
      fleePlan.lastProgressAt = now;
    }
    // Movement particles with almost no position change indicate the bot is
    // pressing against a collision. Replan quickly with rotated alternatives.
    if (now - fleePlan.lastProgressAt > 1700) {
      fleePlan.forceReplan = true;
      return true;
    }
    if (now - fleePlan.startedAt > 14000) return true;
    return false;
  }


  bot.on('path_reset', (reason) => {
    if (reason === 'stuck' && fleePlan) {
      fleePlan.forceReplan = true;
      releaseMovementControls();
    }
  });
  bot.on('path_update', (result) => {
    if (fleePlan && result && (result.status === 'noPath' || result.status === 'timeout')) {
      fleePlan.forceReplan = true;
      releaseMovementControls();
    }
  });

  async function controllerTick() {
    if (controllerBusy || !combatEnabled || !botState.connected || !bot.entity || !bot.pathfinder) return;
    controllerBusy = true;
    try {
      const nearby = getHostiles(detectionRadius);
      const active = currentTargetId && bot.entities ? bot.entities[currentTargetId] : null;
      const now = Date.now();
      const target = selectCombatTarget({
        visibleTargets: nearby,
        activeTarget: active,
        currentTargetId,
        lastConfirmedAt: lastTargetConfirmedAt,
        now,
        combatRadius,
        lostGraceMs: targetLostGraceMs,
        distanceTo
      });
      if (!target) {
        if (tryDodgeIncomingProjectile()) {
          if (bot.__manjiBrain) bot.__manjiBrain.setSignal('combat', true, { details: { target: 'projectile-defense' } });
          return;
        }
        stopCombat("no hostile mobs nearby");
        return;
      }
      if (tryDodgeIncomingProjectile()) {
        if (bot.__manjiBrain) bot.__manjiBrain.setSignal('combat', true, { details: { target: target.name } });
        return;
      }
      if (bot.__manjiBrain) bot.__manjiBrain.setSignal('combat', true, { details: { target: target.name } });
      if (canSeeHostile(target)) lastTargetConfirmedAt = now;

      const mobKey = String(target.name || "").toLowerCase();
      const isCreeper = mobKey === "creeper";
      const targetDistance = distanceTo(target);
      const weaponAvailable = hasWeapon();
      const targetChanged = currentTargetId !== target.id;
      const previousMode = currentMode;

      if (targetChanged) {
        resetCombatRecovery(target);
        currentTargetId = target.id;
        lastTargetConfirmedAt = now;
        lastGoalRefresh = 0;
        fleePlan = null;
        creeperPhase = isCreeper ? (weaponAvailable ? "approach" : "retreat") : null;
      }

      bot.__manjiCombatUntil = Date.now() + 1800;
      superviseCombatApproach(target, targetDistance);

      if (isCreeper && targetChanged && Date.now() - lastCreeperWarningAt > 6000) {
        try { bot.chat("¡Ayuda! ¡Un creeper me está persiguiendo!"); } catch (e) {}
        lastCreeperWarningAt = Date.now();
      }

      // Creepers use a cautious hit-and-retreat cycle: close in, strike once,
      // immediately create distance, then repeat only after reaching safety.
      if (isCreeper) {
        if (!weaponAvailable) {
          currentMode = "flee";
          creeperPhase = "retreat";
          await stowCombatWeapon();
          if (targetDistance >= safeDistance) {
            stopCombat("unarmed creeper is far enough away");
            return;
          }
          if (targetChanged || previousMode !== "flee" || fleeNeedsReplan(target)) {
            setFleeGoal(target, fleeDistance);
          }
          return;
        }

        if (!creeperPhase) creeperPhase = "approach";

        if (creeperPhase === "retreat") {
          currentMode = "creeper-retreat";
          await stowCombatWeapon();
          if (targetDistance >= 8) {
            try { bot.pathfinder.setGoal(null); } catch (e) {}
            creeperPhase = "approach";
            currentMode = "creeper-approach";
            fleePlan = null;
            lastGoalRefresh = 0;
            addLog("[Combat] Creeper at a safer distance; preparing another approach.");
          } else {
            if (targetChanged || previousMode !== "creeper-retreat" || fleeNeedsReplan(target)) {
              setFleeGoal(target, 10);
            }
            return;
          }
        }

        currentMode = "creeper-approach";
        if (targetDistance > 3.0) {
          // Keep the weapon in inventory while closing the distance.
          await stowCombatWeapon();
          if (targetChanged || previousMode !== "creeper-approach" || Date.now() - lastGoalRefresh >= 1400) {
            try {
              bot.pathfinder.setMovements(defaultMove);
              bot.pathfinder.setGoal(new GoalFollow(target, 2.5), true);
              lastGoalRefresh = Date.now();
              addLog(`[Combat] Approaching creeper cautiously (distance=${targetDistance.toFixed(1)}).`);
            } catch (e) {
              addLog("[Combat] Could not approach creeper:", e.message);
              stopCombat("could not approach creeper");
            }
          }
          return;
        }

        // Equip only at melee range, immediately before the strike.
        const equipped = await equipBestWeapon();
        if (!equipped) {
          creeperPhase = "retreat";
          currentMode = "creeper-retreat";
          setFleeGoal(target, 10);
          return;
        }

        let attacked = false;
        try {
          const aim = target.position.offset(0, Math.max(0.65, (target.height || 1.5) * 0.78), 0);
          await withTimeout(bot.lookAt(aim, true), 900, 'aim at hostile');
          if (bot.entities && bot.entities[target.id] && distanceTo(target) <= 3.15 &&
              canSeeHostile(target)) {
            bot.attack(target);
            lastAttackAt = Date.now();
            attacked = true;
            addLog("[Combat] Struck creeper; retreating immediately.");
          }
        } catch (e) {
          addLog("[Combat] Creeper strike failed:", e.message);
        }

        // Even if line-of-sight prevented the hit, do not remain beside a
        // creeper waiting for another chance while its fuse may be active.
        creeperPhase = "retreat";
        currentMode = "creeper-retreat";
        setFleeGoal(target, 10);
        await new Promise((resolve) => setTimeout(resolve, attacked ? 180 : 80));
        await stowCombatWeapon();
        return;
      }

      // Other hostile mobs: draw the weapon once when combat starts and keep
      // it equipped for the whole engagement. The previous version drew and
      // stowed it around every single hit, making Manji look idle between
      // swings and repeatedly interrupting its combat state.
      if (!weaponAvailable) {
        currentMode = "flee";
        await stowCombatWeapon();
        if (targetDistance > safeDistance) {
          stopCombat("unarmed threat is far enough away");
          return;
        }
        if (targetChanged || previousMode !== "flee" || fleeNeedsReplan(target)) {
          setFleeGoal(target, fleeDistance);
        }
        if (Date.now() - lastNoWeaponLog > 10000) {
          addLog("[Combat] No melee weapon found; Manji is retreating instead of fighting unarmed.");
          lastNoWeaponLog = Date.now();
        }
        return;
      }

      currentMode = "attack";
      if (targetChanged || previousMode !== "attack") {
        try {
          bot.pathfinder.setMovements(defaultMove);
          bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
          lastGoalRefresh = Date.now();
          addLog(`[Combat] Detected ${mobNames[mobKey] || mobKey} (entity type=${target.type || "unknown"}, distance=${targetDistance.toFixed(1)}); approaching.`);
        } catch (e) {
          addLog("[Combat] Could not start pursuit:", e.message);
          stopCombat("could not pathfind to target");
          return;
        }
      }

      // Keep the sword in hand while Manji is pursuing or fighting a hostile.
      // equipForCombat refreshes the controller's active-combat lease so the
      // idle hand supervisor cannot put the sword away between attack ticks.
      const weaponReady = await equipBestWeapon();
      if (!weaponReady) return;

      const attackWindow = targetDistance <= 3.35 &&
        Date.now() - lastAttackAt >= 650 &&
        bot.entities && bot.entities[target.id];
      if (!attackWindow) return;

      try {
        const aim = target.position.offset(0, Math.max(0.65, (target.height || 1.5) * 0.78), 0);
        await withTimeout(bot.lookAt(aim, true), 900, 'aim at hostile');
        // Visibility is required for the actual hit, but not for retaining the
        // combat lock while Pathfinder works around a wall/corner.
        if (bot.entities[target.id] && distanceTo(target) <= 3.6 && canSeeHostile(target)) {
          bot.attack(target);
          lastAttackAt = Date.now();
          addLog(`[Combat] Attack command sent to ${mobNames[mobKey] || mobKey}; weapon remains equipped while combat continues.`);
        }
      } catch (e) {
        addLog("[Combat] Attack attempt failed:", e.message);
      }
    } catch (e) {
      addLog("[Combat] Controller error:", e.message);
    } finally {
      controllerBusy = false;
    }
  }


  bot.on('entityDead', (entity) => {
    if (entity && currentTargetId != null && entity.id === currentTargetId) {
      addLog(`[Combat] Target eliminated: ${mobNames[String(entity.name || '').toLowerCase()] || entity.name || 'hostile mob'}.`);
    }
  });

  if (combatEnabled) {
    // Scan continuously, not only after receiving damage. This is the key fix
    // for mobs standing nearby while Manji continues his idle route.
    addInterval(() => controllerTick(), 450);
    addLog(`[Combat] Continuous hostile scan enabled (radius ${detectionRadius}).`);
  }

  if (reactionsEnabled) {
    bot.on("entityHurt", (entity) => {
      if (!bot || !botState.connected || !bot.entity || !entity || entity.id !== bot.entity.id) return;
      const attacker = findLikelyAttacker();
      if (!attacker) return;

      const now = Date.now();
      const repeatedHits = now - lastDamageAt <= rapidWindow;
      lastDamageAt = now;
      const cooldown = repeatedHits ? rapidCooldown : baseCooldown;
      const isPlayer = attacker.type === "player";
      const attackerName = String(attacker.username || (isPlayer && attacker.name && attacker.name !== "player" ? attacker.name : ""));
      const mobKey = String(attacker.name || "").toLowerCase();
      const mobLabel = mobNames[mobKey] || mobKey.replace(/_/g, " ") || "mob";

      if (now - lastReactionAt >= cooldown) {
        const contextualPool = isPlayer
          ? playerMessages.filter((message) => !String(message).includes("{name}") || Boolean(attackerName))
          : mobMessages.filter((message) => !String(message).includes("{mob}") || Boolean(mobNames[mobKey]));
        const message = randomMessage([...generalMessages, ...contextualPool], { name: attackerName, mob: mobLabel });
        lastReactionAt = now;
        try {
          bot.chat(message);
          addLog(`[Interaction] ${isPlayer ? "Player" : "Mob"} damage reaction: ${message}`);
        } catch (e) {
          addLog("[Interaction] Could not send damage reaction:", e.message);
        }
      }
    });
  }
}

// Chat module
// FIX: wire up discord.events.chat flag
function chatModule(bot) {
  bot.on("chat", (username, message) => {
    if (!bot || username === bot.username) return;

    try {
      // FIX: send chat events to Discord if enabled
      if (
        config.discord &&
        config.discord.enabled &&
        config.discord.events &&
        config.discord.events.chat
      ) {
        sendDiscordWebhook(`💬 **${username}**: ${message}`, 0x7289da);
      }

      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith("!tp ")) {
          const target = message.split(" ")[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      addLog("[Chat] Error:", e.message);
    }
  });
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (!bot || !botState.connected) {
    addLog("[Console] Bot not connected");
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("say ")) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith("cmd ")) {
    bot.chat("/" + trimmed.slice(4));
  } else if (trimmed === "status") {
    addLog(
      `Connected: ${botState.connected}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`,
    );
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// DISCORD WEBHOOK INTEGRATION
// FIX: use Buffer.byteLength for Content-Length (handles non-ASCII usernames correctly)
// FIX: rate limiting to avoid spam when bot is flapping
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  if (
    !config.discord ||
    !config.discord.enabled ||
    !config.discord.webhookUrl ||
    config.discord.webhookUrl.includes("YOUR_DISCORD")
  )
    return;

  // FIX: Discord rate limiting - skip if sent too recently
  const now = Date.now();
  if (now - lastDiscordSend < DISCORD_RATE_LIMIT_MS) {
    addLog("[Discord] Rate limited - skipping webhook");
    return;
  }
  lastDiscordSend = now;

  const protocol = config.discord.webhookUrl.startsWith("https") ? https : http;
  const urlParts = new URL(config.discord.webhookUrl);

  const payload = JSON.stringify({
    username: config.name,
    embeds: [
      {
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: "Slobos AFK Bot" },
      },
    ],
  });

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: urlParts.pathname + urlParts.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // FIX: use Buffer.byteLength instead of payload.length - handles non-ASCII (e.g. usernames with accents/emoji)
      "Content-Length": Buffer.byteLength(payload, "utf8"),
    },
  };

  const req = protocol.request(options, (res) => {
    // Silent success
  });

  req.on("error", (e) => {
    addLog(`[Discord] Error sending webhook: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ============================================================
// PROCESS FAILURE POLICY
// Ordinary Minecraft disconnects are retried by the bot's "end" handler.
// An uncaught exception is different: continuing after it can leave Node.js
// state inconsistent. Persist what we can, clean up, and let the host's
// process supervisor restart the service according to its configured policy.
// ============================================================
let fatalShutdownStarted = false;

function fatalProcessShutdown(source, error) {
  if (fatalShutdownStarted) return;
  fatalShutdownStarted = true;
  shutdownStarted = true;
  const message = error && (error.stack || error.message)
    ? (error.stack || error.message)
    : String(error);
  addLog(`[FATAL] ${source}: ${message}`);
  botState.errors.push({ type: source, message: String(message).slice(0, 2000), time: Date.now() });
  if (botState.errors.length > 100) botState.errors = botState.errors.slice(-50);

  botRunning = false;
  isReconnecting = false;
  clearBotTimeouts();
  clearAllIntervals();

  const activeBot = bot;
  bot = null;
  if (activeBot) {
    try { activeBot.removeAllListeners(); } catch (_) {}
    try { activeBot.end(); } catch (_) {}
  }

  // Do not wait indefinitely for sockets or a disk write after a fatal error.
  const forceExit = setTimeout(() => {
    releaseProcessLock();
    process.exit(1);
  }, 5000);

  void manjiMemory.save()
    .catch((saveError) => addLog('[Memory] Save during fatal shutdown failed:', saveError.message || String(saveError)))
    .finally(() => {
      clearTimeout(forceExit);
      releaseProcessLock();
      try {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => process.exit(1));
      } catch (_) {
        process.exit(1);
      }
    });
}

process.on('uncaughtException', (error) => {
  fatalProcessShutdown('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  const message = reason && (reason.stack || reason.message)
    ? (reason.stack || reason.message)
    : String(reason);
  const isNetworkError = isRecoverableNetworkFailure(reason);

  addLog(`[${isNetworkError ? 'WARN' : 'FATAL'}] Unhandled promise rejection: ${message}`);
  botState.errors.push({ type: 'rejection', message: String(message).slice(0, 2000), time: Date.now() });
  if (botState.errors.length > 100) botState.errors = botState.errors.slice(-50);

  if (isNetworkError) {
    // The network stack may reject while Mineflayer is closing; let the normal
    // connection lifecycle own recovery and keep the backoff/de-duplication.
    if (bot && botRunning && config.utils['auto-reconnect'] === true) {
      try { bot.end(); } catch (_) {}
    } else if (botRunning && config.utils['auto-reconnect'] === true) {
      scheduleReconnect();
    }
    return;
  }

  fatalProcessShutdown('unhandledRejection', reason);
});

let shutdownStarted = false;
function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  addLog(`[System] ${signal} received; shutting down cleanly.`);
  botRunning = false;
  clearBotTimeouts();
  clearAllIntervals();
  const activeBot = bot;
  bot = null;
  if (activeBot) {
    try {
      if (activeBot.entity) manjiMemory.setSession(activeBot.entity.position, activeBot.__manjiBrain?.current || 'shutdown');
    } catch (_) {}
    try { activeBot.quit(`Process ${signal}`); } catch (e) {
      try { activeBot.end(); } catch (_) {}
    }
  }
  const shutdownDeadline = setTimeout(() => {
    addLog('[Memory] Shutdown save deadline reached; exiting with last completed save.');
    releaseProcessLock();
    process.exit(0);
  }, 5000);
  shutdownDeadline.unref();
  void manjiMemory.save().catch((error) => addLog('[Memory] Final save failed:', error.message)).finally(() => {
    clearTimeout(shutdownDeadline);
    releaseProcessLock();
    server.close(() => process.exit(0));
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// =============================
//===============================
// START THE BOT
// ============================================================
addLog("=".repeat(50));
addLog("  Manji v12 - Autonomous AI 24/7");
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
if (!process.env.MC_HOST && ["127.0.0.1", "localhost", "::1"].includes(String(config.server.ip).toLowerCase())) {
  addLog("[Config] MC_HOST is not set. This address only works when Manji runs on the same machine as Minecraft; on Railway set MC_HOST to your home's reachable public IP or DDNS name.");
}
addLog(`Version: ${config.server.version || "26.3"}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled (exponential backoff)" : "Disabled (manual start)"}`,
);
addLog("=".repeat(50));

createBot();
