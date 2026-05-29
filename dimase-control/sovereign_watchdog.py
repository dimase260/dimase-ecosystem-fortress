#!/usr/bin/env python3
import os
import time
import subprocess
import re
import requests
from datetime import datetime

# Configuration
LOG_FILE = os.path.expanduser("~/.hermes/logs/agent.log")
ERR_FILE = os.path.expanduser("~/.hermes/logs/errors.log")
CONFIG_FILE = os.path.expanduser("~/.hermes/config.yaml")
TELEGRAM_BOT_TOKEN = "8713733121:AAGCvSq-bbX6TnPz8hwJXxiLRhG1SAdzLCw"
TELEGRAM_CHAT_ID = "7826090533"

# Models to rotate through
FREE_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "qwen/qwen3-coder:free",
    "deepseek/deepseek-r1:free",
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct:free"
]

current_model_idx = 0

def log_event(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {msg}")

def notify_user(msg):
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": f"⚕⬡ *Watchdog Event:* {msg}", "parse_mode": "Markdown"},
            timeout=10
        )
    except:
        pass

def rotate_model():
    global current_model_idx
    current_model_idx = (current_model_idx + 1) % len(FREE_MODELS)
    new_model = FREE_MODELS[current_model_idx]
    log_event(f"Rotating to model: {new_model}")
    try:
        subprocess.run(["hermes", "config", "set", "model.default", new_model], check=True)
        subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"], check=True)
        notify_user(f"Detected service degradation. Switched primary brain to `{new_model}`.")
    except Exception as e:
        log_event(f"Error during rotation: {e}")

def monitor():
    log_event("Sovereign Watchdog initialized.")
    
    # Seek to end of log
    with open(LOG_FILE, "r") as f:
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                # Check gateway status periodically
                status = subprocess.run(["systemctl", "--user", "is-active", "hermes-gateway"], capture_output=True, text=True)
                if status.stdout.strip() != "active":
                    log_event("Gateway inactive. Restarting...")
                    subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"])
                    notify_user("Hermes Gateway crashed. Restarting service...")
                
                time.sleep(1)
                continue
            
            # Look for errors - ONLY if they come from the Telegram platform
            if "platform=telegram" not in line and "gateway.platforms.telegram" not in line:
                continue

            if "429" in line or "RateLimitError" in line:
                log_event(f"Detected rate limit: {line.strip()}")
                rotate_model()
                time.sleep(30) # Cooldown
            
            elif "402" in line or "Insufficient credits" in line:
                log_event(f"Detected credit error: {line.strip()}")
                rotate_model()
                time.sleep(30)

            elif "401" in line or "AuthenticationError" in line:
                log_event(f"Detected authentication error: {line.strip()}")
                # Likely a config issue, try restarting gateway first
                subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"])
                time.sleep(30)

if __name__ == "__main__":
    try:
        monitor()
    except KeyboardInterrupt:
        log_event("Watchdog stopped.")
    except Exception as e:
        log_event(f"Fatal watchdog error: {e}")
        time.sleep(10)
