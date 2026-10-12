# sleep-when-done

Close your MacBook's lid while Claude Code is working. The sessions finish, then the Mac sleeps.
If the internet drops while the lid is closed (you took it with you), it joins your phone's
hotspot so the work keeps going.

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
- **The lid is closed, it's still working, and the internet is gone for 10s** →
  `networksetup -setairportnetwork <wifi> "<hotspot>"`. It retries every 30s while offline.

"Working" means any of these:

- A session is `busy`.
- An idle session's child processes are using ≥25% CPU, for example a background build.
- A transcript was written in the last 90 seconds. This is the grace period between turns.

A session `waiting` for input doesn't count.

The Mac only stays awake with the lid closed if the work was already running when the lid
closed. It never sleeps the Mac while an external display is attached. With the lid closed,
it gives up and sleeps after 3h, at 10% battery, or under heavy thermal pressure.

The hotspot is chosen per Mac. `install` (or `sleep-when-done hotspot auto`) picks a saved
iPhone/iPad network named after the Mac's owner, like "Alex's iPhone". If only one phone
network is saved, it picks that one. Otherwise it leaves the fallback off.

## Install, use, remove

```bash
sudo ./sleep-when-done install         # optional: --max-hours 5 --min-battery 15
sleep-when-done status
sleep-when-done disable [2h]           # enable to turn it back on
sleep-when-done hotspot [auto|off|"Name"]
sleep-when-done log
sudo sleep-when-done uninstall
```

The installer creates:

- `/usr/local/libexec/sleep-when-done`
- the link `/usr/local/bin/sleep-when-done`
- `/Library/LaunchDaemons/local.sleep-when-done.plist`

Your own settings go in `~/Library/Application Support/sleep-when-done/`: the `paused` and
`hotspot` files, so changing them needs no `sudo`.

Emergency reset: `sudo pmset -a disablesleep 0`.

## Tests

```bash
./test.sh
```

The tests run the real daemon loop in fake mode (`SWD_FAKE`):

- Lid, battery, thermal, display, connectivity and saved-network state come from files.
- `pmset` and Wi-Fi joins are recorded instead of run.

No root is needed, and the Mac's real settings are never touched.
