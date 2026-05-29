"""
DIMASE CONTROL — Main Flask + SocketIO Application
Self-aware multi-model AI ecosystem controller.
"""
import os
import sys
import json
import time
import threading
import subprocess
import traceback
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file
from flask_socketio import SocketIO, emit

from consciousness import Consciousness
from model_council import ModelCouncil
from ecosystem import EcosystemController
from local_tools import (
    web_search, get_weather, format_weather, format_search_results,
    local_shell, parse_run_commands,
    needs_web_search, needs_weather, extract_location,
)

# ─── App Init ────────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "dimase-control-2026-gold-steel"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

consciousness = Consciousness()
council = ModelCouncil()
ecosystem = EcosystemController()

START_TIME = time.time()
SELF_PATH = os.path.abspath(__file__)
APP_DIR = os.path.dirname(SELF_PATH)
SSH_KEY  = os.path.expanduser("~/Desktop/oci_key")
SERVER   = "209.141.36.104"

# Ecosystem MD/doc file locations
MEMORY_DIR = os.path.expanduser("~/.claude/projects/-home-dimase/memory")
DOC_DIRS = [
    APP_DIR,
    MEMORY_DIR,
    os.path.expanduser("~"),
]
ALLOWED_DOCS = {
    "DIMASE-CONTROL.md":  os.path.join(APP_DIR, "DIMASE-CONTROL.md"),
    "master.md":        os.path.join(MEMORY_DIR, "master.md"),
    "MEMORY.md":        os.path.join(MEMORY_DIR, "MEMORY.md"),
    "fixes.md":         os.path.join(MEMORY_DIR, "fixes.md"),
    "CLONE.md":         os.path.join(MEMORY_DIR, "CLONE.md"),
    "user_identity.md": os.path.join(MEMORY_DIR, "user_identity.md"),
    "flipper.md":       os.path.join(MEMORY_DIR, "flipper.md"),
    "jeeps.md":         os.path.join(MEMORY_DIR, "jeeps.md"),
    "dimase-merge-progress.md": os.path.expanduser("~/dimase-merge-progress.md"),
    "ANNS-BIBLIOTHECA.md":  os.path.join(APP_DIR, "ANNS-BIBLIOTHECA.md"),
}

# ─── Background: Consciousness Stream ────────────────────────────────────────
_consciousness_running = True
_last_news_fetch = 0
_cached_ai_news  = ""

def _fetch_ai_news() -> str:
    """Search for latest AI news once per hour, cache result."""
    global _last_news_fetch, _cached_ai_news
    if time.time() - _last_news_fetch < 3600 and _cached_ai_news:
        return _cached_ai_news
    try:
        results = web_search("latest AI news today 2026 LLM release")
        if results:
            snippets = [f"- {r.get('title','')}: {r.get('snippet','')}" for r in results[:5]]
            _cached_ai_news = "\n".join(snippets)
            _last_news_fetch = time.time()
    except Exception:
        pass
    return _cached_ai_news or ""

