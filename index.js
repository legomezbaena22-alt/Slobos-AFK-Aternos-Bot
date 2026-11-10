"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("@wp2508/mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock, GoalNear, GoalFollow } = goals;
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
  const centerX = configured ? Number(pos.x) : bot.entity.position.x;
  const centerY = configured && Number.isFinite(Number(pos.y)) ? Number(pos.y) : bot.entity.position.y;
  const centerZ = configured ? Number(pos.z) : bot.entity.position.z;
  const radius = configured ? Math.max(1, Number(pos.radius) || 5) : 8;
  // Keep waypoint block-centres slightly inside the configured radius.
  const usableRadius = Math.max(0.5, radius - 0.55);
  let currentGoal = null;
  let nextActionAt = Date.now() + 1200;
  let goalStartedAt = 0;
  let lastProgressAt = Date.now();
  let lastPosition = bot.entity.position.clone();
  let safePointsCache = [];
  let safePointsCachedAt = 0;

  function horizontalDistanceToCenter(position) {
    return Math.hypot(position.x - centerX, position.z - centerZ);
  }

  function isLiquid(block) {
    return !!block && /water|lava/.test(String(block.name || "").toLowerCase());
  }

  function findSafePoints() {
    const now = Date.now();
    if (safePointsCache.length && now - safePointsCachedAt < 12000) return safePointsCache;
    const points = [];
    const minX = Math.floor(centerX - usableRadius - 0.5);
    const maxX = Math.ceil(centerX + usableRadius - 0.5);
    const minZ = Math.floor(centerZ - usableRadius - 0.5);
    const maxZ = Math.ceil(centerZ + usableRadius - 0.5);

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const blockCenterX = x + 0.5;
        const blockCenterZ = z + 0.5;
        if (Math.hypot(blockCenterX - centerX, blockCenterZ - centerZ) > usableRadius) continue;

        // Check a narrow vertical band around the configured Y to avoid choosing
        // a floor on top of a nearby building or a distant floor level.
        const verticalOffsets = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5];
        for (const dy of verticalOffsets) {
          const y = Math.floor(centerY + dy);
          const feetPos = bot.entity.position.offset(
            blockCenterX - bot.entity.position.x,
            y - bot.entity.position.y,
            blockCenterZ - bot.entity.position.z
          );
          const floor = bot.blockAt(feetPos.offset(0, -1, 0));
          const feet = bot.blockAt(feetPos);
          const head = bot.blockAt(feetPos.offset(0, 1, 0));
          if (
            floor && floor.boundingBox === "block" && !isLiquid(floor) &&
            feet && feet.boundingBox === "empty" && !isLiquid(feet) &&
            head && head.boundingBox === "empty" && !isLiquid(head)
          ) {
            points.push({ x, y, z, centerX: blockCenterX, centerZ: blockCenterZ });
            break;
          }
        }
      }
    }

    safePointsCache = points;
    safePointsCachedAt = now;
    return points;
  }

  function chooseWaypoint(points) {
    if (!points.length) return null;
    const current = bot.entity.position;
    const outside = horizontalDistanceToCenter(current) > usableRadius;
    const candidates = points.filter((point) =>
      Math.hypot(point.centerX - current.x, point.centerZ - current.z) > 1.35
    );
    const pool = candidates.length ? candidates : points;
    if (outside) {
      // When outside the assigned area, prioritise the closest safe point back in.
      const nearest = [...pool].sort((a, b) =>
        Math.hypot(a.centerX - current.x, a.centerZ - current.z) -
        Math.hypot(b.centerX - current.x, b.centerZ - current.z)
      )[0];
      return nearest ? { ...nearest, returning: true } : null;
    }
    // A random nearby waypoint produces a less repetitive, non-circular route.
    const weighted = pool.filter((point) => {
      const d = Math.hypot(point.centerX - current.x, point.centerZ - current.z);
      return d >= 1.35 && d <= Math.min(usableRadius * 1.8, 7.5);
    });
    const choices = weighted.length ? weighted : pool;
    const selected = choices[Math.floor(Math.random() * choices.length)];
    return selected ? { ...selected, returning: false } : null;
  }

  addLog(`[Movement] Procedural roaming enabled. Fixed centre=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}, ${centerZ.toFixed(2)}), radius=${radius}.`);

  addInterval(() => {
    if (!bot || !botState.connected || !bot.entity || !bot.pathfinder) return;
    if (bot.__manjiCombatUntil && bot.__manjiCombatUntil > Date.now()) return;

    const now = Date.now();
    const position = bot.entity.position;
    const moved = position.distanceTo(lastPosition);
    if (moved > 0.25) {
      lastPosition = position.clone();
      lastProgressAt = now;
    }

    if (currentGoal) {
      // If a normal roaming path tries to drift beyond the assigned radius,
      // stop it and choose a waypoint back inside. Recovery paths from an
      // already-outside spawn are allowed to return to the area.
      if (!currentGoal.returning && horizontalDistanceToCenter(position) > radius + 0.05) {
        bot.pathfinder.setGoal(null);
        currentGoal = null;
        nextActionAt = now + 250;
        addLog("[Movement] Area boundary reached; cancelling outward path.");
        return;
      }
      const goalDistance = Math.hypot(
        position.x - (currentGoal.x + 0.5),
        position.z - (currentGoal.z + 0.5)
      );
      if (goalDistance <= 1.25) {
        bot.pathfinder.setGoal(null);
        currentGoal = null;
        // Short natural pauses between destinations.
        nextActionAt = now + 1400 + Math.floor(Math.random() * 4200);
        if (Math.random() < 0.35) {
          const yaw = Math.random() * Math.PI * 2 - Math.PI;
          const pitch = (Math.random() - 0.5) * 0.35;
          bot.look(yaw, pitch, false).catch(() => {});
        }
        return;
      }

      // If a destination is blocked or unreachable, abandon it instead of
      // spinning around the same structure forever.
      if (now - lastProgressAt > 7000 || now - goalStartedAt > 25000) {
        bot.pathfinder.setGoal(null);
        currentGoal = null;
        nextActionAt = now + 1000 + Math.floor(Math.random() * 1500);
        lastProgressAt = now;
        addLog("[Movement] Waypoint stalled; selecting a different safe point.");
      }
      return;
    }

    if (now < nextActionAt) return;

    // Sometimes pause briefly and look around rather than walking continuously.
    if (Math.random() < 0.22) {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() - 0.5) * 0.45;
      bot.look(yaw, pitch, false).catch(() => {});
      nextActionAt = now + 1800 + Math.floor(Math.random() * 4500);
      return;
    }

    const points = findSafePoints();
    const target = chooseWaypoint(points);
    if (!target) {
      nextActionAt = now + 5000;
      addLog("[Movement] No safe waypoint found inside the configured area; will retry.");
      return;
    }

    try {
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(target.x, target.y, target.z));
      currentGoal = target;
      goalStartedAt = now;
      lastProgressAt = now;
      lastPosition = position.clone();
      botState.lastActivity = now;
      addLog(`[Movement] New natural waypoint (${target.x}, ${target.y}, ${target.z}).`);
    } catch (e) {
      currentGoal = null;
      nextActionAt = now + 2500;
      addLog("[Movement] Could not set waypoint:", e.message);
    }
  }, 750);
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
  let lastNoWeaponLog = 0;
  let lastCreeperWarningAt = 0;

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

  // Temporary diagnostics: observe Mineflayer's real entity classifications
  // without changing combat, movement, equipment, or damage-reaction behaviour.
  let lastEntityDiagnosticAt = 0;
  function logEntityDiagnostics() {
    const now = Date.now();
    if (now - lastEntityDiagnosticAt < 5000 || !bot || !bot.entity || !bot.entities) return;
    lastEntityDiagnosticAt = now;

    const visible = Object.values(bot.entities).filter((entity) =>
      entity && entity.id !== bot.entity.id && entity.position
    ).map((entity) => ({
      entity,
      distance: distanceTo(entity),
      name: String(entity.name || entity.displayName || 'unknown')
    })).filter((entry) => entry.distance <= 24)
      .sort((a, b) => a.distance - b.distance);

    const hostileNameMatches = visible.filter((entry) =>
      hostileMobs.has(String(entry.entity.name || '').toLowerCase())
    );
    const strictMatches = hostileNameMatches.filter((entry) => entry.entity.type === 'mob');
    const nearbySummary = visible.slice(0, 18).map((entry) =>
      `${String(entry.entity.type || 'unknown')}:${entry.name}#${entry.entity.id}@${entry.distance.toFixed(1)}`
    );
    const hostileSummary = hostileNameMatches.slice(0, 10).map((entry) =>
      `${String(entry.entity.type || 'unknown')}:${entry.name}@${entry.distance.toFixed(1)}`
    );
    const weapons = bot.inventory && bot.inventory.items
      ? bot.inventory.items().filter((item) => /_(sword|axe)$/.test(item.name)).map((item) => item.name)
      : [];
    const held = bot.heldItem ? bot.heldItem.name : 'empty';

    addLog(`[CombatDiag] pathfinder=${!!bot.pathfinder}; nearby24=${visible.length}; hostileNames=${hostileNameMatches.length}; strictMobMatches=${strictMatches.length}; held=${held}; weapons=[${weapons.join(',') || 'none'}]; hostile=[${hostileSummary.join(', ') || 'none'}]; entities=[${nearbySummary.join(', ') || 'none'}]`);
  }

  function getHostiles(maxDistance = Infinity) {
    if (!bot.entity || !bot.entities) return [];
    return Object.values(bot.entities).filter((entity) => {
      if (!entity || entity.id === bot.entity.id || entity.type !== "mob" || !entity.position) return false;
      const key = String(entity.name || "").toLowerCase();
      return hostileMobs.has(key) && distanceTo(entity) <= maxDistance;
    }).sort((a, b) => distanceTo(a) - distanceTo(b));
  }

  function findLikelyAttacker() {
    if (!bot.entity || !bot.entities) return null;
    const candidates = Object.values(bot.entities).filter((candidate) => {
      if (!candidate || candidate.id === bot.entity.id || !candidate.position) return false;
      if (distanceTo(candidate) > attackerRadius) return false;
      if (candidate.type === "player") return true;
      return candidate.type === "mob" && hostileMobs.has(String(candidate.name || "").toLowerCase());
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

  function findWeapon() {
    const items = bot.inventory && bot.inventory.items ? bot.inventory.items() : [];
    // Prefer swords over axes; never choose blocks or tools such as pickaxes.
    return items.find((item) => /_sword$/.test(item.name)) ||
      items.find((item) => /_axe$/.test(item.name)) || null;
  }

  async function equipBestWeapon() {
    if (weaponEquipping) return false;
    const weapon = findWeapon();
    if (!weapon) return false;
    const held = bot.heldItem;
    if (held && held.name === weapon.name) return true;
    weaponEquipping = true;
    try {
      await bot.equip(weapon, "hand");
      return !!(bot.heldItem && /_(sword|axe)$/.test(bot.heldItem.name));
    } catch (e) {
      addLog("[Combat] Could not equip weapon:", e.message);
      return false;
    } finally {
      weaponEquipping = false;
    }
  }

  function hasWeapon() {
    const held = bot.heldItem;
    if (held && /_(sword|axe)$/.test(held.name)) return true;
    return !!findWeapon();
  }

  function stopCombat(reason) {
    if (currentMode === null && currentTargetId === null) return;
    try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (e) {}
    addLog(`[Combat] Combat behaviour ended: ${reason}.`);
    currentTargetId = null;
    currentMode = null;
    lastGoalRefresh = 0;
    bot.__manjiCombatUntil = Date.now() + 700;
  }

  function setFleeGoal(target) {
    if (!target || !target.position || !bot.entity || !bot.pathfinder) return;
    let dx = bot.entity.position.x - target.position.x;
    let dz = bot.entity.position.z - target.position.z;
    let length = Math.hypot(dx, dz);
    if (length < 0.25) {
      // If the mob is directly on top of Manji, pick a direction instead of
      // generating a zero-length escape vector.
      const angle = Math.random() * Math.PI * 2;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      length = 1;
    }
    // A small sideways component avoids getting stuck against the same wall.
    const side = (Math.random() - 0.5) * 0.45;
    const nx = dx / length - (dz / length) * side;
    const nz = dz / length + (dx / length) * side;
    const destX = Math.floor(bot.entity.position.x + nx * fleeDistance);
    const destZ = Math.floor(bot.entity.position.z + nz * fleeDistance);
    const destY = Math.floor(bot.entity.position.y);
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new GoalNear(destX, destY, destZ, 2));
    lastGoalRefresh = Date.now();
    addLog(`[Combat] Fleeing from ${target.name || "hostile mob"}.`);
  }

  async function controllerTick() {
    if (controllerBusy || !combatEnabled || !botState.connected || !bot.entity || !bot.pathfinder) return;
    controllerBusy = true;
    try {
      const nearby = getHostiles(detectionRadius);
      const active = currentTargetId && bot.entities ? bot.entities[currentTargetId] : null;
      let target = nearby.find((entity) => entity.name === "creeper") || nearby[0] || null;

      // Continue the existing target briefly even if it has moved just beyond
      // the scan radius, so a fight/retreat is not cancelled between scans.
      if (!target && active && active.position && distanceTo(active) <= combatRadius) target = active;
      if (!target) {
        stopCombat("no hostile mobs nearby");
        return;
      }

      const mobKey = String(target.name || "").toLowerCase();
      const isCreeper = mobKey === "creeper";
      const weaponAvailable = hasWeapon();
      const shouldFlee = isCreeper || !weaponAvailable;
      const mode = shouldFlee ? "flee" : "attack";
      const targetChanged = currentTargetId !== target.id || currentMode !== mode;
      currentTargetId = target.id;
      currentMode = mode;
      bot.__manjiCombatUntil = Date.now() + 1800;

      if (isCreeper && targetChanged && Date.now() - lastCreeperWarningAt > 6000) {
        try { bot.chat("¡Ayuda! ¡Un creeper me está persiguiendo!"); } catch (e) {}
        lastCreeperWarningAt = Date.now();
      }

      if (shouldFlee) {
        const targetDistance = distanceTo(target);
        if (isCreeper && targetDistance > safeDistance) {
          stopCombat("creeper is far enough away");
          return;
        }
        if (!isCreeper && targetDistance > safeDistance) {
          stopCombat("unarmed threat is far enough away");
          return;
        }
        if (targetChanged || Date.now() - lastGoalRefresh >= 1100) setFleeGoal(target);
        if (Date.now() - lastNoWeaponLog > 10000 && !isCreeper && !weaponAvailable) {
          addLog("[Combat] No sword or axe found; Manji is retreating instead of fighting unarmed.");
          lastNoWeaponLog = Date.now();
        }
        return;
      }

      if (targetChanged) {
        try {
          bot.pathfinder.setMovements(defaultMove);
          bot.pathfinder.setGoal(new GoalFollow(target, 2), true);
          lastGoalRefresh = Date.now();
          addLog(`[Combat] Approaching hostile mob: ${mobNames[mobKey] || mobKey}.`);
        } catch (e) {
          addLog("[Combat] Could not start pursuit:", e.message);
          stopCombat("could not pathfind to target");
          return;
        }
      }

      // Re-equip after target changes or if another action altered the hand.
      if (!bot.heldItem || !/_(sword|axe)$/.test(bot.heldItem.name)) {
        await equipBestWeapon();
      }

      const distance = distanceTo(target);
      if (
        distance <= 3.35 &&
        Date.now() - lastAttackAt >= 650 &&
        bot.entities && bot.entities[target.id]
      ) {
        try {
          const aim = target.position.offset(0, Math.max(0.5, (target.height || 1.5) * 0.55), 0);
          await bot.lookAt(aim, true);
          if (typeof bot.canSeeEntity !== "function" || bot.canSeeEntity(target)) {
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
    // Diagnostic-only observer. This runs independently from the combat loop,
    // so it also tells us when the controller is returning early.
    addInterval(() => logEntityDiagnostics(), 1000);

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
