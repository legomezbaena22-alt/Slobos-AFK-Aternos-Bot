"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("@wp2508/mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalFollow, GoalCompositeAny } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
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
            <p>Get your AFK bot running in under 15 minutes</p>
          </header>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">1</div>
              <h2 class="step-title">Configure Aternos</h2>
            </div>
            <ol>
              <li>Go to <strong>Aternos</strong> and open your server.</li>
              <li>Install <strong>Paper/Bukkit</strong> as your server software.</li>
              <li>Enable <strong>Cracked</strong> mode using the green switch.</li>
              <li>Install these plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code></li>
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
              <h2 class="step-title">Deploy on Replit (Free 24/7)</h2>
            </div>
            <ol>
              <li>Import your GitHub repo into <strong>Replit</strong>.</li>
              <li>Set the run command to <code>npm start</code>.</li>
              <li>Hit <strong>Run</strong> — the bot connects automatically.</li>
              <li>The bot pings itself every 10 minutes to stay alive.</li>
            </ol>
          </div>

          <footer>
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
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
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
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

app.post("/start", (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  if (!botRunning) return res.json({ success: false, msg: "Already stopped" });

  botRunning = false;

  if (bot) {
    bot.end();
    bot = null;
  }

  clearAllIntervals();
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

// FIX: only one definition of formatUptime
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s} s`;
}

// ============================================================
// SELF-PING - Prevent Render from sleeping
// FIX: only ping if RENDER_EXTERNAL_URL is set (skip useless localhost ping)
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    addLog(
      "[KeepAlive] No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)",
    );
    return;
  }
  setInterval(() => {
    const protocol = renderUrl.startsWith("https") ? https : http;
    protocol
      .get(`${renderUrl}/ping`, (res) => {
        // Silent success
      })
      .on("error", (err) => {
        addLog(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  }, SELF_PING_INTERVAL);
  addLog("[KeepAlive] Self-ping system started (every 10 min)");
}

startSelfPing();

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
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
// ============================================================
// RECONNECTION & TIMEOUT MANAGEMENT
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
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
  return delay + jitter;
}

function createBot() {
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
      checkTimeoutInterval: 600000,
    });

    bot.loadPlugin(pathfinder);

    // FIX: connection timeout - end the old bot before reconnecting to avoid ghost bots
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
    }, 150000); // 150s - Aternos servers can take 90-120s to finish spawning a player

    // FIX: guard against spawn firing twice (can happen on some servers)
    let spawnHandled = false;

    bot.once("spawn", () => {
      if (spawnHandled) return;
      spawnHandled = true;

      clearBotTimeouts();
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

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

      // FIX: use bot.version (auto-detected) instead of config value so minecraft-data always matches
      const mcData = require("@wp2508/minecraft-data")(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      // Keep movement grounded and natural: stairs/normal steps remain usable,
      // but Manji will not pillar up 1x1 towers or make parkour leaps.
      defaultMove.allow1by1towers = false;
      defaultMove.allowParkour = false;
      defaultMove.maxDropDown = 3;
      // Avoid autonomous swimming; riding in a boat remains possible.
      defaultMove.canSwim = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

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
          addLog("[INFO] Bot is now in Creative Mode.");
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

      // ALWAYS reconnect — bot must never leave the server
      scheduleReconnect();
    });

    bot.on("error", (err) => {
      const msg = err.message || "";
      addLog(`[Bot] Error: ${msg}`);
      botState.errors.push({ type: "error", message: msg, time: Date.now() });
      // Don't reconnect on error - let 'end' event handle it
    });
  } catch (err) {
    addLog(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();

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
  // The configured position is the spawn anchor, not a tiny walking pen.
  const centerX = configured ? Number(pos.x) : bot.entity.position.x;
  const centerY = configured && Number.isFinite(Number(pos.y)) ? Number(pos.y) : bot.entity.position.y;
  const centerZ = configured ? Number(pos.z) : bot.entity.position.z;
  const explorationRadius = configured ? Math.max(20, Number(pos.radius) || 60) : 60;
  const returnRadius = explorationRadius * 0.82;
  const emergencyRadius = explorationRadius * 1.3;

  let currentGoal = null;
  let nextActionAt = Date.now() + 1200;
  let goalStartedAt = 0;
  let lastProgressAt = Date.now();
  let lastPosition = bot.entity.position.clone();
  let lastGoalDistance = Infinity;
  let heading = Math.random() * Math.PI * 2;
  let turnBias = Math.random() < 0.5 ? -1 : 1;
  const blockedWaypoints = new Map();

  function distanceFromAnchor(position) {
    return Math.hypot(position.x - centerX, position.z - centerZ);
  }

  function isLiquid(block) {
    return !!block && /water|lava/.test(String(block.name || '').toLowerCase());
  }

  function waypointKey(point) {
    return `${point.x},${point.y},${point.z}`;
  }

  function rememberBlocked(point, reason) {
    if (!point) return;
    blockedWaypoints.set(waypointKey(point), Date.now() + 45000);
    for (const [key, expiry] of blockedWaypoints) {
      if (expiry <= Date.now()) blockedWaypoints.delete(key);
    }
    addLog(`[Movement] Waypoint abandoned (${reason}); choosing another route.`);
  }

  // Find a real, two-block-high standing space close to the intended location.
  // A small local search is cheaper than scanning the entire 60-block area.
  function findSafePointNear(idealX, idealZ, preferredY) {
    if (!bot.entity || typeof bot.blockAt !== 'function') return null;
    const current = bot.entity.position;
    const baseX = Math.floor(idealX);
    const baseZ = Math.floor(idealZ);
    const offsets = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2]
    ];
    const verticalOffsets = [0, -1, 1, -2, 2, -3, 3];
    const candidates = [];

    for (const [ox, oz] of offsets) {
      const x = baseX + ox;
      const z = baseZ + oz;
      for (const dy of verticalOffsets) {
        const y = Math.floor(preferredY) + dy;
        const feetPos = current.offset(x + 0.5 - current.x, y - current.y, z + 0.5 - current.z);
        const floor = bot.blockAt(feetPos.offset(0, -1, 0));
        const feet = bot.blockAt(feetPos);
        const head = bot.blockAt(feetPos.offset(0, 1, 0));
        if (
          floor && floor.boundingBox === 'block' && !isLiquid(floor) &&
          feet && feet.boundingBox === 'empty' && !isLiquid(feet) &&
          head && head.boundingBox === 'empty' && !isLiquid(head)
        ) {
          const candidate = { x, y, z };
          const blockedUntil = blockedWaypoints.get(waypointKey(candidate)) || 0;
          if (blockedUntil > Date.now()) continue;
          const score = Math.hypot((x + 0.5) - idealX, (z + 0.5) - idealZ) + Math.abs(y - preferredY) * 1.8;
          candidates.push({ ...candidate, score });
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  function chooseWaypoint() {
    if (!bot.entity) return null;
    const current = bot.entity.position;
    const radialDistance = distanceFromAnchor(current);

    // Beyond the soft boundary, head back toward a broad outer ring (about 82%
    // of the radius), never all the way to spawn. Far outside, recover to it
    // more decisively without changing the anchor.
    if (radialDistance > explorationRadius) {
      const radialAngle = Math.atan2(current.z - centerZ, current.x - centerX);
      const desiredRadius = radialDistance > emergencyRadius
        ? explorationRadius * 0.9
        : returnRadius + Math.random() * explorationRadius * 0.045;
      const desiredAngle = radialAngle + (Math.random() - 0.5) * 0.35;
      const idealX = centerX + Math.cos(desiredAngle) * desiredRadius;
      const idealZ = centerZ + Math.sin(desiredAngle) * desiredRadius;
      return findSafePointNear(idealX, idealZ, current.y);
    }

    // Correlated random walk: retain some heading from the previous leg, then
    // add a bounded turn. Near the perimeter, follow a loose tangent or drift
    // inward so Manji explores the area instead of orbiting a 5-block circle.
    const nearBoundary = radialDistance > explorationRadius * 0.78;
    const attempts = 22;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let angle;
      if (nearBoundary) {
        const radialAngle = Math.atan2(current.z - centerZ, current.x - centerX);
        if (Math.random() < 0.68) {
          angle = radialAngle + turnBias * (Math.PI / 2 + (Math.random() - 0.5) * 0.9);
        } else {
          angle = radialAngle + Math.PI + (Math.random() - 0.5) * 0.9;
        }
        // Occasionally reverse the preferred tangent direction to avoid a fixed orbit.
        if (Math.random() < 0.16) turnBias *= -1;
      } else {
        heading += (Math.random() - 0.5) * 1.35;
        angle = heading;
      }

      const stepLength = 5 + Math.random() * 8;
      const idealX = current.x + Math.cos(angle) * stepLength;
      const idealZ = current.z + Math.sin(angle) * stepLength;
      const safe = findSafePointNear(idealX, idealZ, current.y);
      if (!safe) continue;
      const resultingRadius = Math.hypot((safe.x + 0.5) - centerX, (safe.z + 0.5) - centerZ);
      if (resultingRadius > explorationRadius * 1.035) continue;
      if (Math.hypot((safe.x + 0.5) - current.x, (safe.z + 0.5) - current.z) < 3.2) continue;
      heading = angle;
      return safe;
    }

    // Last resort near the edge: choose a safe point on the outer ring.
    const radialAngle = Math.atan2(current.z - centerZ, current.x - centerX);
    const fallbackRadius = Math.min(returnRadius, Math.max(8, radialDistance - 5));
    return findSafePointNear(
      centerX + Math.cos(radialAngle) * fallbackRadius,
      centerZ + Math.sin(radialAngle) * fallbackRadius,
      current.y
    );
  }

  function releaseMovementInputs() {
    if (!bot || typeof bot.setControlState !== "function") return;
    for (const control of ["forward", "back", "left", "right", "sprint", "jump"]) {
      try { bot.setControlState(control, false); } catch (e) {}
    }
  }

  function abandonCurrentGoal(reason) {
    if (!currentGoal) return;
    rememberBlocked(currentGoal, reason);
    // setGoal(null) is Pathfinder's immediate stop; clearing the movement keys
    // also prevents residual forward input from making foot particles at a wall.
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    releaseMovementInputs();
    currentGoal = null;
    nextActionAt = Date.now() + 800 + Math.floor(Math.random() * 800);
    lastProgressAt = Date.now();
    lastGoalDistance = Infinity;
    lastPosition = bot.entity ? bot.entity.position.clone() : lastPosition;
  }

  // Pathfinder exposes these events for no-path and stuck cases. They let us
  // discard the blocked waypoint instead of repeatedly walking into the same block.
  bot.on('path_update', (result) => {
    if (!currentGoal || (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) return;
    if (result && (result.status === 'noPath' || result.status === 'timeout')) {
      abandonCurrentGoal(result.status);
    }
  });
  bot.on('path_reset', (reason) => {
    if (reason === 'stuck' && currentGoal && !(bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now())) {
      abandonCurrentGoal('pathfinder stuck');
    }
  });

  addLog(`[Movement] Natural exploration enabled. Spawn anchor=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}, ${centerZ.toFixed(2)}), soft radius=${explorationRadius}, return ring≈${returnRadius.toFixed(0)}.`);

  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity || !bot.pathfinder) return;
    if (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now()) return;

    const now = Date.now();
    const position = bot.entity.position;

    if (currentGoal) {
      const goalDistance = Math.hypot(
        position.x - (currentGoal.x + 0.5),
        position.z - (currentGoal.z + 0.5)
      );
      if (goalDistance <= 1.45) {
        try { bot.pathfinder.setGoal(null); } catch (e) {}
        currentGoal = null;
        nextActionAt = now + 1600 + Math.floor(Math.random() * 4300);
        lastGoalDistance = Infinity;
        if (Math.random() < 0.42) {
          const yaw = Math.random() * Math.PI * 2 - Math.PI;
          const pitch = (Math.random() - 0.5) * 0.28;
          bot.look(yaw, pitch, false).catch(() => {});
        }
        return;
      }

      // Measure real displacement. A route may briefly curve sideways around a
      // wall, so movement need not reduce straight-line distance to the waypoint;
      // but if the position stays almost fixed, cancel before it keeps pushing.
      const physicalDisplacement = position.distanceTo(lastPosition);
      if (physicalDisplacement >= 0.22) {
        lastPosition = position.clone();
        lastProgressAt = now;
      }
      if (now - lastProgressAt > 2600 || now - goalStartedAt > 30000) {
        abandonCurrentGoal('no physical movement / blocked route');
      }
      return;
    }

    if (now < nextActionAt) return;

    // Natural pauses: look around, then select a new locally reachable leg.
    if (Math.random() < 0.2) {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() - 0.5) * 0.38;
      bot.look(yaw, pitch, false).catch(() => {});
      nextActionAt = now + 1800 + Math.floor(Math.random() * 4200);
      return;
    }

    const target = chooseWaypoint();
    if (!target) {
      nextActionAt = now + 1800;
      addLog('[Movement] No safe nearby waypoint found; will try another direction.');
      return;
    }

    try {
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 1));
      currentGoal = target;
      goalStartedAt = now;
      lastProgressAt = now;
      lastGoalDistance = Math.hypot(position.x - (target.x + 0.5), position.z - (target.z + 0.5));
      lastPosition = position.clone();
      botState.lastActivity = now;
      addLog(`[Movement] Exploring toward waypoint (${target.x}, ${target.y}, ${target.z}); distance from spawn=${distanceFromAnchor(position).toFixed(1)}.`);
    } catch (e) {
      currentGoal = null;
      nextActionAt = now + 1800;
      addLog('[Movement] Could not set waypoint:', e.message);
    }
  }, 650);
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
    if (bot.__manjiCombatUntil > Date.now()) return;
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
  bot.on("health", () => {
    if (!config.combat["auto-eat"]) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory
          .items()
          .find((i) => i.foodPoints && i.foodPoints > 0);
        if (food) {
          bot
            .equip(food, "hand")
            .then(() => bot.consume())
            .catch((e) => addLog("[AutoEat] Error:", e.message));
        }
      }
    } catch (e) {
      addLog("[AutoEat] Error:", e.message);
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
  const reactionsEnabled = settings.enabled !== false;
  const combatEnabled = combat.enabled === true;
  if (!reactionsEnabled && !combatEnabled) return;

  const baseCooldown = Math.max(1000, Number(settings["base-cooldown-ms"]) || 5000);
  const rapidCooldown = Math.max(1000, Number(settings["rapid-cooldown-ms"]) || 1800);
  const rapidWindow = Math.max(1000, Number(settings["rapid-window-ms"]) || 10000);
  const attackerRadius = Math.max(2, Number(settings["attacker-radius"]) || 12);
  const detectionRadius = Math.max(4, Number(combat["detection-radius"]) || 12);
  const combatRadius = Math.max(detectionRadius, Number(combat["combat-radius"]) || 16);
  const safeDistance = Math.max(8, Number(combat["safe-distance"]) || 14);
  const fleeDistance = Math.max(8, Number(combat["flee-distance"]) || 16);

  let lastReactionAt = 0;
  let lastDamageAt = 0;
  let previousMessage = null;
  let controllerBusy = false;
  let currentTargetId = null;
  let currentMode = null;
  let lastGoalRefresh = 0;
  let lastAttackAt = 0;
  let weaponEquipping = false;
  let weaponStowing = false;
  let combatWeaponEquippedByUs = false;
  let combatWeaponName = null;
  let creeperPhase = null;
  let lastNoWeaponLog = 0;
  let lastCreeperWarningAt = 0;
  let fleePlan = null;
  let fleeRouteIndex = 0;

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

  function isCombatWeaponName(name) {
    const n = String(name || "").toLowerCase();
    return /_(sword|axe)$/.test(n) || n === "trident" || n === "mace";
  }

  function findWeapon() {
    const items = bot.inventory && bot.inventory.items ? bot.inventory.items() : [];
    // Rank known melee weapons by their normal base hit damage. Enchantments
    // and special fall damage are not inferred from inventory metadata.
    const damage = {
      netherite_axe: 10, diamond_axe: 9, iron_axe: 9, stone_axe: 9,
      golden_axe: 7, wooden_axe: 7,
      trident: 9,
      netherite_sword: 8, diamond_sword: 7, iron_sword: 6,
      stone_sword: 5, golden_sword: 4, wooden_sword: 4,
      mace: 6
    };
    return items
      .filter((item) => isCombatWeaponName(item.name))
      .sort((a, b) => (damage[String(b.name).toLowerCase()] || 0) - (damage[String(a.name).toLowerCase()] || 0))[0] || null;
  }

  async function equipBestWeapon() {
    if (weaponEquipping || weaponStowing) return false;
    const weapon = findWeapon();
    if (!weapon) return false;
    const held = bot.heldItem;
    if (held && held.name === weapon.name) {
      combatWeaponName = held.name;
      combatWeaponEquippedByUs = true;
      return true;
    }
    weaponEquipping = true;
    try {
      await bot.equip(weapon, "hand");
      const equipped = !!(bot.heldItem && bot.heldItem.name === weapon.name);
      if (equipped) {
        combatWeaponName = bot.heldItem.name;
        combatWeaponEquippedByUs = true;
        addLog(`[Combat] Equipped strongest available weapon: ${bot.heldItem.name}.`);
      }
      return equipped;
    } catch (e) {
      addLog("[Combat] Could not equip weapon:", e.message);
      return false;
    } finally {
      weaponEquipping = false;
    }
  }

  async function stowCombatWeapon() {
    if (weaponStowing || weaponEquipping) return false;
    const held = bot.heldItem;
    // When no attack is in progress, any melee weapon in the hand is put away,
    // including one that was already selected before this module took over.
    // Other items (food, blocks, tools) are left untouched.
    if (!held || !isCombatWeaponName(held.name)) {
      combatWeaponEquippedByUs = false;
      combatWeaponName = null;
      return false;
    }
    if (typeof bot.unequip !== "function") return false;
    weaponStowing = true;
    try {
      await bot.unequip("hand");
      combatWeaponEquippedByUs = false;
      combatWeaponName = null;
      addLog("[Combat] Weapon stowed; no attack in progress.");
      return true;
    } catch (e) {
      addLog("[Combat] Could not stow weapon:", e.message);
      return false;
    } finally {
      weaponStowing = false;
    }
  }

  function hasWeapon() {
    const held = bot.heldItem;
    if (held && isCombatWeaponName(held.name)) return true;
    return !!findWeapon();
  }

  function stopCombat(reason) {
    if (currentMode === null && currentTargetId === null) {
      void stowCombatWeapon();
      return;
    }
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
    addLog(`[Combat] Combat behaviour ended: ${reason}.`);
    currentTargetId = null;
    currentMode = null;
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
      let target = nearby.find((entity) => entity.name === "creeper") || nearby[0] || null;

      // Continue the existing target briefly even if it has moved just beyond
      // the scan radius, so a fight/retreat is not cancelled between scans.
      if (!target && active && active.position && distanceTo(active) <= combatRadius && canSeeHostile(active)) target = active;
      if (!target) {
        stopCombat("no hostile mobs nearby");
        return;
      }

      const now = Date.now();
      const mobKey = String(target.name || "").toLowerCase();
      const isCreeper = mobKey === "creeper";
      const targetDistance = distanceTo(target);
      const weaponAvailable = hasWeapon();
      const targetChanged = currentTargetId !== target.id;
      const previousMode = currentMode;

      if (targetChanged) {
        currentTargetId = target.id;
        lastGoalRefresh = 0;
        fleePlan = null;
        creeperPhase = isCreeper ? (weaponAvailable ? "approach" : "retreat") : null;
      }

      bot.__manjiCombatUntil = Date.now() + 1800;

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
          const aim = target.position.offset(0, Math.max(0.5, (target.height || 1.5) * 0.55), 0);
          await bot.lookAt(aim, true);
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

      // Other hostile mobs: equip the strongest weapon while pursuing and
      // fighting, but put it away as soon as no hostile target remains.
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

      const equipped = await equipBestWeapon();
      if (!equipped) return;
      if (
        targetDistance <= 3.35 &&
        Date.now() - lastAttackAt >= 650 &&
        bot.entities && bot.entities[target.id]
      ) {
        try {
          const aim = target.position.offset(0, Math.max(0.5, (target.height || 1.5) * 0.55), 0);
          await bot.lookAt(aim, true);
          if (canSeeHostile(target)) {
            if (bot.entities[target.id] && distanceTo(target) <= 3.6) {
              bot.attack(target);
              lastAttackAt = Date.now();
            }
          }
        } catch (e) {
          addLog("[Combat] Attack attempt failed:", e.message);
        }
      }
    } catch (e) {
      addLog("[Combat] Controller error:", e.message);
    } finally {
      controllerBusy = false;
    }
  }

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
// CRASH RECOVERY - IMMORTAL MODE
// FIX: guard against uncaughtException stacking reconnects when isReconnecting is already true
// ============================================================
process.on("uncaughtException", (err) => {
  const msg = err.message || "Unknown";
  addLog(`[FATAL] Uncaught Exception: ${msg}`);
  botState.errors.push({ type: "uncaught", message: msg, time: Date.now() });

  // Cap errors array to prevent memory leak over long uptimes
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("PartialReadError") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timed out") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended");

  if (isNetworkError) {
    addLog("[FATAL] Known network/protocol error - recovering gracefully...");
  }

  // ALWAYS recover — bot must never stay disconnected
  clearAllIntervals();
  botState.connected = false;

  // FIX: reset isReconnecting if it was stuck, then schedule reconnect
  if (isReconnecting) {
    addLog(
      "[FATAL] isReconnecting was stuck - resetting before crash recovery",
    );
    isReconnecting = false;
    // BUG FIX: was referencing non-existent 'reconnectTimeout' — correct name is 'reconnectTimeoutId'
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  setTimeout(
    () => {
      scheduleReconnect();
    },
    isNetworkError ? 5000 : 10000,
  );
});

process.on("unhandledRejection", (reason) => {
  const msg = String(reason);
  addLog(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: "rejection", message: msg, time: Date.now() });
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("timed out") ||
    msg.includes("PartialReadError");

  if (isNetworkError && !isReconnecting) {
    addLog("[FATAL] Network rejection — triggering reconnect...");
    clearAllIntervals();
    botState.connected = false;
    if (bot) {
      try { bot.end(); } catch (_) {}
      bot = null;
    }
    scheduleReconnect();
  }
});

process.on("SIGTERM", () => {
  addLog("[System] SIGTERM received — ignoring, bot will stay alive.");
});

process.on("SIGINT", () => {
  addLog("[System] SIGINT received — ignoring, bot will stay alive.");
});

// =============================
//===============================
// START THE BOT
// ============================================================
addLog("=".repeat(50));
addLog("  Minecraft AFK Bot v2.5 - Bug-Fixed Edition");
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
addLog(`Version: ${config.server.version || "26.3"}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled" : "Disabled"}`,
);
addLog("=".repeat(50));

createBot();