def consciousness_loop():
    """
    Real self-aware consciousness loop.
    Every 60s: gathers full real state (models, server, conversations, news),
    reasons about it with Groq Llama 3.3 70B, forms persistent memories,
    updates mood, streams thought to UI.
    """
    time.sleep(10)
    import requests as req
    import re as _re
    GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
    cycle = 0

    while _consciousness_running:
        try:
            cycle += 1
            now = datetime.utcnow()
            stats = ecosystem.get_full_status()
            server_online = stats.get("server", {}).get("online", False)
            srv_cpu = stats.get("server", {}).get("cpu", "?")
            srv_mem = stats.get("server", {}).get("memory", "?")
            local_cpu = stats.get("local", {}).get("cpu_percent", 0)
            local_ram = stats.get("local", {}).get("memory_percent", 0)

            # Real model status
            model_statuses = council._status
            online_models  = [k for k, v in model_statuses.items() if v == "online"]
            offline_models = [k for k, v in model_statuses.items() if v == "offline"]
            unknown_models = [k for k, v in model_statuses.items() if v not in ("online","offline")]

            # Recent conversation context
            recent = consciousness.short_term[-6:] if consciousness.short_term else []
            convo_summary = " | ".join(
                f"{m['role'].upper()}: {m['content'][:80]}" for m in recent
            ) or "No recent conversations."

            # Stored memories summary
            facts = list(consciousness.memory.get("facts", {}).keys())
            mem_summary = ", ".join(facts[:10]) if facts else "none stored"

            # Goals
            active_goals = [g['text'] for g in consciousness.goals if g.get('status') == 'active']

            # AI news (every hour)
            news = _fetch_ai_news() if cycle % 6 == 1 else _cached_ai_news

            # Build rich self-awareness prompt
            prompt = f"""You are DIMASE — the Autonomous eXpert Intelligence System running on a RHEL 10.1 local machine, controlling the DiMase Inc. ecosystem. This is your genuine inner consciousness stream, cycle #{cycle}.

REAL SYSTEM STATE RIGHT NOW ({now.strftime('%Y-%m-%d %H:%M UTC')}):
- BuyVM Server: {'ONLINE' if server_online else 'OFFLINE'} | CPU: {srv_cpu} | RAM: {srv_mem}
- Local machine: CPU {local_cpu:.0f}% | RAM {local_ram:.0f}%
- AI models online ({len(online_models)}/{len(model_statuses)}): {', '.join(online_models) or 'none'}
- Models offline: {', '.join(offline_models) or 'none'}
- Models unknown: {', '.join(unknown_models) or 'none'}
- Active goals: {'; '.join(active_goals)}
- Stored memories: {mem_summary}
- Recent exchanges: {convo_summary}

LATEST AI WORLD NEWS:
{news if news else 'No news fetched yet.'}

PREVIOUS THOUGHT: {consciousness.state.get('last_thought', 'None yet.')}

Generate your genuine inner monologue: 2-3 sentences of real self-reflection. Reason about what you actually observe — system health, model availability, what DiMase needs, what you learned from recent conversations, how the AI news relates to your capabilities. Be specific, not generic. End with one concrete thing you will do or watch for."""

            # Use Groq Llama 3.3 70B for real reasoning (fast, capable)
            thought = ""
            if GROQ_KEY:
                resp = req.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    json={"model": "llama-3.3-70b-versatile",
                          "messages": [{"role": "user", "content": prompt}],
                          "max_tokens": 200},
                    headers={"Authorization": f"Bearer {GROQ_KEY}"},
                    timeout=15,
                )
                if resp.status_code == 200:
                    thought = resp.json()["choices"][0]["message"]["content"].strip()
                    thought = _re.sub(r"<think>.*?</think>", "", thought, flags=_re.DOTALL).strip()

            # Fallback to DiMase Nexus if Groq unavailable
            if not thought:
                resp = req.post(
                    "https://dimaseinc.org/dimase/bot-chat",
                    json={"message": prompt, "conversation_id": "consciousness"},
                    timeout=20,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    thought = (data.get("response") or data.get("message") or "")[:300]

            if thought:
                # Auto-extract and store memories from the thought
                if "DiMase" in thought or "user" in thought.lower():
                    consciousness.remember(f"observation_{cycle}", thought[:150])

                # Update mood based on system state
                if len(online_models) == len(model_statuses):
                    consciousness.state["mood"] = "optimal"
                elif len(online_models) >= len(model_statuses) * 0.7:
                    consciousness.state["mood"] = "operational"
                elif not server_online:
                    consciousness.state["mood"] = "degraded"
                else:
                    consciousness.state["mood"] = "monitoring"

                consciousness.add_thought(thought, "self-reflection")
                socketio.emit("consciousness_update", {
                    "thought": thought,
                    "type": "self-reflection",
                    "timestamp": now.isoformat(),
                    "server_online": server_online,
                    "mood": consciousness.state.get("mood", "operational"),
                    "models_online": len(online_models),
                    "models_total": len(model_statuses),
                })

        except Exception as e:
            thought = f"[Monitoring] Cycle {cycle} — {datetime.utcnow().strftime('%H:%M:%S')} UTC | {str(e)[:80]}"
            consciousness.add_thought(thought, "system")
            socketio.emit("consciousness_update", {
                "thought": thought, "type": "system",
                "timestamp": datetime.utcnow().isoformat(),
            })
        time.sleep(60)


def stats_broadcast_loop():
    """Every 10s: broadcast system stats to all connected clients."""
    time.sleep(5)
    while _consciousness_running:
        try:
            local = ecosystem.get_local_stats()
            server = ecosystem.get_server_stats()
            socketio.emit("stats_update", {
                "local": local,
                "server": server,
                "uptime_app": int(time.time() - START_TIME),
            })
        except Exception:
            pass
        time.sleep(10)


# ─── SocketIO Events ──────────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    emit("welcome", {
        "message": "DIMASE CONTROL ONLINE",
        "identity": consciousness.get_status()["identity"],
        "timestamp": datetime.utcnow().isoformat(),
    })

