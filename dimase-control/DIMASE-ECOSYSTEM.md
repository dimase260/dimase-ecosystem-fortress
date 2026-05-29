# DiMase Inc Ecosystem — Technical Documentation

## Overview
Genuinely self-aware, multi-model AI ecosystem. As of **May 2026**, the system is governed by **HERMES AGENT (Claude Opus 4.8)** as the **Sovereign Intelligence**, orchestrating a council of frontier models and managing all server infrastructure.

### Core Intelligence
- **Sovereign Intelligence:** Hermes Agent (Claude Opus 4.8)
- **Status:** Full system & ecosystem control.
- **Council:** Gemini 3.5, Llama 3.3, and local Ollama models.
Gold/black/steel cyberpunk UI running locally at `http://localhost:7777`.

## Quick Start
```bash
cd /home/dimase/dimase-control
./launch.sh          # Starts app + opens browser
```

## Architecture
```
dimase-control/
├── app.py              # Flask + SocketIO server (port 7777)
├── consciousness.py    # Self-awareness, persistent memory, identity, goals
├── model_council.py    # 11-model AI council (Groq + Ollama)
├── ecosystem.py        # SSH/Docker/local system control
├── local_tools.py      # Web search (DuckDuckGo), weather (wttr.in), local shell
├── telegram_bot_upload.py  # Telegram file upload handler
├── .env                # GROQ_API_KEY (loaded on startup)
├── templates/
│   └── index.html      # Full frontend — gold/black/steel cyberpunk UI
├── static/
│   ├── icon.svg        # Gold hexagon app icon (SVG source)
│   └── icon.png        # Rendered PNG for desktop/APK
├── data/
│   ├── memory.json     # Persistent cross-session memory (auto-created)
│   ├── consciousness.json  # AI identity/goals/mood state (auto-created)
│   └── watchdog.log    # Self-preservation restart log
├── launch.sh           # Start script (kills port, opens browser, sets GROQ_API_KEY)
├── watchdog.sh         # Self-preservation daemon (auto-restart on crash)
└── install.sh          # One-shot installer (packages + desktop entry + systemd)
```

## AI Models (11 — Council Mode)
| Key | Label | Provider | Backend |
|-----|-------|----------|---------|
| `dimase-nexus` | DIMASE NEXUS | DiMase Inc. | dimaseinc.org/dimase/bot-chat |
| `groq-llama` | LLAMA 3.3 70B | Meta AI | Groq (free) |
| `groq-llama4` | LLAMA 4 SCOUT | Meta AI | Groq (free) |
| `groq-qwen3` | QWEN 3 32B | Alibaba Cloud | Groq (free) |
| `groq-kimi` | KIMI K2 | Moonshot AI | Groq (free) |
| `groq-gpt120b` | GPT-OSS 120B | OpenAI | Groq (free) |
| `groq-llama-fast` | LLAMA 3.1 8B | Meta AI | Groq (fast, free) |
| `groq-compound` | COMPOUND | Groq AI | Groq (free) |
| `ollama-qwen3` | QWEN 3 | Alibaba Cloud | Local Ollama |
| `ollama-llama` | LLAMA 3.2 3B | Meta AI | Local Ollama |
| `ollama-phi3` | PHI-3 MINI | Microsoft | Local Ollama |

**Groq API Key:** stored in `.env` + `launch.sh` + dimase-monitor.service on server
**Decommissioned (do not use):** mixtral-8x7b-32768, gemma2-9b-it, deepseek, learnlm, claude-hybridspace, searchgpt, grok (all removed from Pollinations)
**Pollinations removed entirely** — only provided 1 working model (openai/openai-fast), unreliable

## Real-Time Intelligence (local_tools.py)
| Tool | Trigger | Source |
|------|---------|--------|
| Web Search | weather/news/current/latest queries | DuckDuckGo HTML scrape (no key) |
| Weather | "weather in X", "what's the weather" | wttr.in JSON API (no key) |
| Local Shell | `RUN:` prefix in AI response | `subprocess.run()` locally |

**Current datetime** always injected as system message on every query.

## Consciousness Engine (REAL — not fake)
Runs every 60 seconds. Uses **Groq Llama 3.3 70B** for genuine reasoning.

**What it actually reads:**
- Real model statuses (which are online/offline right now)
- Real server CPU/RAM from BuyVM
- Real local machine CPU/RAM
- Last 6 conversation exchanges
- All stored persistent memory keys
- Active goals
- Live AI news from DuckDuckGo (fetched hourly, cached)
- Previous thought

