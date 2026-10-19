# sleep-when-done

Close your MacBook's lid while Claude Code is working. The sessions finish, then the Mac sleeps.
If you carry it away from Wi-Fi, macOS can move it onto your iPhone's hotspot. Keeping the Mac
awake is what gives macOS that chance; the tool can't make the switch itself (see below).

Live page: **https://tonyxin.com/sites/sleep-when-done/**. It hosts:

- the script
- [`agent.md`](agent.md): step-by-step setup instructions for an AI agent

## Files

| File | What it is |
| --- | --- |
| `sleep-when-done` | The whole tool: one bash script (CLI, installer, and daemon) |
| `agent.md` | Instructions an agent follows to install, check, and configure it |
| `index.html` | The landing page |
| `test.sh` | End-to-end tests |

## How it works

Claude Code writes each session's state (`busy`, `idle`, `waiting`) to
`~/.claude/sessions/<pid>.json`. That covers both desktop-app and terminal sessions.
A root LaunchDaemon checks those files every 5 seconds:

- **Something is working** → `pmset disablesleep 1`, so closing the lid doesn't sleep the Mac.
- **Everything is done** → `pmset disablesleep 0`. If the lid is closed, `pmset sleepnow`.
- **The lid is closed and it's still working** → it checks the internet every 10s and logs when
  it drops and comes back, including whether it came back on an iPhone's hotspot. It never
  changes networks.

"Working" means any of these:

- A session is `busy`.
- An idle session's child processes are using ≥25% CPU, for example a background build.
- A transcript was written in the last 90 seconds. This is the grace period between turns.

A session `waiting` for input doesn't count.

The Mac only stays awake with the lid closed if the work was already running when the lid
closed. It never sleeps the Mac while an external display is attached. With the lid closed,
it gives up and sleeps after 3h, at 10% battery, or at "trapping" thermal pressure. That is macOS's
last step before it sleeps the Mac itself. "Heavy" pressure only means throttling, so it keeps going.

## The hotspot is up to macOS

Earlier versions tried to join the phone's hotspot themselves with
`networksetup -setairportnetwork`. On macOS 26 that can't work, even from the root daemon:

- networksetup hands the join to airportd without the saved password (`hasPassword=0` in the
  system log), so it fails with `Error: -3900`.
- An iPhone stops broadcasting its hotspot a minute or so after its last device leaves. After
  that, nothing finds it by name ("Could not find network").
- Waking it (Instant Hotspot) needs the private entitlement `com.apple.wifi.tether.connect`.
  airportd checks entitlements, not the user ID, so root doesn't help. Only Apple's WiFiAgent
  and airportd itself have it.

macOS can switch by itself. With System Settings → Wi-Fi → *Ask to join hotspots* →
*Automatic*, it wakes and joins your iPhone once the Mac has left every saved Wi-Fi network. It
won't do that while the Mac sleeps (`AutoHotspot not allowed during dark wake` in the system
log), and keeping the Mac awake is the part this tool can do. Limits:

- If the Wi-Fi stays connected but loses its internet, macOS asks before switching, and with
  the lid closed nobody answers.
- It isn't confirmed yet that macOS switches while the lid is closed. The log will show it:
  "lost the internet with the lid closed", then "back online after ..., on a phone's hotspot".

Don't query the setting through CoreWLAN (`-[CWWiFiClient autoHotspotMode]`). On macOS 26.5 it
crashes airportd.

## Install, use, remove

```bash
sudo ./sleep-when-done install         # optional: --max-hours 5 --min-battery 15
sleep-when-done status
sleep-when-done disable [2h]           # enable to turn it back on
sleep-when-done hotspot                # how macOS can switch to your phone's hotspot
sleep-when-done log
sudo sleep-when-done uninstall
```

The installer creates:

- `/usr/local/libexec/sleep-when-done`
- the link `/usr/local/bin/sleep-when-done`
- `/Library/LaunchDaemons/local.sleep-when-done.plist`

Your own setting goes in `~/Library/Application Support/sleep-when-done/paused`, so
disabling and enabling need no `sudo`.

Emergency reset: `sudo pmset -a disablesleep 0`.

## Tests

```bash
./test.sh
```

The tests run the real daemon loop in fake mode (`SWD_FAKE`):

- Lid, battery, thermal, display and connectivity state come from files.
- `pmset` calls are recorded instead of run.

No root is needed, and the Mac's real settings are never touched.
