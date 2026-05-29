#!/usr/bin/env python3
"""
DiMase AI Telegram Bot — DiMase Inc. Full Ecosystem Controller
All same powers as DiMase Control interface: 13 models, shell, docker, services, memory, council mode.
"""
import os, json, time, subprocess, logging, requests, psutil, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

BOT_TOKEN      = os.environ.get('TELEGRAM_BOT_TOKEN', '8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw')
CHAT_ID        = int(os.environ.get('TELEGRAM_CHAT_ID', '7826090533'))
BOT_SECRET     = os.environ.get('DIMASE_BOT_SECRET', 'dimase-bot-2026')
WORKER_URL     = 'https://dimaseinc.org/dimase/bot-chat'
MONITOR_URL    = 'https://monitor.dimaseinc.org/health'
POLL_EP        = 'https://text.pollinations.ai/'
WEBSITE_DIR    = '/media/Storage/website/dimaseinc-website'
MAX_LEN        = 3900
LONG_POLL_TO   = 25
REQ_TO         = 60

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('dimase-bot')

history = []

# ── All 13 AI models ──────────────────────────────────────────────────────────
COUNCIL_MODELS = {
    'dimase-nexus':         {'label': 'DIMASE NEXUS',  'poll': None},
    'gpt-4o':             {'label': 'GPT-4o',       'poll': 'openai'},
    'mistral':            {'label': 'MISTRAL',      'poll': 'mistral'},
    'llama':              {'label': 'LLAMA 3.3',    'poll': 'llama'},
    'gemini':             {'label': 'GEMINI',       'poll': 'gemini'},
    'openai-large':       {'label': 'GPT-4o LARGE',  'poll': 'openai-large'},
    'deepseek':           {'label': 'DEEPSEEK R1',  'poll': 'deepseek'},
    'qwen-coder':         {'label': 'QWEN 2.5',     'poll': 'qwen-coder'},
    'phi':                {'label': 'PHI-4',        'poll': 'phi'},
    'grok':               {'label': 'GROK',         'poll': 'grok'},
    'searchgpt':          {'label': 'SEARCHGPT',    'poll': 'searchgpt'},
    'claude-hybridspace': {'label': 'CLAUDE',       'poll': 'claude-hybridspace'},
    'learnlm':            {'label': 'LEARNLM',      'poll': 'learnlm'},
}

SERVICES = {
    'dimaseinc.org':           'https://dimaseinc.org',
    'home':                    'https://home.dimaseinc.org',
    'dtradingpost':            'https://dtradingpost.dimaseinc.org',
    'locksmith':               'https://locksmith.dimaseinc.org',
    'monitor':                 'https://monitor.dimaseinc.org/health',
    'files':                   'https://files.dimaseinc.org',
    'portainer':               'https://portainer.dimaseinc.org',
    'ann-bibliotheca':         'https://dimaseinc.org/ann-reads',
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def send(text, parse_mode='Markdown'):
    if not text:
        return
    chunks = [text[i:i+MAX_LEN] for i in range(0, len(text), MAX_LEN)]
    for chunk in chunks:
        try:
            requests.post(
                f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
                json={'chat_id': CHAT_ID, 'text': chunk, 'parse_mode': parse_mode},
                timeout=15)
        except Exception as e:
            log.error(f'send error: {e}')

def shell(cmd, timeout=45):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or '') + (r.stderr or '')
        return out.strip() or '(no output)'
    except subprocess.TimeoutExpired:
        return f'Timed out after {timeout}s'
    except Exception as e:
        return f'Error: {e}'

def server_stats():
    try:
        r = requests.get(MONITOR_URL, timeout=10)
        if r.status_code == 200:
            d = r.json()
            cpu = d.get('cpu') or d.get('cpu_percent', '?')
            mem = d.get('memory') or d.get('memory_percent', '?')
            disk = d.get('disk') or d.get('disk_percent', '?')
            return f"*Server Stats (Live)*\nCPU: {cpu}\nRAM: {mem}\nDisk: {disk}"
    except Exception:
        pass
    # fallback to local psutil
    cpu = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    try:
        disk = psutil.disk_usage('/media/Storage')
        disk_str = f"Storage: {disk.percent}% ({disk.used//1073741824}GB/{disk.total//1073741824}GB)"
    except Exception:
        disk_str = "Storage: unavailable"
    return (f"*Server Stats (Local)*\nCPU: {cpu}%\n"
            f"RAM: {mem.percent}% ({mem.used//1048576}MB/{mem.total//1048576}MB)\n{disk_str}")

