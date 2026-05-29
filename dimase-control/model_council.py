"""
DIMASE MODEL COUNCIL
Multi-model AI orchestration.
Providers:
  - DiMase Nexus  : dimaseinc.org/dimase/bot-chat (primary agent)
  - Groq        : api.groq.com — free tier, fast inference, multiple real models
  - Ollama      : localhost:11434 — local models (no internet needed)
  - Pollinations: text.pollinations.ai — only "openai" alias still works (legacy)
"""
import os
import requests
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load .env file if present
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

DIMASE_ENDPOINT   = "https://dimaseinc.org/dimase/bot-chat"
DIMASE_BOT_SECRET = "dimase-bot-2026"
GROQ_API_KEY    = os.environ.get("GROQ_API_KEY", "")
GROQ_EP         = "https://api.groq.com/openai/v1/chat/completions"
OLLAMA_EP       = "http://localhost:11434/v1/chat/completions"

MODELS = {
    "hermes-agent": {
        "label": "HERMES (NEMOTRON)",
        "subtitle": "DiMase Inc Ecosystem — Sovereign Intelligence",
        "color": "#FFD700",
        "icon": "⚕",
        "provider": "Nvidia",
        "backend": "hermes",
        "model_slug": "nvidia/nemotron-3-super-120b-a12b:free",
        "priority": 0,
    },
    "dimase-nexus": {
        "label": "DIMASE INC NEXUS",
        "subtitle": "Legacy Ecosystem Agent — Cloudflare Worker",
        "color": "#C0C0C0",
        "icon": "⬡",
        "provider": "DiMase Inc.",
        "backend": "dimase",
        "priority": 1,
    },
    "google-gemini-3.5": {
        "label": "GEMINI 3.5 FLASH",
        "subtitle": "Google — Pro Reasoning (2026-05-19)",
        "color": "#4285F4",
        "icon": "♊",
        "provider": "Google",
        "backend": "hermes",
        "model_slug": "google/gemini-3.5-flash",
        "priority": 0.5,
    },
    "qwen3-coder": {
        "label": "QWEN 3 CODER",
        "subtitle": "Ecosystem Specialist (2026-05-15)",
        "color": "#10B981",
        "icon": "⌨",
        "provider": "Alibaba",
        "backend": "hermes",
        "model_slug": "qwen/qwen3-coder:free",
        "priority": 0.6,
    },
    "groq-llama": {
        "label": "LLAMA 3.3 70B",
        "subtitle": "Meta — via Groq (Free)",
        "color": "#4A90D9",
        "icon": "◉",
        "provider": "Meta AI",
        "backend": "groq",
        "groq_model": "llama-3.3-70b-versatile",
        "priority": 1,
    },
    "groq-llama4": {
        "label": "LLAMA 4 SCOUT",
        "subtitle": "Meta — via Groq (Free)",
        "color": "#FF6B35",
        "icon": "◆",
        "provider": "Meta AI",
        "backend": "groq",
        "groq_model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "priority": 2,
    },
    "groq-qwen3": {
        "label": "QWEN 3 32B",
        "subtitle": "Alibaba — via Groq (Free)",
        "color": "#8B5CF6",
        "icon": "◇",
        "provider": "Alibaba Cloud",
        "backend": "groq",
        "groq_model": "qwen/qwen3-32b",
        "priority": 3,
    },
    "groq-kimi": {
        "label": "KIMI K2",
        "subtitle": "Moonshot AI — via Groq (Free)",
        "color": "#EC4899",
        "icon": "◌",
        "provider": "Moonshot AI",
        "backend": "groq",
        "groq_model": "moonshotai/kimi-k2-instruct",
        "priority": 4,
    },
    "groq-gpt120b": {
        "label": "GPT-OSS 120B",
        "subtitle": "OpenAI — via Groq (Free)",
        "color": "#C0C0C0",
        "icon": "▸",
        "provider": "OpenAI",
        "backend": "groq",
        "groq_model": "openai/gpt-oss-120b",
        "priority": 5,
    },
    "groq-llama-fast": {
        "label": "LLAMA 3.1 8B",
        "subtitle": "Meta — via Groq (Fast)",
        "color": "#06B6D4",
        "icon": "◈",
        "provider": "Meta AI",
        "backend": "groq",
        "groq_model": "llama-3.1-8b-instant",
        "priority": 6,
    },
    "ollama-qwen3": {
        "label": "QWEN 3",
        "subtitle": "Alibaba — Local Ollama",
        "color": "#FF4500",
        "icon": "⊕",
        "provider": "Alibaba Cloud",
        "backend": "ollama",
        "ollama_model": "qwen3:latest",
        "priority": 7,
    },
    "ollama-coder": {
        "label": "QWEN 2.5 CODER",
        "subtitle": "Free Claude Alternative — Local",
        "color": "#10B981",
        "icon": "⌨",
        "provider": "Alibaba Cloud",
        "backend": "ollama",
        "ollama_model": "qwen2.5-coder:1.5b",
        "priority": 0.5,
    },
    "ollama-llama": {
        "label": "LLAMA 3.2 3B",
        "subtitle": "Meta — Local Ollama",
        "color": "#2563EB",
        "icon": "◐",
        "provider": "Meta AI",
        "backend": "ollama",
        "ollama_model": "llama3.2:3b",
        "priority": 8,
    },
    "ollama-phi3": {
        "label": "PHI-3 MINI",
        "subtitle": "Microsoft — Local Ollama",
        "color": "#00BCF2",
        "icon": "Φ",
        "provider": "Microsoft",
        "backend": "ollama",
        "ollama_model": "phi3:mini",
        "priority": 9,
    },
    "groq-compound": {
        "label": "COMPOUND",
        "subtitle": "Groq AI — Compound Model",
        "color": "#F59E0B",
        "icon": "⬢",
        "provider": "Groq AI",
        "backend": "groq",
        "groq_model": "groq/compound",
        "priority": 8,
    },
}

