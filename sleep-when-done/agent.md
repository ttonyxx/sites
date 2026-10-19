# Set up sleep-when-done (instructions for an AI agent)

You are helping someone install **sleep-when-done** on their Mac. With it, they can close the
MacBook lid while Claude Code sessions are working. The Mac stays awake until those sessions
finish, then it goes to sleep. If they take the laptop away from Wi-Fi, macOS itself can move
it onto their iPhone's hotspot. sleep-when-done can't make that switch, but keeping the Mac
awake gives macOS the chance (step 5).

Work through the steps in order. Run the commands yourself, except where a step says the
user must run it.

## 1. Check the Mac

```bash
sw_vers -productVersion        # needs macOS 15 or later
test -x /usr/bin/jq && echo ok # ships with macOS 15+
ls ~/.claude/sessions          # exists once Claude Code has run on this Mac
```

If the Mac is older than macOS 15, or `~/.claude/sessions` doesn't exist, stop and explain why.
It also works on desktop Macs, but there's no lid to close, so it's only useful on a MacBook.

## 2. Download it

```bash
dir=$(mktemp -d) && curl -fsSL https://tonyxin.com/sites/sleep-when-done/sleep-when-done -o "$dir/sleep-when-done" && bash -n "$dir/sleep-when-done" && echo "$dir/sleep-when-done"
```

The script installs a background service that runs as root, so read the script before going
on. It's a single bash file. Tell the user what it does if they ask.

## 3. Install it (the user runs this)

Installing needs the user's admin password, and you must never type a password. Ask the
user to run this themselves, using the path printed in step 2:

```bash
sudo bash /path/from/step-2/sleep-when-done install
```

In Claude Code they can type `!` followed by the command in the prompt box, or run it in a
Terminal window. Wait until they say it's done.

Install creates three things and changes nothing else:

- `/usr/local/libexec/sleep-when-done`: the script
- `/usr/local/bin/sleep-when-done`: the command
- `/Library/LaunchDaemons/local.sleep-when-done.plist`: the background service

## 4. Check that it works

```bash
sleep-when-done status
```

You are a running Claude Code session, so the first line should start with **"Armed"**. Your
session should also be listed as `working`. If the output says the daemon isn't running, run
`sleep-when-done log` and fix what it shows.

## 5. Explain the hotspot fallback

sleep-when-done can't move the Mac onto a phone's hotspot. On macOS 26, only Apple's own Wi-Fi
code may wake an iPhone's hotspot, and `networksetup` won't join a saved network unless it's
given the password, even as root. macOS can switch by itself, but only while the Mac is awake,
and keeping it awake is the part sleep-when-done does.

Tell the user about these settings. Let them change the settings themselves; the Mac one asks
for their password:

- **Mac:** System Settings → Wi-Fi → *Ask to join hotspots* → *Automatic*.
- **iPhone:** signed in to the same Apple Account as the Mac (or in their Family Sharing group),
  with Bluetooth on.

Be clear about the limits:

- macOS only switches once the Mac has left every saved Wi-Fi network. If the Wi-Fi stays
  connected but loses its internet, macOS asks first, and nobody is there to answer.
- It isn't confirmed yet that macOS switches while the lid is closed. After a trip,
  `sleep-when-done log` shows "lost the internet with the lid closed". If macOS switched, the
  next line is "back online after ..., on a phone's hotspot".

Don't try to script the switch with `networksetup` or CoreWLAN. It can't work, and reading the
hotspot setting through CoreWLAN (`autoHotspotMode`) crashes airportd on macOS 26.5.
`sleep-when-done hotspot` prints this explanation for the user.

## 6. Tell the user how to use it

- **Just close the lid.** While a session is working, the Mac stays awake. When everything is
  done, it sleeps.
- `sleep-when-done status`: what it's doing right now
- `sleep-when-done disable`: turn it off (closing the lid sleeps the Mac right away again)
- `sleep-when-done disable 2h`: turn it off for a while
- `sleep-when-done enable`: turn it back on
- `sleep-when-done hotspot`: how macOS can switch to their phone's hotspot
- `sleep-when-done log`: what it did and why, including when the internet dropped
- `sudo sleep-when-done uninstall`: remove it (the user runs this)

While sessions are working, Apple menu → Sleep won't sleep the Mac. To force sleep, run
`sleep-when-done disable` first.

## Later requests

| The user says | Run |
| --- | --- |
| "turn it off" / "disable it" | `sleep-when-done disable` |
| "turn it off for an hour" | `sleep-when-done disable 1h` |
| "turn it back on" / "enable it" | `sleep-when-done enable` |
| "use my hotspot when I leave" | explain step 5; the Mac setting is theirs to change |
| "stop switching to my hotspot" | they set *Ask to join hotspots* to *Ask To Join* or *Never* |
| "did it switch to my hotspot?" | `sleep-when-done log` |
| "is it working?" | `sleep-when-done status` |
| "remove it" | ask the user to run `sudo sleep-when-done uninstall` |
| "update it" | repeat steps 2 and 3; settings are kept |

None of these need `sudo`, except uninstall and install.

## How it decides

- **Counts as working:**
  - A Claude Code session whose status is `busy`.
  - An idle session whose child processes use 25% CPU or more, such as a build it left running.
  - Any transcript written in the last 90 seconds.
- **Doesn't count:** a session waiting for the user's answer, since nobody is there to answer it.
- **Only work already running when the lid closes counts.** If something starts after the lid
  is closed, it won't keep the Mac awake.
- **Safety limits:** with the lid closed, it gives up and sleeps the Mac after 3 hours, at 10%
  battery, or if macOS reports critical heat (thermal pressure "trapping"; "heavy" only
  means it is throttling, which is normal under load). To change the first two, reinstall with
  `--max-hours N` or `--min-battery PCT`.
- **External display:** with one attached (clamshell mode), it never sleeps the Mac.
- **Internet:** with the lid closed, it checks the connection every 10 seconds and logs when it
  drops and comes back. It never changes Wi-Fi networks.
- **Emergency reset:** `sudo pmset -a disablesleep 0` always restores normal lid sleep.

Source: https://github.com/ttonyxx/sites/tree/main/sleep-when-done