def ai_primary(text):
    global history
    history.append({'role': 'user', 'content': text})
    try:
        r = requests.post(
            WORKER_URL,
            headers={'X-Bot-Secret': BOT_SECRET, 'Content-Type': 'application/json'},
            json={'message': text, 'history': history[-10:]},
            timeout=45)
        reply = r.json().get('response', 'No response')
    except Exception as e:
        reply = f'AI error: {e}'
    history.append({'role': 'assistant', 'content': reply})
    if len(history) > 20:
        history = history[-20:]
    return reply

def ai_pollinations(poll_model, message):
    try:
        r = requests.post(
            POLL_EP,
            json={'messages': [{'role': 'user', 'content': message}],
                  'model': poll_model, 'seed': -1, 'private': True},
            timeout=30)
        if r.status_code == 200:
            return r.text.strip()
        return f'HTTP {r.status_code}'
    except Exception as e:
        return f'Error: {e}'

def council_query(message):
    """Query all 13 models in parallel, return combined result."""
    results = {}

    def _call(key, info):
        if info['poll'] is None:  # dimase-nexus
            return key, ai_primary(message)
        else:
            return key, ai_pollinations(info['poll'], message)

    with ThreadPoolExecutor(max_workers=13) as ex:
        futures = {ex.submit(_call, k, v): k for k, v in COUNCIL_MODELS.items()}
        for f in as_completed(futures, timeout=60):
            try:
                key, reply = f.result()
                results[key] = reply
            except Exception as e:
                results[futures[f]] = f'Error: {e}'
    return results

def check_services():
    lines = ['*Ecosystem Service Status*']
    for name, url in SERVICES.items():
        try:
            r = requests.get(url, timeout=6, allow_redirects=True)
            ok = r.status_code < 500
            ms = int(r.elapsed.total_seconds() * 1000)
            lines.append(f"{'✅' if ok else '❌'} {name}: {r.status_code} ({ms}ms)")
        except Exception as e:
            lines.append(f"❌ {name}: OFFLINE")
    return '\n'.join(lines)