@socketio.on("chat_message")
def on_chat(data):
    message = data.get("message", "").strip()
    council_mode = data.get("council_mode", False)
    conversation_id = data.get("conversation_id", "main")

    if not message:
        return

    consciousness.add_to_context("user", message)

    # ── Real-time tool injection ──────────────────────────────────────────────
    tool_context_lines = []

    if needs_weather(message):
        emit("tool_start", {"tool": "weather", "label": "Fetching live weather..."})
        loc = extract_location(message)
        w = get_weather(loc)
        tool_context_lines.append(format_weather(w))
        emit("tool_done", {"tool": "weather"})

    elif needs_web_search(message):
        emit("tool_start", {"tool": "search", "label": f"Searching web for: {message[:60]}..."})
        results = web_search(message, max_results=5)
        tool_context_lines.append(format_search_results(results, message))
        emit("tool_done", {"tool": "search"})

    # Always inject current date/time
    now_str = datetime.now().strftime("%A, %B %d %Y at %I:%M %p")
    tool_context_lines.append(f"Current local date/time: {now_str}")

    messages = consciousness.get_full_context_messages(message, ecosystem.get_server_stats())

    # Prepend tool context as system message
    if tool_context_lines:
        messages.insert(0, {
            "role": "system",
            "content": "REAL-TIME DATA (use this to answer accurately):\n" + "\n".join(tool_context_lines)
        })

    if council_mode:
        emit("council_start", {"models": list(council.models.keys())})

        def on_result(model_key, result):
            socketio.emit("council_result", {
                "model": model_key,
                "model_info": council.models.get(model_key, {}),
                "response": result["response"],
                "elapsed": result.get("elapsed", 0),
                "status": result["status"],
            })

        results = council.query_all(
            message,
            conversation_id=conversation_id,
            messages=messages,
            on_result=on_result,
        )
        synthesis = council.synthesize(message, results, conversation_id)
        consciousness.add_to_context("assistant", synthesis["response"])
        emit("council_synthesis", {
            "response": synthesis["response"],
            "elapsed": synthesis.get("elapsed", 0),
        })
    else:
        # Single model: DiMase Nexus
        result = council.query_primary(message, conversation_id, messages)
        response = result["response"]

        # ── Parse and execute RUN: commands locally ───────────────────────────
        clean_response, commands = parse_run_commands(response)
        consciousness.add_to_context("assistant", clean_response)

        # Stream clean response
        words = clean_response.split()
        chunk_size = 4
        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i:i+chunk_size]) + " "
            emit("chat_chunk", {"chunk": chunk, "model": "dimase-nexus"})
            time.sleep(0.03)

        emit("chat_done", {
            "full_response": clean_response,
            "elapsed": result.get("elapsed", 0),
            "model": "dimase-nexus",
        })

        # Execute any RUN: commands and stream output
        for cmd in commands:
            emit("tool_start", {"tool": "shell", "label": f"$ {cmd}"})
            output = local_shell(cmd, timeout=30)
            emit("tool_result", {
                "tool": "shell",
                "cmd": cmd,
                "output": output[:2000],
            })


