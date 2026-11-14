#!/bin/bash
# Installs the Dibs TV streamer on this Mac as a background service, so a Roku running Window can host
# Dibs games without any other computer being on. Run it on the Mac that stays on at home:
#
#   curl -fsSL https://raw.githubusercontent.com/ttonyxx/sites/main/tv-window/tools/streamer/install-mac.sh | bash
#
# Re-run it any time to update. Remove it with:  ... | bash -s -- --uninstall
set -eo pipefail  # (no -u: macOS bash 3.2 treats empty arrays as unset)

RAW="https://raw.githubusercontent.com/ttonyxx/sites/main/tv-window/tools/streamer"
DIR="$HOME/Library/Application Support/DibsTVStreamer"
LABEL="com.tonyxin.dibs-tv-streamer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/dibs-tv-streamer.log"
DOMAIN="gui/$(id -u)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  bold "Dibs TV streamer removed."
  exit 0
fi

[ "$(uname)" = "Darwin" ] || fail "This installer is for macOS."

# ---- prerequisites: Node, ffmpeg, Chrome ----------------------------------------------------------
find_bin() { for p in "$@"; do [ -x "$p" ] && { echo "$p"; return; }; done; }
BREW="$(find_bin /opt/homebrew/bin/brew /usr/local/bin/brew)"
# puppeteer-core needs Node 22.12+; the first node on PATH (e.g. an nvm default) may be older.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null; }
find_node() { for p in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do [ -x "$p" ] && node_ok "$p" && { echo "$p"; return; }; done; }
NODE="$(find_node || true)"
FFMPEG="$(command -v ffmpeg || find_bin /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg || true)"
CHROME="$(find_bin "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" || true)"

need=()
[ -z "$NODE" ] && need+=(node)
[ -z "$FFMPEG" ] && need+=(ffmpeg)
if [ ${#need[@]} -gt 0 ] || [ -z "$CHROME" ]; then
  [ -n "$BREW" ] || fail "Missing Node, ffmpeg or Google Chrome. Install Homebrew (https://brew.sh) and run this again."
  [ ${#need[@]} -gt 0 ] && { bold "Installing ${need[*]} with Homebrew…"; "$BREW" install "${need[@]}" || "$BREW" upgrade "${need[@]}"; }
  [ -z "$CHROME" ] && { bold "Installing Google Chrome with Homebrew…"; "$BREW" install --cask google-chrome; }
  NODE="$(find_node)"
  [ -n "$NODE" ] || fail "Couldn't find Node 22.12 or newer. Run: brew upgrade node"
  FFMPEG="$(command -v ffmpeg || find_bin /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg)"
fi
NPM="$(dirname "$NODE")/npm"

# ---- the streamer itself ----------------------------------------------------------------------------
bold "Installing the streamer in $DIR"
mkdir -p "$DIR" "$(dirname "$PLIST")" "$(dirname "$LOG")"
curl -fsSL "$RAW/streamer.mjs" -o "$DIR/streamer.mjs"
cat > "$DIR/package.json" <<'JSON'
{ "name": "dibs-tv-streamer", "private": true, "type": "module", "dependencies": { "puppeteer-core": "^25.17.0" } }
JSON
(cd "$DIR" && "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error)

# ---- background service (starts at login, restarts if it stops) ---------------------------------
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/streamer.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>FFMPEG_PATH</key><string>$FFMPEG</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout returns before the old service is fully gone; bootstrapping too soon fails with error 5.
for _ in $(seq 1 20); do launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
for i in 1 2 3 4 5; do
  launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null && break
  [ "$i" = 5 ] && fail "Couldn't start the background service (launchctl bootstrap failed)."
  sleep 1
done

# ---- check -------------------------------------------------------------------------------------------
for _ in $(seq 1 20); do
  curl -fsS -m 2 http://127.0.0.1:8790/status >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 http://127.0.0.1:8790/status >/dev/null 2>&1 || fail "The streamer didn't start. See $LOG"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?')"
bold "Dibs TV streamer is running on this Mac (http://$IP:8790). Window on the TV finds it by itself."
echo "If macOS asks to let \"node\" find devices on your local network or accept incoming connections, click Allow."
echo "Logs: $LOG"
