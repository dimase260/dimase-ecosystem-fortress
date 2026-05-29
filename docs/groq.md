---
name: Groq API Key
description: Groq API key for DiMase Control council models and dimase-monitor AI fallback
type: reference
---

**Key name:** dimase (created 2026-03-27)
**Key value:** ENV_VAR_GROQ_KEYL35o
**Account:** DiMaseInc (console.groq.com)
**Existing keys:** "bots" (gsk_...sN4N, active, 109 calls as of 2026-03-27), "Synapes" (gsk_...dYIJ, unused)

**Where set:**
- `/home/dimase/dimase-control/.env` — GROQ_API_KEY (loaded by model_council.py on startup)
- `/home/dimase/dimase-control/launch.sh` — exported as env var
- `/etc/systemd/system/dimase-monitor.service` — Environment= line (server)

**Active Groq models in council (2026-03-27):**
- llama-3.3-70b-versatile (groq-llama)
- meta-llama/llama-4-scout-17b-16e-instruct (groq-llama4)
- qwen/qwen3-32b (groq-qwen3)
- moonshotai/kimi-k2-instruct (groq-kimi)
- openai/gpt-oss-120b (groq-gpt120b)
- llama-3.1-8b-instant (groq-llama-fast)
- groq/compound (groq-compound)

**Decommissioned Groq models (do not use):** mixtral-8x7b-32768, gemma2-9b-it