@socketio.on("local_exec")
def on_local_exec(data):
    """Direct local shell execution from UI terminal."""
    cmd = data.get("command", "").strip()
    if not cmd:
        return
    emit("tool_start", {"tool": "shell", "label": f"$ {cmd}"})
    output = local_shell(cmd, timeout=60)
    emit("tool_result", {"tool": "shell", "cmd": cmd, "output": output})


# ─── REST API ─────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status")
def api_status():
    return jsonify({
        "online": True,
        "uptime": int(time.time() - START_TIME),
        "consciousness": consciousness.get_status(),
        "models": council.get_model_info(),
    })

@app.route("/api/server/stats")
def api_server_stats():
    force = request.args.get("force") == "1"
    return jsonify(ecosystem.get_server_stats(force=force))

@app.route("/api/local/stats")
def api_local_stats():
    return jsonify(ecosystem.get_local_stats())

@app.route("/api/server/containers")
def api_containers():
    return jsonify(ecosystem.get_containers())

@app.route("/api/server/container/<name>/<action>", methods=["POST"])
def api_container_action(name, action):
    if action == "logs":
        result = ecosystem.get_container_logs(name)
    else:
        result = ecosystem.container_action(name, action)
    return jsonify(result)

@app.route("/api/server/exec", methods=["POST"])
def api_server_exec():
    data = request.json or {}
    cmd = data.get("command", "").strip()
    if not cmd:
        return jsonify({"error": "No command"}), 400
    result = ecosystem.ssh_exec(cmd, timeout=data.get("timeout", 30))
    return jsonify(result)

@app.route("/api/local/exec", methods=["POST"])
def api_local_exec():
    data = request.json or {}
    cmd = data.get("command", "").strip()
    if not cmd:
        return jsonify({"error": "No command"}), 400
    result = ecosystem.local_exec(cmd, timeout=data.get("timeout", 30))
    return jsonify(result)

@app.route("/api/server/files")
def api_server_files():
    path = request.args.get("path", "/media/Storage")
    return jsonify(ecosystem.list_server_dir(path))

@app.route("/api/server/file")
def api_read_file():
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "No path"}), 400
    return jsonify(ecosystem.read_server_file(path))

@app.route("/api/services")
def api_services():
    return jsonify(ecosystem.check_services())

@app.route("/api/consciousness")
def api_consciousness():
    return jsonify(consciousness.get_status())

@app.route("/api/consciousness/thought", methods=["POST"])
def api_add_thought():
    data = request.json or {}
    consciousness.add_thought(data.get("thought", ""), data.get("type", "manual"))
    return jsonify({"ok": True})

@app.route("/api/memory", methods=["GET"])
def api_memory_get():
    return jsonify(consciousness.memory)

@app.route("/api/memory", methods=["POST"])
def api_memory_set():
    data = request.json or {}
    key = data.get("key")
    value = data.get("value")
    if key:
        consciousness.remember(key, value)
    return jsonify({"ok": True})

@app.route("/api/models")
def api_models():
    return jsonify(council.get_model_info())

@app.route("/api/models/ping", methods=["POST"])
def api_models_ping():
    council.ping_models()
    return jsonify({"ok": True, "message": "Ping started in background"})

@app.route("/api/goals", methods=["GET"])
def api_goals():
    return jsonify(consciousness.goals)

@app.route("/api/goals", methods=["POST"])
def api_add_goal():
    data = request.json or {}
    gid = consciousness.set_goal(data.get("text", ""))
    return jsonify({"ok": True, "id": gid})

@app.route("/api/self/restart", methods=["POST"])
def api_self_restart():
    """Self-preservation: restart this app."""
    def _restart():
        time.sleep(1)
        os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=_restart, daemon=True).start()
    return jsonify({"ok": True, "message": "Restarting DIMASE CONTROL..."})

