#!/bin/bash
# DIMASE WATCHDOG — Self-preservation: restart app.py if it dies
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="$DIR:$PYTHONPATH"
export PATH="$HOME/.local/bin:$PATH"

LOG="$DIR/data/watchdog.log"
mkdir -p "$DIR/data"

echo "$(date -u): Watchdog started (PID $$)" >> "$LOG"

sleep 15  # Give main app time to start

while true; do
    # Check if app is listening on 7777
    if ! ss -tlnp 2>/dev/null | grep -q ':7777 ' ; then
        echo "$(date -u): DIMASE CONTROL down — restarting" >> "$LOG"
        cd "$DIR"
        fuser -k 7777/tcp 2>/dev/null || true
        sleep 1
        python3 "$DIR/app.py" &
        echo "$(date -u): DIMASE restarted (PID $!)" >> "$LOG"
        sleep 20  # Wait for it to come up
    fi
    sleep 30
done
