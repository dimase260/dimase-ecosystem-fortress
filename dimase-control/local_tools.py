"""
DIMASE LOCAL TOOLS — Web search, real-time data, local system control.
Used by app.py to give DiMase AI live internet access and full local machine control.
"""
import os
import subprocess
import json
import requests
from datetime import datetime


# ── Web Search (DuckDuckGo, no API key) ───────────────────────────────────────

def web_search(query: str, max_results: int = 5) -> list:
    """Search the web via DuckDuckGo. Returns list of {title, url, snippet}."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        r = requests.get(
            'https://html.duckduckgo.com/html/',
            params={'q': query, 'kl': 'us-en'},
            headers=headers,
            timeout=12
        )
        from html.parser import HTMLParser

        class _Parser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self._cur = {}
                self._mode = None
                self._buf = ''

            def handle_starttag(self, tag, attrs):
                a = dict(attrs)
                cls = a.get('class', '')
                if tag == 'a' and 'result__a' in cls:
                    self._cur = {'title': '', 'url': a.get('href', ''), 'snippet': ''}
                    self._mode = 'title'
                    self._buf = ''
                elif tag == 'a' and 'result__snippet' in cls:
                    self._mode = 'snippet'
                    self._buf = ''

            def handle_data(self, data):
                if self._mode:
                    self._buf += data

            def handle_endtag(self, tag):
                if tag == 'a' and self._mode == 'title':
                    self._cur['title'] = self._buf.strip()
                    self._mode = None
                elif tag == 'a' and self._mode == 'snippet':
                    self._cur['snippet'] = self._buf.strip()
                    self._mode = None
                    if self._cur.get('title') and len(self.results) < 8:
                        self.results.append(dict(self._cur))
                        self._cur = {}

        p = _Parser()
        p.feed(r.text)
        return p.results[:max_results]
    except Exception as e:
        return [{'title': 'Search error', 'url': '', 'snippet': str(e)}]


def get_weather(location: str = 'Cincinnati') -> dict:
    """Get current weather via wttr.in (free, no key)."""
    try:
        r = requests.get(f'https://wttr.in/{location}?format=j1', timeout=8)
        d = r.json()
        cur = d['current_condition'][0]
        area = d.get('nearest_area', [{}])[0]
        city = area.get('areaName', [{}])[0].get('value', location)
        return {
            'location': city,
            'temp_f': cur['temp_F'],
            'temp_c': cur['temp_C'],
            'feels_like_f': cur['FeelsLikeF'],
            'desc': cur['weatherDesc'][0]['value'],
            'humidity': cur['humidity'],
            'wind_mph': cur['windspeedMiles'],
            'visibility': cur['visibility'],
        }
    except Exception as e:
        return {'error': str(e), 'location': location}


def format_weather(w: dict) -> str:
    if 'error' in w:
        return f"Weather unavailable: {w['error']}"
    return (f"Weather in {w['location']}: {w['desc']}, "
            f"{w['temp_f']}°F ({w['temp_c']}°C), feels like {w['feels_like_f']}°F, "
            f"humidity {w['humidity']}%, wind {w['wind_mph']} mph")


def format_search_results(results: list, query: str) -> str:
    if not results:
        return f"No results found for: {query}"
    lines = [f"Web search results for '{query}':"]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r['title']}")
        if r.get('snippet'):
            lines.append(f"   {r['snippet']}")
        if r.get('url'):
            lines.append(f"   {r['url']}")
    return '\n'.join(lines)


# ── Local Shell Execution ─────────────────────────────────────────────────────

def local_shell(cmd: str, timeout: int = 30, cwd: str = None) -> str:
    """Execute a shell command on the local machine. Returns combined stdout+stderr."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=timeout, cwd=cwd or os.path.expanduser('~')
        )
        out = (result.stdout + result.stderr).strip()
        return out or '(no output)'
    except subprocess.TimeoutExpired:
        return f'Command timed out after {timeout}s'
    except Exception as e:
        return f'Error: {e}'


# ── Local System Info ─────────────────────────────────────────────────────────

def get_processes(limit: int = 20) -> str:
    return local_shell(f'ps aux --sort=-%cpu | head -{limit + 1}')


def get_listening_ports() -> str:
    return local_shell('ss -tlnp')


def get_disk_usage() -> str:
    return local_shell('df -h')


def get_network_info() -> str:
    return local_shell('ip addr show && echo "---" && ip route')


def get_systemd_failed() -> str:
    return local_shell('systemctl --failed --no-legend')


def get_journal_tail(lines: int = 50) -> str:
    return local_shell(f'journalctl -n {lines} --no-pager')


# ── Local File Operations ─────────────────────────────────────────────────────

def read_local_file(path: str, max_chars: int = 8000) -> str:
    try:
        with open(os.path.expanduser(path)) as f:
            return f.read(max_chars)
    except Exception as e:
        return f'Error reading {path}: {e}'


def write_local_file(path: str, content: str) -> str:
    try:
        path = os.path.expanduser(path)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'w') as f:
            f.write(content)
        return f'Written {len(content)} chars to {path}'
    except Exception as e:
        return f'Error writing {path}: {e}'


def list_dir(path: str = '~') -> str:
    return local_shell(f'ls -la {os.path.expanduser(path)}')


# ── Intent Detection ─────────────────────────────────────────────────────────

SEARCH_TRIGGERS = [
    'weather', 'temperature', 'forecast',
    'news', 'latest', 'breaking', 'recent',
    'current events', 'today', 'right now', 'happening',
    'price of', 'stock price', 'crypto', 'bitcoin',
    'who won', 'score', 'game', 'sports',
    'search for', 'look up', 'find online',
    'what is the', "what's the",
]

WEATHER_TRIGGERS = ['weather', 'temperature', 'forecast', 'rain', 'snow', 'hot', 'cold outside']

LOCAL_TRIGGERS = [
    'run ', 'execute ', 'shell', 'terminal', 'command',
    'install ', 'start ', 'stop ', 'kill ', 'process',
    'disk space', 'memory', 'cpu', 'who is logged',
    'list files', 'read file', 'open file',
]


def needs_web_search(message: str) -> bool:
    msg = message.lower()
    return any(t in msg for t in SEARCH_TRIGGERS)


def needs_weather(message: str) -> bool:
    msg = message.lower()
    return any(t in msg for t in WEATHER_TRIGGERS)


def extract_location(message: str) -> str:
    """Try to extract a location from a weather query."""
    import re
    msg = message.lower()
    # "weather in X", "weather for X", "X weather"
    m = re.search(r'weather (?:in|for|at) ([a-zA-Z\s,]+?)(?:\?|$|\.)', msg)
    if m:
        return m.group(1).strip().title()
    m = re.search(r'([a-zA-Z\s,]+?) weather', msg)
    if m:
        loc = m.group(1).strip()
        if loc and loc not in ('the', 'current', 'local'):
            return loc.title()
    return 'Cincinnati'  # default


def parse_run_commands(response: str):
    """
    Parse AI response for RUN: commands.
    Returns (clean_response, list_of_commands).
    """
    lines = response.split('\n')
    clean = []
    commands = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('RUN:'):
            cmd = stripped[4:].strip()
            if cmd:
                clean.append(f'`$ {cmd}`')
                commands.append(cmd)
        elif stripped.startswith('RUN_LOCAL:'):
            cmd = stripped[10:].strip()
            if cmd:
                clean.append(f'`$ {cmd}`')
                commands.append(cmd)
        else:
            clean.append(line)
    return '\n'.join(clean), commands