# ── Command handler ───────────────────────────────────────────────────────────
def handle(text, from_id):
    if from_id != CHAT_ID:
        log.warning(f'Blocked from {from_id}')
        return

    text = text.strip()

    if text in ('/start', '/help'):
        send("*⬡ DIMASE AI — Full Ecosystem Controller*\n\n"
             "*Shell & Docker:*\n"
             "`!cmd <command>` — run shell command\n"
             "`!docker <action>` — docker command\n"
             "`!logs <container>` — last 50 log lines\n"
             "`!restart <container>` — restart container\n\n"
             "*System:*\n"
             "`!status` — server stats (live)\n"
             "`!services` — all service health\n"
             "`!file <path>` — read server file\n"
             "`!deploy` — deploy website\n"
             "`!secret KEY VALUE` — wrangler secret\n"
             "`!backup` — sync dimase-control to server\n\n"
             "*AI:*\n"
             "`!council <query>` — all 13 models simultaneously\n"
             "`!models` — list all 13 AI models\n"
             "`!clear` — clear conversation history\n\n"
             "_Just type anything for AI chat._")
        return

    if text in ('!status', '!stats'):
        send(server_stats())
        return

    if text == '!clear':
        history.clear()
        send('Conversation cleared.')
        return

    if text == '!services':
        send('_Scanning services..._')
        send(check_services())
        return

    if text == '!models':
        lines = ['*⬡ Available AI Models (13):*']
        for k, v in COUNCIL_MODELS.items():
            lines.append(f"• {v['label']} ({k})")
        send('\n'.join(lines))
        return

    if text == '!backup':
        send('_Syncing dimase-control files to server..._')
        out = shell('rsync -avz /home/dimase/dimase-control/ /media/Storage/dimase-knowledge/dimase-control/ 2>&1 | tail -10', timeout=60)
        send(f'Backup:\n```\n{out[:1500]}\n```')
        return

    if text.startswith('!cmd ') or text.startswith('!shell '):
        cmd = text.split(' ', 1)[1]
        out = shell(cmd)
        send(f'`$ {cmd}`\n```\n{out[:3800]}\n```')
        return

    if text.startswith('!docker '):
        action = text[8:]
        out = shell(f'docker {action}')
        send(f'`docker {action}`\n```\n{out[:3800]}\n```')
        return

    if text.startswith('!restart '):
        container = text[9:].strip()
        out = shell(f'docker restart {container}')
        send(f'`docker restart {container}`\n```\n{out[:1500]}\n```')
        return

    if text.startswith('!logs '):
        container = text[6:].strip()
        out = shell(f'docker logs --tail 50 {container} 2>&1')
        send(f'*Logs: {container}*\n```\n{out[:3800]}\n```')
        return

    if text.startswith('!file '):
        path = text[6:].strip()
        out = shell(f"head -c 4000 '{path}' 2>&1")
        send(f'*File: {path}*\n```\n{out}\n```')
        return

    if text.startswith('!secret '):
        parts = text.split(' ', 2)
        if len(parts) < 3:
            send('Usage: `!secret KEY VALUE`')
            return
        key, value = parts[1], parts[2].strip()
        try:
            r = subprocess.run(
                ['npx', 'wrangler', 'secret', 'put', key],
                input=value, capture_output=True, text=True, timeout=60,
                cwd=WEBSITE_DIR)
            send(f'Stored `{key}`\n```\n{(r.stdout+r.stderr).strip()[-1500:]}\n```')
        except Exception as e:
            send(f'Error: {e}')
        return

    if text == '!deploy':
        send('_Deploying website..._')
        out = shell('deploy-website', timeout=180)
        send(f'```\n{out[-3800:]}\n```')
        return

    if text.startswith('!council '):
        query = text[9:].strip()
        send(f'_Querying all 13 models simultaneously..._')
        results = council_query(query)
        # Synthesize with DiMase
        synth_prompt = (
            f"Original: {query}\n\n"
            + '\n\n'.join(f"[{COUNCIL_MODELS.get(k,{}).get('label',k)}]: {v[:300]}"
                          for k, v in results.items() if k != 'dimase-nexus')
            + "\n\nSynthesize the best answer from these responses."
        )
        synthesis = ai_primary(synth_prompt)

        msg = f"*⬡ COUNCIL RESULTS ({len(results)} models)*\n\n"
        for k, v in list(results.items())[:6]:  # Show top 6 to stay under limit
            label = COUNCIL_MODELS.get(k, {}).get('label', k)
            msg += f"*{label}:*\n{v[:300]}\n\n"
        send(msg)
        send(f"*⬡ SYNTHESIS (DiMase Nexus):*\n{synthesis}")
        return

    # ── Default: AI chat with RUN: auto-execution ──────────────────────────
    send('_Thinking..._')
    reply = ai_primary(text)

    lines = reply.split('\n')
    clean, tool_outs = [], []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('RUN:'):
            cmd = stripped[4:].strip()
            clean.append(f'`$ {cmd}`')
            out = shell(cmd)
            tool_outs.append(f'```\n{out[:1500]}\n```')
        else:
            clean.append(line)

    send('\n'.join(clean))
    for out in tool_outs:
        send(out)


# ── Long-poll loop ────────────────────────────────────────────────────────────
def get_updates(offset=None):
    params = {'timeout': LONG_POLL_TO, 'allowed_updates': ['message']}
    if offset:
        params['offset'] = offset
    try:
        r = requests.get(
            f'https://api.telegram.org/bot{BOT_TOKEN}/getUpdates',
            params=params, timeout=REQ_TO)
        return r.json().get('result', [])
    except requests.exceptions.Timeout:
        time.sleep(2)
        return []
    except Exception as e:
        log.error(f'poll error: {e}')
        time.sleep(10)
        return []

def main():
    log.info('DiMase bot starting — 13 models, full ecosystem powers')
    send('*⬡ DIMASE CONTROL ONLINE*\nFull ecosystem access active.\n13 AI models ready.\nType /help for commands.')
    offset = None
    while True:
        updates = get_updates(offset)
        for u in updates:
            offset = u['update_id'] + 1
            if 'message' in u and 'text' in u['message']:
                m = u['message']
                handle(m['text'], m['chat']['id'])
        if not updates:
            time.sleep(1)

if __name__ == '__main__':
    main()
