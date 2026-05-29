#!/usr/bin/env python3
"""
DIMASE MODEL SCOUT — Daily 2am deep research for new free AI models worldwide.
Runs on BuyVM server even when local machine is offline.
"""
import json, requests, time, os
from datetime import datetime

TELEGRAM_TOKEN = '8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw'
TELEGRAM_CHAT  = '7826090533'
OUTPUT_FILE    = '/media/Storage/dimase-knowledge/free_models.json'
LOCAL_SYNC     = '/media/Storage/dimase-knowledge/dimase-control/data/free_models.json'

POLL_MODELS_URL = 'https://text.pollinations.ai/models'
HF_TRENDING_URL = 'https://huggingface.co/api/models?sort=trending&limit=20&pipeline_tag=text-generation'

def tg(msg):
    try:
        requests.post(
            f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage',
            json={'chat_id': TELEGRAM_CHAT, 'text': msg, 'parse_mode': 'HTML'},
            timeout=10)
    except Exception:
        pass

def test_pollinations_model(model_id, timeout=15):
    try:
        r = requests.post(
            'https://text.pollinations.ai/',
            json={'messages': [{'role': 'user', 'content': 'Reply: ONLINE'}],
                  'model': model_id, 'seed': 1, 'private': True},
            timeout=timeout)
        return r.status_code == 200 and len(r.text.strip()) > 0
    except Exception:
        return False

def get_pollinations_models():
    try:
        r = requests.get(POLL_MODELS_URL, timeout=15)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                names = []
                for m in data:
                    if isinstance(m, str):
                        names.append(m)
                    elif isinstance(m, dict):
                        names.append(m.get('name') or m.get('id') or str(m))
                return names
    except Exception:
        pass
    return []

KNOWN_MODELS = {
    'dimase-nexus', 'gpt-4o', 'mistral', 'llama', 'gemini', 'command-r',
    'deepseek', 'qwen-coder', 'phi', 'grok', 'searchgpt',
    'claude-hybridspace', 'learnlm'
}

COLOR_POOL = ['#FF69B4', '#00CED1', '#FFA07A', '#98FB98', '#DDA0DD',
              '#F0E68C', '#87CEEB', '#FFB6C1', '#FFDAB9', '#E0FFFF']
ICON_POOL  = ['◌', '○', '□', '△', '▽', '◇', '◈', '⊗', '⊙', '◎']

def main():
    print(f'[{datetime.utcnow().isoformat()}] DIMASE MODEL SCOUT starting...')
    discovered = []

    # 1. Check Pollinations for new models
    poll_models = get_pollinations_models()
    print(f'  Pollinations returned {len(poll_models)} models')
    for mid in poll_models:
        key = str(mid).lower().replace(' ', '-').replace('/', '-')
        if key not in KNOWN_MODELS:
            print(f'  Testing: {key}')
            if test_pollinations_model(mid):
                idx = len(discovered) % len(COLOR_POOL)
                discovered.append({
                    'key':          key,
                    'label':        str(mid).upper()[:14],
                    'subtitle':     'Discovered via Pollinations',
                    'color':        COLOR_POOL[idx],
                    'icon':         ICON_POOL[idx % len(ICON_POOL)],
                    'provider':     'Pollinations',
                    'priority':     50 + len(discovered),
                    'poll_id':      str(mid),
                    'verified_at':  datetime.utcnow().isoformat(),
                })

    # 2. HuggingFace trending
    try:
        r = requests.get(HF_TRENDING_URL, timeout=15)
        if r.status_code == 200:
            hf_models = r.json()
            hf_found = [m.get('modelId') or m.get('id', '') for m in hf_models[:10] if m.get('modelId') or m.get('id')]
            if hf_found:
                discovered.append({
                    'key':         '_hf_trending',
                    'label':       'HF TRENDING',
                    'subtitle':    'HuggingFace top text-gen models',
                    'color':       '#FFD700',
                    'icon':        '🤗',
                    'provider':    'HuggingFace',
                    'priority':    98,
                    'hf_models':   hf_found,
                    'verified_at': datetime.utcnow().isoformat(),
                })
    except Exception as e:
        print(f'  HF error: {e}')

    # Load existing and merge
    existing = []
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE) as f:
                existing = json.load(f).get('models', [])
        except Exception:
            pass

    existing_keys = {m['key'] for m in existing}
    truly_new = [m for m in discovered if m['key'] not in existing_keys and not m['key'].startswith('_')]
    all_models = existing + [m for m in discovered if m['key'] not in existing_keys]

    result = {
        'updated_at':    datetime.utcnow().isoformat(),
        'total':         len(all_models),
        'new_this_run':  len(truly_new),
        'models':        all_models,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(result, f, indent=2)
    print(f'  Saved {len(all_models)} models ({len(truly_new)} new)')

    os.makedirs(os.path.dirname(LOCAL_SYNC), exist_ok=True)
    with open(LOCAL_SYNC, 'w') as f:
        json.dump(result, f, indent=2)

    if truly_new:
        names = ', '.join(m['label'] for m in truly_new[:5])
        tg(f'<b>DIMASE MODEL SCOUT</b>\n{len(truly_new)} new AI models discovered:\n{names}\nTotal: {len(all_models)} models')
    else:
        tg(f'<b>DIMASE MODEL SCOUT</b>\nDaily scan complete. No new models found. Catalog: {len(all_models)} models.')

    print(f'[{datetime.utcnow().isoformat()}] Scout done.')

if __name__ == '__main__':
    main()
