#!/bin/sh
#
# install-launchd.sh — run the T3 bridge in the background on macOS.
#
# Installs a LaunchAgent that starts the bridge at login and restarts it if it stops.
# Needs ~/.config/pocket-notifier/t3-bridge.env with NOTIFIER_TOKEN (see README.md).
#
#   ./scripts/install-launchd.sh            install or update, then (re)start
#   ./scripts/install-launchd.sh uninstall  stop and remove

set -eu

LABEL="com.pocket-notifier.t3-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/pocket-notifier-t3-bridge.log"
CONFIG="$HOME/.config/pocket-notifier/t3-bridge.env"
BRIDGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "uninstall" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL"
    exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
    echo "node not found on PATH" >&2
    exit 1
fi
if ! grep -q '^NOTIFIER_TOKEN=.' "$CONFIG" 2>/dev/null; then
    echo "Put NOTIFIER_TOKEN=<access token> in $CONFIG first (chmod 600)." >&2
    exit 1
fi
chmod 600 "$CONFIG"

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$BRIDGE_DIR/src/main.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Started $LABEL. Log: $LOG"