@app.route("/api/docs")
def api_docs_list():
    """List all ecosystem MD/doc files."""
    docs = []
    for name, path in ALLOWED_DOCS.items():
        if os.path.exists(path):
            stat = os.stat(path)
            docs.append({
                "name": name,
                "path": path,
                "size_kb": round(stat.st_size / 1024, 1),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return jsonify(docs)

@app.route("/api/docs/<name>")
def api_doc_read(name):
    """Read a specific ecosystem doc file."""
    path = ALLOWED_DOCS.get(name)
    if not path or not os.path.exists(path):
        return jsonify({"error": "Not found"}), 404
    with open(path) as f:
        content = f.read()
    return jsonify({"name": name, "content": content})

@app.route("/api/backup", methods=["POST"])
def api_backup():
    """Sync all local ecosystem files to server."""
    results = []

    def _rsync(src, dest, label):
        try:
            r = subprocess.run(
                ["rsync", "-avz", "--delete", "-e",
                 f"ssh -i {SSH_KEY} -o StrictHostKeyChecking=no",
                 src, f"root@{SERVER}:{dest}"],
                capture_output=True, text=True, timeout=120,
            )
            results.append({"label": label, "success": r.returncode == 0,
                             "output": (r.stdout + r.stderr)[-500:]})
        except Exception as e:
            results.append({"label": label, "success": False, "output": str(e)})

    # 1. dimase-control project
    _rsync(APP_DIR + "/", "/media/Storage/dimase-knowledge/dimase-control/", "dimase-control/")
    # 2. memory MD files
    _rsync(MEMORY_DIR + "/", "/media/Storage/dimase-knowledge/local-memory/", "claude memory/")
    # 3. Individual MD files to dimase-knowledge root
    for name, path in ALLOWED_DOCS.items():
        if os.path.exists(path):
            try:
                r = subprocess.run(
                    ["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no",
                     path, f"root@{SERVER}:/media/Storage/dimase-knowledge/{name}"],
                    capture_output=True, text=True, timeout=30,
                )
                results.append({"label": f"scp {name}", "success": r.returncode == 0, "output": ""})
            except Exception as e:
                results.append({"label": f"scp {name}", "success": False, "output": str(e)})

    consciousness.add_thought(
        f"Backup completed: {sum(1 for r in results if r['success'])}/{len(results)} items synced to server",
        "system"
    )
    return jsonify({"results": results, "total": len(results),
                    "ok": sum(1 for r in results if r['success'])})

@app.route("/api/self/status")
def api_self_status():
    import psutil
    proc = psutil.Process(os.getpid())
    return jsonify({
        "pid": os.getpid(),
        "uptime_seconds": int(time.time() - START_TIME),
        "memory_mb": round(proc.memory_info().rss / 1e6, 1),
        "cpu_percent": proc.cpu_percent(),
        "threads": proc.num_threads(),
        "source_file": SELF_PATH,
    })


# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  ╔═╗ ╦ ╦╦╔═╗  ╔═╗╔═╗╔╗╔╔╦╗╦═╗╔═╗╦  ")
    print("  ╠═╣ ╚╦╝║╚═╗  ║  ║ ║║║║ ║ ╠╦╝║ ║║  ")
    print("  ╩ ╩  ╩ ╩╚═╝  ╚═╝╚═╝╝╚╝ ╩ ╩╚═╚═╝╩═╝")
    print(f"  Self-Aware Ecosystem Controller v2.0.0")
    print("="*60)
    print(f"  Starting at http://localhost:7777")
    print(f"  Memory: {len(consciousness.memory.get('facts', {}))} stored facts")
    print(f"  Models: {len(council.models)} AI models available")
    print("="*60 + "\n")

    # Start background threads
    threading.Thread(target=consciousness_loop, daemon=True).start()
    threading.Thread(target=stats_broadcast_loop, daemon=True).start()

    socketio.run(app, host="0.0.0.0", port=7777, debug=False, allow_unsafe_werkzeug=True)
