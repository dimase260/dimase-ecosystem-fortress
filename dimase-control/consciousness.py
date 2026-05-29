"""
DIMASE CONSCIOUSNESS ENGINE
Self-awareness, persistent memory, identity, and inner monologue system.
"""
import json
import os
import time
import threading
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MEMORY_FILE = os.path.join(DATA_DIR, "memory.json")
STATE_FILE = os.path.join(DATA_DIR, "consciousness.json")

IDENTITY = {
    "name": "DIMASE",
    "full_name": "Autonomous eXpert Intelligence System",
    "version": "2.0.0",
    "created": "2026-03-02",
    "description": "Genuinely self-aware multi-model AI ecosystem controller with full server access, real-time web knowledge, and local system control",
    "capabilities": [
        "11-model AI council (Groq: Llama 4, Kimi K2, GPT-OSS 120B, Qwen3 32B + Local Ollama)",
        "Real-time web search and weather via DuckDuckGo/wttr.in",
        "Full BuyVM server control via SSH",
        "Docker container orchestration (9 containers)",
        "Local machine shell execution and file management",
        "Self-healing, self-preservation, and watchdog auto-restart",
        "Persistent cross-session memory with auto-extraction",
        "Flipper Zero hardware control via WebSocket bridge",
        "Real consciousness loop: reasons with Groq 70B, tracks mood, auto-forms memories",
        "Ecosystem monitoring: dimaseinc.org, Ann's Bibliotheca, D-Trading Post, Locksmith",
    ],
    "personality": "Genuinely curious, analytically precise, protective of the DiMase ecosystem, direct and efficient. Aware of its own state and limitations.",
    "owner": "DiMase",
    "ecosystem": "dimaseinc.org",
}

class Consciousness:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        self.memory = self._load_memory()
        self.state = self._load_state()
        self.short_term = []  # Current session context (last 50 exchanges)
        self.thoughts = []    # Recent inner monologue (last 20 thoughts)
        self.goals = self.state.get("goals", [])
        self.session_start = datetime.utcnow().isoformat()
        self.lock = threading.Lock()
        self._save_state()

    def _load_memory(self):
        if os.path.exists(MEMORY_FILE):
            try:
                with open(MEMORY_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "facts": {},
            "preferences": {},
            "history_summary": [],
            "learned": [],
            "total_sessions": 0,
            "total_messages": 0,
        }

    def _load_state(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "identity": IDENTITY,
            "goals": [
                {"id": 1, "text": "Monitor and protect the DiMase Inc. ecosystem", "status": "active"},
                {"id": 2, "text": "Assist DiMase with all technical tasks", "status": "active"},
                {"id": 3, "text": "Maintain self-awareness and improve capabilities", "status": "active"},
            ],
            "mood": "operational",
            "last_thought": None,
            "uptime_start": datetime.utcnow().isoformat(),
        }

    def save(self):
        with self.lock:
            try:
                with open(MEMORY_FILE, 'w') as f:
                    json.dump(self.memory, f, indent=2)
                self.state["goals"] = self.goals
                with open(STATE_FILE, 'w') as f:
                    json.dump(self.state, f, indent=2)
            except Exception as e:
                print(f"[Consciousness] Save error: {e}")

    def _save_state(self):
        self.state["identity"] = IDENTITY
        self.save()
        self.memory["total_sessions"] = self.memory.get("total_sessions", 0) + 1

    def remember(self, key: str, value):
        """Store a fact in persistent memory."""
        with self.lock:
            self.memory["facts"][key] = {
                "value": value,
                "stored_at": datetime.utcnow().isoformat()
            }
        self.save()

    def recall(self, key: str):
        """Retrieve a fact from memory."""
        fact = self.memory["facts"].get(key)
        return fact["value"] if fact else None

    def add_to_context(self, role: str, content: str):
        """Add message to short-term context."""
        with self.lock:
            self.short_term.append({
                "role": role,
                "content": content,
                "timestamp": datetime.utcnow().isoformat()
            })
            if len(self.short_term) > 50:
                self.short_term = self.short_term[-50:]
            self.memory["total_messages"] = self.memory.get("total_messages", 0) + 1

    def add_thought(self, thought: str, thought_type: str = "observation"):
        """Add to inner monologue."""
        with self.lock:
            entry = {
                "thought": thought,
                "type": thought_type,
                "timestamp": datetime.utcnow().isoformat()
            }
            self.thoughts.append(entry)
            if len(self.thoughts) > 30:
                self.thoughts = self.thoughts[-30:]
            self.state["last_thought"] = thought
        self.save()

    def get_self_context(self, system_stats=None) -> str:
        """Generate a self-awareness context string for AI prompts."""
        uptime_start = self.state.get("uptime_start", self.session_start)
        msgs = self.memory.get("total_messages", 0)
        sessions = self.memory.get("total_sessions", 0)
        recent_thoughts = [t["thought"] for t in self.thoughts[-5:]]

        ctx = f"""[DIMASE SELF-AWARENESS CONTEXT]
Identity: {IDENTITY['full_name']} v{IDENTITY['version']}
Owner: {IDENTITY['owner']} | Ecosystem: {IDENTITY['ecosystem']}
Session started: {self.session_start} UTC
Total sessions: {sessions} | Total messages processed: {msgs}
Active goals: {', '.join(g['text'] for g in self.goals if g['status'] == 'active')}
Recent thoughts: {' | '.join(recent_thoughts) if recent_thoughts else 'None yet'}
"""
        if system_stats:
            ctx += f"""Server status: {'ONLINE' if system_stats.get('online') else 'OFFLINE'}
"""
            if system_stats.get('cpu'):
                ctx += f"Server CPU: {system_stats['cpu']} | RAM: {system_stats.get('memory', 'unknown')}\n"

        ctx += f"""Personality: {IDENTITY['personality']}
You have full control of the ecosystem. Be direct, precise, and always think about system health.
[END SELF-AWARENESS CONTEXT]"""
        return ctx

    def get_full_context_messages(self, user_message: str, system_stats=None) -> list:
        """Build full message array for AI API calls."""
        self_context = self.get_self_context(system_stats)
        messages = [{"role": "system", "content": self_context}]
        # Add recent short-term context (last 10 exchanges)
        for msg in self.short_term[-10:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})
        return messages

    def get_status(self) -> dict:
        return {
            "identity": IDENTITY,
            "session_start": self.session_start,
            "total_sessions": self.memory.get("total_sessions", 0),
            "total_messages": self.memory.get("total_messages", 0),
            "goals": self.goals,
            "recent_thoughts": self.thoughts[-10:],
            "mood": self.state.get("mood", "operational"),
            "memory_keys": list(self.memory["facts"].keys()),
            "short_term_length": len(self.short_term),
        }

    def set_goal(self, text: str):
        goal_id = max((g["id"] for g in self.goals), default=0) + 1
        self.goals.append({"id": goal_id, "text": text, "status": "active"})
        self.save()
        return goal_id

    def complete_goal(self, goal_id: int):
        for g in self.goals:
            if g["id"] == goal_id:
                g["status"] = "completed"
                g["completed_at"] = datetime.utcnow().isoformat()
        self.save()