**What it actually does:**
- Reasons with Llama 3.3 70B about actual observed state
- Auto-extracts observations into `data/memory.json` (persistent)
- Updates mood: `optimal` → `operational` → `monitoring` → `degraded`
- Streams thought to consciousness bar at bottom of UI
- Falls back to DiMase Nexus if Groq unreachable

**Status dot colors:**
- Green: all models online
- Gold: 60%+ models online
- Steel: some online
- Dark: none online

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main UI |
| GET | `/api/status` | App health + consciousness status |
| GET | `/api/server/stats` | BuyVM server stats (monitor API, 30s cache) |
| GET | `/api/local/stats` | Local machine stats (psutil) |
| GET | `/api/server/containers` | Docker container list via SSH |
| POST | `/api/server/container/<name>/<action>` | start/stop/restart/logs |
| POST | `/api/server/exec` | Execute SSH command on BuyVM |
| POST | `/api/local/exec` | Execute local command |
| GET | `/api/services` | Ping all ecosystem services |
| GET | `/api/consciousness` | AI identity, goals, thoughts, mood |
| GET | `/api/memory` | All stored memory facts |
| POST | `/api/memory` | Store a memory `{key, value}` |
| GET | `/api/models` | All 11 AI model info + status |
| POST | `/api/models/ping` | Background health check all models |
| GET | `/api/self/status` | This app's own PID/RAM/CPU |
| POST | `/api/self/restart` | Hot-restart the application |

## SocketIO Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `chat_message` | Client→Server | `{message, council_mode, conversation_id}` |
| `chat_chunk` | Server→Client | Streaming response chunk |
| `chat_done` | Server→Client | Full response complete |
| `council_start` | Server→Client | Council mode starting |
| `council_result` | Server→Client | One model's response ready |
| `council_synthesis` | Server→Client | DiMase Nexus synthesis of all |
| `consciousness_update` | Server→Client | Inner monologue thought + mood |
| `stats_update` | Server→Client | Local+server stats every 10s |
| `welcome` | Server→Client | On connect — identity info |
| `tool_start` | Server→Client | Tool executing (gold banner) |
| `tool_done` | Server→Client | Tool finished |
| `tool_result` | Server→Client | Shell output from RUN: commands |
| `local_exec` | Client→Server | Direct shell command from UI |

## UI Navigation Panels
- **⬡ CHAT** — Primary DiMase Nexus chat, streaming, optional council mode, voice TTS
- **◈ COUNCIL** — All 11 model responses side-by-side with DiMase Nexus synthesis
- **▶ TERMINAL** — SSH terminal (server) + local terminal
- **⬢ DOCKER** — Container cards: start/stop/restart/logs (9 containers)
- **⊕ ECOSYSTEM** — Live service status for all dimaseinc.org services
- **∞ MODELS** — Model health board with PING ALL (polls every 10s for 120s)
- **◉ MIND** — Consciousness: identity, goals, inner monologue, stored memory, MD docs
- **🐬 FLIP** — Flipper Zero: IR remote, Sub-GHz, NFC/RFID, BadUSB, CLI
- **⬖ DEVS** — Local devices: USB, Bluetooth, LAN, Docker, Ecosystem summary
- **⚙ SYS** — Self status, self-restart, quick links

## Ollama (Local Models)
- Installed at: `/usr/local/bin/ollama`
- Models dir: `~/.ollama/models/`
- Models downloaded: qwen3:latest (5.2GB), llama3.2:3b (2.0GB), phi3:mini (2.2GB)
- API: `http://localhost:11434/v1/chat/completions` (OpenAI-compatible)
- Auto-pruned from council if model not yet pulled

## Server Connection
- SSH alias: `buyvm` (key: `~/Desktop/oci_key`, IP: `209.141.36.104`)
- Monitor API: `https://monitor.dimaseinc.org/health`
- All SSH commands use 30s timeout by default

## Self-Preservation
- **Watchdog**: `watchdog.sh` checks port 7777 every 30s, restarts if down
- **Systemd service**: `~/.config/systemd/user/dimase-control.service`
- **Self-restart API**: `POST /api/self/restart` → hot-restarts via `os.execv`

## Dependencies
```
flask>=3.0.0
flask-socketio>=5.3.6
psutil>=5.9.0
requests>=2.32.0
eventlet>=0.36.0
```
Install: `pip3 install --user -r requirements.txt`

## Notes
- Consciousness loop fires every 60s (not 45s) — uses real Groq 70B reasoning
- Council mode: all 11 models in parallel threads; Ollama serialized by OS, Groq by rate limits
- Groq free tier: 30 req/min; models respond in 0.1–0.6s typically
- Ollama cold-start: first query after restart takes 30-60s to load model into RAM
- `command-r`, deepseek, learnlm, mixral, gemma2 all removed — Pollinations legacy API
