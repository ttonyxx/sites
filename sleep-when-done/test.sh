#!/bin/bash
# End-to-end tests for sleep-when-done. The daemon runs in fake mode (SWD_FAKE):
# lid, battery, thermal and display state come from files, and pmset calls are
# recorded instead of run, so no root is needed and the real Mac is untouched.
#
#   ./test.sh

set -u
cd "$(dirname "$0")"
SWD=$PWD/sleep-when-done

T=$(mktemp -d)
FAKE=$T/fake
HOME_DIR=$T/home
SESSIONS=$HOME_DIR/.claude/sessions
mkdir -p "$FAKE" "$SESSIONS" "$HOME_DIR/.claude/projects/proj"
PIDS=""
DAEMON=""

cleanup() {
  [ -n "$DAEMON" ] && kill "$DAEMON" 2>/dev/null
  for p in $PIDS; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done
  rm -rf "$T"
}
trap cleanup EXIT

fails=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }

# expect DESC CMD...: CMD becomes true within 8s.
expect() {
  local desc=$1 i; shift
  for i in $(seq 40); do "$@" && { pass "$desc"; return; }; sleep 0.2; done
  fail "$desc"
}
# stays DESC CMD...: CMD is true for 2.4s straight.
stays() {
  local desc=$1 i; shift
  for i in $(seq 12); do "$@" || { fail "$desc"; return; }; sleep 0.2; done
  pass "$desc"
}

holding() { [ "$(cat "$FAKE/disablesleep" 2>/dev/null)" = 1 ]; }
released() { [ "$(cat "$FAKE/disablesleep" 2>/dev/null)" = 0 ]; }
slept() { [ "$(cat "$FAKE/slept" 2>/dev/null | wc -l | tr -d ' ')" = "$1" ]; }
released_and_slept() { released && slept "$1"; }
set_fake() { echo "$2" > "$FAKE/$1"; }

# spawn [CMD]: start a stand-in for a Claude process; its pid lands in $LAST.
spawn() {
  if [ $# -gt 0 ]; then "$@" >/dev/null 2>&1 & else sleep 600 >/dev/null 2>&1 & fi
  LAST=$!; disown "$LAST"
  PIDS="$PIDS $LAST"
}

# session PID STATUS NAME [PROCSTART]
session() {
  local start=${4:-$(TZ=UTC ps -p "$1" -o lstart= | sed 's/ *$//')}
  printf '{"pid":%s,"sessionId":"sid-%s","procStart":"%s","status":"%s","name":"%s"}\n' \
    "$1" "$1" "$start" "$2" "$3" > "$SESSIONS/$1.json"
}

start_daemon() {
  env -u HOME SWD_FAKE=$FAKE "$SWD" daemon --home "$HOME_DIR" --interval 1 --quiet 3 "$@" &
  DAEMON=$!
}
stop_daemon() { kill "$DAEMON"; wait "$DAEMON" 2>/dev/null; DAEMON=""; }
cli() { HOME=$HOME_DIR SWD_FAKE=$FAKE "$SWD" "$@"; }

set_fake lid open
set_fake power "ac 100"
set_fake thermal 0
set_fake display internal

echo "lid close while working"
spawn; A=$LAST
session "$A" busy "Session A"
start_daemon
expect "a busy session arms the hold" holding
set_fake lid closed
stays "closing the lid keeps the Mac awake while it works" holding
session "$A" idle "Session A"
touch "$HOME_DIR/.claude/projects/proj/sid-$A.jsonl"
sleep 1.2
holding && pass "a just-finished session still holds during the quiet period" ||
  fail "a just-finished session still holds during the quiet period"
expect "after the quiet period it releases and sleeps" released_and_slept 1
session "$A" busy "Session A"
stays "a session starting while the lid is closed doesn't wake things up" released_and_slept 1

echo "lid open"
set_fake lid open
expect "opening the lid re-arms for the busy session" holding
session "$A" waiting "Session A"
expect "a session waiting for input doesn't hold" released
session "$A" busy "Session A"
expect "busy again re-arms" holding
cli disable >/dev/null
expect "disable releases" released
cli enable >/dev/null
expect "enable re-arms" holding
cli disable 3s >/dev/null
expect "a timed disable releases" released
expect "...and expires on its own" holding

echo "safety limits"
set_fake power "battery 50"
set_fake lid closed
stays "on battery above the floor it keeps going" holding
set_fake power "battery 9"
expect "low battery releases and sleeps" released_and_slept 2
set_fake power "ac 100"
set_fake lid open
expect "re-arms on lid open" holding
set_fake lid closed
sleep 1.2
set_fake thermal 2
stays "heavy thermal pressure (just throttling) keeps going" holding
set_fake thermal 3
expect "trapping thermal pressure releases and sleeps" released_and_slept 3
set_fake thermal 0
set_fake lid open
expect "re-arms on lid open" holding
set_fake display external
set_fake lid closed
sleep 1.2
session "$A" idle "Session A"
expect "with an external display it releases" released
sleep 1.5
slept 3 && pass "...but doesn't sleep the Mac" || fail "...but doesn't sleep the Mac"
set_fake display internal
set_fake lid open

echo "which sessions count"
session "$A" busy "Session A"
expect "busy session holds" holding
kill "$A"
expect "a session whose process died doesn't count" released
spawn; B=$LAST
session "$B" busy "Session B" "Mon Jan 1 00:00:00 2001"
stays "a reused pid (start time mismatch) doesn't count" released
rm -f "$SESSIONS/$B.json"
spawn bash -c 'yes > /dev/null; :'; C=$LAST
session "$C" idle "Session C"
expect "an idle session with a busy child process (background build) holds" holding
pkill -P "$C"
expect "it releases once the child process is done" released

echo "status"
: > "$FAKE/plist"
spawn; D=$LAST
session "$D" busy "Session D"
expect "busy session holds" holding
out=$(cli status)
case $out in *Armed*"Session D"*) pass "status shows armed with the session name" ;;
  *) fail "status shows armed with the session name"; echo "$out" ;; esac

