# sleep-when-done

Close your MacBook's lid while Claude Code is working. The sessions finish, then the Mac sleeps.

Normally a closed lid sleeps the Mac at once. The Claude app's "keep awake while working"
setting can't stop that: it only blocks *idle* sleep.

## How it works

Claude Code writes each session's state (`busy`, `idle`, or `waiting` for input) to
`~/.claude/sessions/<pid>.json`. That covers both desktop-app and terminal sessions.
A small root LaunchDaemon checks those files every 5 seconds:

- **Something is working** → `pmset disablesleep 1`, so closing the lid doesn't sleep the Mac.
- **Everything is done** → `pmset disablesleep 0`. If the lid is closed, `pmset sleepnow`.

"Working" means any of these:

- A session is `busy`.
- An idle session's child processes are using ≥25% CPU, for example a build Claude left running in the background.
- A transcript was written in the last 90 seconds. This is a grace period between turns.

A session that is `waiting` for your answer doesn't count. Nobody is there to answer it.

### Safety limits

With the lid closed, it gives up and sleeps the Mac if any of these happen:

- 3 hours pass. Change it with `--max-hours`.
- The battery hits 10%. Change it with `--min-battery`.
- macOS reports heavy thermal pressure, for example a laptop running in a bag.

### Other rules

- It only keeps a closed Mac awake if the work was already running when you closed the lid.
  A session that wakes up later never keeps a closed Mac awake.
- With an external display attached (clamshell mode), it never sleeps the Mac.
- If the daemon stops for any reason, it turns normal lid sleep back on first.

## Install

One time, from this folder:

```bash
sudo ./sleep-when-done install
```

This installs:

- the script at `/usr/local/libexec/sleep-when-done`
- a link at `/usr/local/bin/sleep-when-done`
- the LaunchDaemon `/Library/LaunchDaemons/local.sleep-when-done.plist`

To change the limits, run install again with flags:
`sudo ./sleep-when-done install --max-hours 5 --min-battery 15`.

## Use

Just close the lid. To see what it's doing:

```
$ sleep-when-done status
Armed. Close the lid and the Mac stays awake until this finishes, then sleeps.
  working: Badges for tagging, Light score loading performance

Sessions
  working   Badges for tagging
  working   Light score loading performance
  waiting   Beli ratings import  (needs your input; does not keep the Mac awake)
  18 idle
```

| Command | What it does |
| --- | --- |
| `sleep-when-done status` | Current state, plus every live session |
| `sleep-when-done pause [45m\|2h]` | Lid sleeps normally until you resume, or for the given time |
| `sleep-when-done resume` | Turn it back on |
| `sleep-when-done log [-f]` | What it did and why |
| `sudo sleep-when-done uninstall` | Remove everything and restore normal lid sleep |

While sessions are working, **Apple menu → Sleep** won't sleep the Mac either. To force sleep,
run `sleep-when-done pause` and then sleep it.

If something ever goes wrong, run `sudo pmset -a disablesleep 0`. That always restores normal lid sleep.

## Tests

```bash
./test.sh
```

The tests run the real daemon loop in fake mode. Lid, battery, thermal and display state come
from files, and `pmset` calls are recorded instead of run. No root is needed, and the Mac's
real settings are never touched.
