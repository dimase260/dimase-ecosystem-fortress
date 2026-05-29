#!/bin/bash
# DIMASE CONTROL — Launch script with self-preservation watchdog
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_BROWSER=false
for arg in "$@"; do [[ "$arg" == "--no-browser" ]] && NO_BROWSER=true; done

export PYTHONPATH="$DIR:$PYTHONPATH"
export PATH="$HOME/.local/bin:$PATH"
export GROQ_API_KEY="ENV_VAR_GROQ_KEYL35o"

# Kill any existing instance on port 7777
fuser -k 7777/tcp 2>/dev/null || true
sleep 0.5

echo "  ⬡ DIMASE CONTROL STARTING..."
echo "  ⬡ URL: http://localhost:7777"

# Open browser after a short delay (unless --no-browser)
if [ "$NO_BROWSER" = false ]; then
    (sleep 2 && xdg-open http://localhost:7777 2>/dev/null || \
                firefox http://localhost:7777 2>/dev/null || \
                chromium-browser http://localhost:7777 2>/dev/null || true) &
fi

# Start watchdog in background
"$DIR/watchdog.sh" &
WATCHDOG_PID=$!

# Run the app (auto-restarts via watchdog if it crashes)
cd "$DIR"
exec python3 "$DIR/app.py"
