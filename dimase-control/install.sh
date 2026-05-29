#!/bin/bash
# DIMASE CONTROL — One-shot installer
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_SVG="$DIR/static/icon.svg"
ICON_PNG="$DIR/static/icon.png"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"

echo ""
echo "  ╔═════════════════════════════════════════╗"
echo "  ║     DIMASE CONTROL — INSTALLER v2.0       ║"
echo "  ╚═════════════════════════════════════════╝"
echo ""

# Install Python dependencies
echo "[1/4] Installing Python packages..."
pip3 install --user flask flask-socketio psutil eventlet requests -q
echo "      ✓ Packages installed"

# Convert SVG to PNG for app icon
echo "[2/4] Generating app icon..."
mkdir -p "$ICONS_DIR"
if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 256 -h 256 "$ICON_SVG" -o "$ICON_PNG"
    cp "$ICON_PNG" "$ICONS_DIR/dimase-control.png"
    echo "      ✓ Icon converted (rsvg-convert)"
elif command -v inkscape &>/dev/null; then
    inkscape "$ICON_SVG" --export-png="$ICON_PNG" --export-width=256 -q
    cp "$ICON_PNG" "$ICONS_DIR/dimase-control.png"
    echo "      ✓ Icon converted (inkscape)"
else
    cp "$ICON_SVG" "$ICONS_DIR/dimase-control.svg"
    ICON_PNG="$ICONS_DIR/dimase-control.svg"
    echo "      ✓ Using SVG icon"
fi

# Create data directory
mkdir -p "$DIR/data"

# Install .desktop file
echo "[3/4] Installing desktop entry..."
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/dimase-control.desktop" << EOF
[Desktop Entry]
Type=Application
Name=DiMase Control
GenericName=AI Ecosystem Controller
Comment=Self-aware multi-model AI control center with full ecosystem access
Exec=$DIR/launch.sh
Icon=$ICON_PNG
Terminal=false
Categories=Utility;Network;Science;
Keywords=AI;DiMase;Control;Server;
StartupNotify=true
StartupWMClass=dimase-control
EOF

# Update desktop database
gtk-update-icon-cache ~/.local/share/icons/hicolor 2>/dev/null || true
update-desktop-database "$APPS_DIR" 2>/dev/null || true
echo "      ✓ Desktop entry installed"

# Make scripts executable
chmod +x "$DIR/launch.sh"
chmod +x "$DIR/watchdog.sh"
chmod +x "$DIR/app.py"

echo "[4/4] Setting up watchdog service..."
SYSTEMD_USER="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER"
cat > "$SYSTEMD_USER/dimase-control.service" << EOF
[Unit]
Description=DiMase Control — Self-aware AI Ecosystem Controller
After=network.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$DIR/launch.sh --no-browser
Restart=on-failure
RestartSec=5
Environment=PYTHONPATH=$DIR

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload 2>/dev/null || true
echo "      ✓ Systemd user service created (dimase-control.service)"
echo "        Enable auto-start: systemctl --user enable dimase-control"

echo ""
echo "  ╔═════════════════════════════════════════╗"
echo "  ║  DIMASE CONTROL INSTALLED SUCCESSFULLY    ║"
echo "  ║                                         ║"
echo "  ║  Launch:  ./launch.sh                   ║"
echo "  ║  Or find 'DiMase Control' in app menu     ║"
echo "  ║  URL: http://localhost:7777             ║"
echo "  ╚═════════════════════════════════════════╝"
echo ""