echo "shutdown and restart"
stop_daemon
released && [ ! -e "$FAKE/holding" ] && pass "stopping the daemon re-enables lid sleep" ||
  fail "stopping the daemon re-enables lid sleep"
rm -f "$SESSIONS/$D.json"
set_fake disablesleep 1
: > "$FAKE/holding"
start_daemon
expect "a restarted daemon releases a hold it left behind" released
stop_daemon

echo "time limit"
session "$D" busy "Session D"
start_daemon --max-hours 0.001
expect "busy session holds" holding
set_fake lid closed
expect "after --max-hours with the lid closed it releases and sleeps" released_and_slept 4
stop_daemon

echo "hotspot fallback"
joins() { [ "$(cat "$FAKE/joined" 2>/dev/null | wc -l | tr -d ' ')" = "$1" ]; }
logged() { grep -q "$1" "$FAKE/log"; }
set_fake known "$(printf 'Home WiFi\nKatherine’s iPhone\nTony’s iPhone\nMoxee Hotspot')"
set_fake owner Tony
cli hotspot auto | grep -q "fallback: Tony’s iPhone" && pass "hotspot auto picks the owner's own iPhone" ||
  fail "hotspot auto picks the owner's own iPhone"
set_fake owner Zed
cli hotspot auto >/dev/null 2>&1 && fail "hotspot auto refuses to guess between two strangers' phones" ||
  pass "hotspot auto refuses to guess between two strangers' phones"
set_fake known "$(printf 'Home WiFi\nWork iPhone')"
cli hotspot auto | grep -q "fallback: Work iPhone" && pass "hotspot auto takes the only iPhone there is" ||
  fail "hotspot auto takes the only iPhone there is"
cli hotspot "Tony’s iPhone" | grep -q "hasn't saved" && pass "naming an unsaved network warns" ||
  fail "naming an unsaved network warns"
set_fake known "Tony’s iPhone"
set_fake lid open
set_fake online yes
start_daemon --offline-grace 1
expect "busy session holds" holding
set_fake online no
stays "with the lid open it leaves the Wi-Fi alone" joins 0
set_fake lid closed
expect "offline with the lid closed: joins the hotspot" joins 1
grep -qx "Tony’s iPhone" "$FAKE/joined" && pass "...the configured one" || fail "...the configured one"
out=$(cli status)
case $out in *"trying the hotspot"*) pass "status says it's trying the hotspot" ;;
  *) fail "status says it's trying the hotspot"; echo "$out" ;; esac
set_fake join fail
expect "keeps retrying while still offline" joins 2
expect "...and logs why it failed" logged "couldn't join hotspot"
set_fake online yes
expect "notices when it's back online" logged "back online"
stays "stops trying once online" joins 2
cli hotspot off >/dev/null
set_fake online no
stays "hotspot off: never touches the Wi-Fi" joins 2
stop_daemon

echo
if [ "$fails" = 0 ]; then echo "all passed"; else echo "$fails failed"; echo "--- log"; cat "$FAKE/log"; exit 1; fi