# ─── Provider call functions ──────────────────────────────────────────────────

def _call_hermes(model_key: str, model_slug: str, message: str, messages: list = None) -> dict:
    start = time.time()
    if not OPENROUTER_API_KEY:
        return {"model": model_key, "response": "[HERMES] No OpenRouter API key",
                "elapsed": 0, "status": "error"}
    try:
        payload = {
            "model": model_slug,
            "messages": messages if messages else [{"role": "user", "content": message}],
        }
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            timeout=45,
        )
        if resp.status_code == 200:
            text = resp.json()["choices"][0]["message"]["content"].strip()
            return {"model": "hermes-agent", "response": text, "elapsed": round(time.time() - start, 2),
                    "status": "success", "tokens": len(text.split())}
        return {"model": "hermes-agent", "response": f"[HTTP {resp.status_code}] {resp.text[:200]}",
                "elapsed": round(time.time() - start, 2), "status": "error"}
    except Exception as e:
        return {"model": "hermes-agent", "response": f"[HERMES ERROR] {e}",
                "elapsed": round(time.time() - start, 2), "status": "error"}

def _call_dimase(message: str, conversation_id: str = None, messages: list = None) -> dict:
    start = time.time()
    try:
        payload = {"message": message}
        if conversation_id:
            payload["conversation_id"] = conversation_id
        if messages:
            history = [m for m in messages if m["role"] in ("user", "assistant")]
            payload["history"] = history[-10:]
        resp = requests.post(
            DIMASE_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json", "X-Bot-Secret": DIMASE_BOT_SECRET},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data.get("response") or data.get("message") or str(data)
        return {"model": "dimase-nexus", "response": text, "elapsed": round(time.time() - start, 2),
                "status": "success", "tokens": len(text.split())}
    except Exception as e:
        return {"model": "dimase-nexus", "response": f"[DIMASE NEXUS ERROR] {e}",
                "elapsed": round(time.time() - start, 2), "status": "error"}


def _call_groq(model_key: str, groq_model: str, message: str, messages: list = None) -> dict:
    start = time.time()
    if not GROQ_API_KEY:
        return {"model": model_key, "response": "[GROQ] No API key — set GROQ_API_KEY env variable",
                "elapsed": 0, "status": "error"}
    try:
        payload = {
            "model": groq_model,
            "messages": messages if messages else [{"role": "user", "content": message}],
            "max_tokens": 1024,
        }
        resp = requests.post(
            GROQ_EP,
            json=payload,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            timeout=30,
        )
        if resp.status_code == 200:
            import re as _re
            text = resp.json()["choices"][0]["message"]["content"].strip()
            text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
            return {"model": model_key, "response": text, "elapsed": round(time.time() - start, 2),
                    "status": "success", "tokens": len(text.split())}
        return {"model": model_key, "response": f"[HTTP {resp.status_code}] {resp.text[:200]}",
                "elapsed": round(time.time() - start, 2), "status": "error"}
    except Exception as e:
        return {"model": model_key, "response": f"[GROQ ERROR] {e}",
                "elapsed": round(time.time() - start, 2), "status": "error"}


def _call_ollama(model_key: str, ollama_model: str, message: str, messages: list = None) -> dict:
    start = time.time()
    try:
        payload = {
            "model": ollama_model,
            "messages": messages if messages else [{"role": "user", "content": message}],
            "stream": False,
        }
        resp = requests.post(
            OLLAMA_EP,
            json=payload,
            timeout=120,
        )
        if resp.status_code == 200:
            text = resp.json()["choices"][0]["message"]["content"].strip()
            return {"model": model_key, "response": text, "elapsed": round(time.time() - start, 2),
                    "status": "success", "tokens": len(text.split())}
        return {"model": model_key, "response": f"[HTTP {resp.status_code}] {resp.text[:100]}",
                "elapsed": round(time.time() - start, 2), "status": "error"}
    except Exception as e:
        return {"model": model_key, "response": f"[OLLAMA ERROR] {e}",
                "elapsed": round(time.time() - start, 2), "status": "error"}


def _call_pollinations(model_key: str, poll_model: str, message: str, messages: list = None) -> dict:
    start = time.time()
    with _POLL_SEM:
        result = _do_pollinations(model_key, poll_model, message, messages, start)
        time.sleep(_POLL_COOLDOWN)
        return result


def _do_pollinations(model_key: str, poll_model: str, message: str, messages: list, start: float) -> dict:
    try:
        payload = {
            "messages": messages if messages else [{"role": "user", "content": message}],
            "model": poll_model,
            "seed": -1,
            "private": True,
        }
        resp = requests.post(POLLINATIONS_EP, json=payload, timeout=60,
                             headers={"Content-Type": "application/json"})
        if resp.status_code == 200:
            text = resp.text.strip()
            return {"model": model_key, "response": text, "elapsed": round(time.time() - start, 2),
                    "status": "success", "tokens": len(text.split())}
        return {"model": model_key, "response": f"[HTTP {resp.status_code}] {resp.text[:200]}",
                "elapsed": round(time.time() - start, 2), "status": "error"}
    except Exception as e:
        return {"model": model_key, "response": f"[POLL ERROR] {e}",
                "elapsed": round(time.time() - start, 2), "status": "error"}


def _call_model(model_key: str, message: str, conversation_id: str = None, messages: list = None) -> dict:
    info = MODELS.get(model_key, {})
    backend = info.get("backend", "pollinations")
    if backend == "dimase":
        return _call_dimase(message, conversation_id, messages)
    elif backend == "groq":
        return _call_groq(model_key, info["groq_model"], message, messages)
    elif backend == "ollama":
        return _call_ollama(model_key, info["ollama_model"], message, messages)
    elif backend == "hermes":
        return _call_hermes(model_key, info["model_slug"], message, messages)
    elif backend == "pollinations":
        return _call_pollinations(model_key, info.get("poll_model", model_key), message, messages)
    return {"model": model_key, "response": f"[Unknown backend: {backend}]", "elapsed": 0, "status": "error"}


# ─── ModelCouncil class ───────────────────────────────────────────────────────

class ModelCouncil:
    def __init__(self):
        self.models = MODELS
        self._status = {k: "unknown" for k in MODELS}
        self._last_check = 0
        self._prune_unavailable_ollama()

    def _prune_unavailable_ollama(self):
        """Remove Ollama models from council if model file not pulled yet."""
        try:
            resp = requests.get("http://localhost:11434/api/tags", timeout=3)
            if resp.status_code == 200:
                available = {m["name"] for m in resp.json().get("models", [])}
                to_remove = []
                for k, info in self.models.items():
                    if info.get("backend") == "ollama":
                        if info["ollama_model"] not in available:
                            to_remove.append(k)
                for k in to_remove:
                    del self.models[k]
                    self._status.pop(k, None)
        except Exception:
            # Ollama not running — remove all local models
            to_remove = [k for k, v in self.models.items() if v.get("backend") == "ollama"]
            for k in to_remove:
                del self.models[k]
                self._status.pop(k, None)

    def query_primary(self, message: str, conversation_id: str = None, messages: list = None) -> dict:
        return _call_hermes("hermes-agent", "nvidia/nemotron-3-super-120b-a12b:free", message, messages)

    def query_all(self, message: str, conversation_id: str = None, messages: list = None, on_result=None) -> dict:
        results = {}
        model_keys = sorted(self.models.keys(), key=lambda k: self.models[k].get("priority", 99))
        with ThreadPoolExecutor(max_workers=len(model_keys)) as executor:
            future_to_model = {executor.submit(_call_model, k, message, conversation_id, messages): k
                               for k in model_keys}
            for future in as_completed(future_to_model, timeout=180):
                key = future_to_model[future]
                try:
                    result = future.result()
                    results[key] = result
                    self._status[key] = result["status"]
                    if on_result:
                        on_result(key, result)
                except Exception as e:
                    result = {"model": key, "response": f"[TIMEOUT] {e}", "elapsed": 180, "status": "error"}
                    results[key] = result
                    if on_result:
                        on_result(key, result)
        return results

    def synthesize(self, original_message: str, council_results: dict, conversation_id: str = None) -> dict:
        responses_text = "\n\n".join(
            f"[{self.models.get(k, {}).get('label', k)}]: {v['response']}"
            for k, v in council_results.items()
            if k != "dimase-nexus" and v.get("status") == "success"
        )
        prompt = (
            f"Original question: {original_message}\n\n"
            f"Responses from {len(council_results)} global AI models:\n\n{responses_text}\n\n"
            f"Synthesize the definitive answer. Identify consensus, highlight unique insights, "
            f"note any disagreements."
        )
        return _call_dimase(prompt, conversation_id)

    def get_model_info(self) -> list:
        return sorted(
            [{**info, "key": k, "status": self._status.get(k, "unknown")} for k, info in self.models.items()],
            key=lambda x: x.get("priority", 99),
        )

    def ping_models(self):
        def _ping():
            test = "Reply with only the word: ONLINE"
            with ThreadPoolExecutor(max_workers=len(self.models)) as ex:
                futures = {ex.submit(_call_model, k, test): k for k in self.models}
                for f in as_completed(futures, timeout=120):
                    k = futures[f]
                    try:
                        r = f.result()
                        self._status[k] = "online" if r["status"] == "success" else "offline"
                    except Exception:
                        self._status[k] = "offline"
            self._last_check = time.time()
        threading.Thread(target=_ping, daemon=True).start()
