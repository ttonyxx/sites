# Window: a custom home screen for a Roku TV

**Window** is a sideloaded Roku channel for the living-room TV, a 58" Hisense Roku TV. It turns
the TV into an ambient dashboard:

- **A live sky.** The background follows the real time of day: night, blue hour, dawn, midday,
  golden hour and dusk. The sun arcs across the screen between the actual sunrise and sunset.
  Stars come out at night and clouds drift across when it's cloudy. Rain darkens the sky and fog
  flattens it.
- **Your photos.** Optionally rotates a public Google Photos shared album. Portrait shots are shown
  in pairs, and Google smart-crops each one to fit. When photos are on, the clock and weather move
  into a solid panel on the left so text never sits on a photo.
- **Clock and date** in large type, with a greeting and an optional house logo.
- **Weather:** current conditions, the next 8 hours and the next 5 days, from
  [Open-Meteo](https://open-meteo.com) (free, no API key).
- **Settings:** press ✱ on the remote to set the city (on-screen search), the background
  (Photos / Photos + sky / Sky), °F/°C, 12/24-hour clock and Full/Minimal layout.
- **Time travel:** press ⏪ / ⏩ to scrub the sky and forecast through the day. The ↺ Replay key
  returns to now, and so does a minute without input. ⏯ toggles the minimal layout. The TV keeps the Back key for itself, so
  apps never see it.
- **App dock:** always on screen, Dibs and Spotify to start with. ◀ ▶ (or ▼ / OK) select an app, OK
  opens it, ▲ leaves. Roku won't let a channel launch other apps, so Roku apps (like Spotify) are opened
  through the home streamer, which sends the TV an ECP `launch`. Add more with `apps` in `local.json`.
- **Host Dibs:** the Dibs tile hosts a [Dibs](https://dibsgames.com) party game on the TV. Pick a game,
  and the TV shows the room (QR code, players, the whole game) while everyone plays on their phones.
  The Replay key goes back to Window and *parks* the game: the room keeps running, the Dibs tile shows
  LIVE, and "Back to <game>" returns to it, even after you leave Window for up to 15 minutes. ✱ on
  that button ends the room. See *Hosting Dibs on the TV* below. Without a streamer, the tile shows
  AirPlay instructions instead.
- **Stays on screen:** while Window is open it loops a tiny silent video, so the Roku screensaver never
  starts. The home streamer also opens Window when the TV turns on, or after it sits on the Roku home
  screen or screensaver for 3 minutes (`AUTO_OPEN=0` / `HOME_IDLE_MINUTES` on the streamer).
- **Screensaver:** Window is also a Roku screensaver (Settings › Theme › Screensavers), as a fallback.

This folder is not a website. It has no `index.html` or top-level `package.json`, so
`scripts/build-sites.mjs` skips it.

## Why a channel and not a new launcher?

Roku OS doesn't allow replacing the home screen, and current Roku OS has no public root
exploit. The supported route is **Developer Mode**, which lets you install one of your own
channels. Roku also blocks a channel from controlling its own TV: requests to the TV's control port (ECP)
from inside a channel get `403 ECP is not allowed from loopback address`. So Window can't launch
Netflix or other apps by itself. ECP `launch` from another device on the Wi-Fi does work, even in
the TV's default "Limited" mode, so an app row would need a small always-on helper on the LAN.

## Install on the TV

1. **Turn on Developer Mode** (once). On the Roku remote press
   **Home ×3, Up ×2, Right, Left, Right, Left, Right**. Choose *Enable installer and restart*,
   accept the license, and set a password. The username is always `rokudev`.
2. **Install:**

   ```bash
   cd tv-window/tools && npm install && npm run deploy
   ```

   This packages `channel/`, finds the TV on the network, asks for the developer password at a
   hidden prompt, installs, and saves a screenshot from the TV to `tools/dist/screenshot.jpg`.
   `npm run dev` does the same, then reinstalls every time a file in `channel/` changes.
3. **Per-home settings** (optional): create `channel/local.json`. Git ignores this file and
   `channel/local/`, so they're packaged onto the TV but never committed. All keys are optional:

   ```json
   {
     "loc": { "name": "Chicago", "region": "Illinois, US", "lat": 41.88, "lon": -87.63 },
     "title": "Our House",
     "logo": "pkg:/local/logo.png",
     "logoAspect": 1.0,
     "album": "https://photos.app.goo.gl/…",
     "dibsStreamer": "http://192.168.1.20:8790",
     "apps": [{ "kind": "dibs", "name": "Dibs" }, { "id": "22297", "name": "Spotify", "color": "0x1DB954FF" }]
   }
   ```

   - `loc` is the first-run location. The TV saves it to its own settings, and you can change it
     later in Settings. Rounded coordinates (2 decimals, about 1 km) are plenty for weather.
   - `title` names the house in Settings.
   - `logo` shows at the top of the dashboard. `npm run logo -- ~/Downloads/logo.png` turns a logo
     on a black background into `channel/local/logo.png` and prints its `logoAspect`.
   - `album` is a public Google Photos shared-album link. The TV re-reads it every 6 hours, so new
     photos show up without reinstalling.
   - `dibsStreamer` pins a streamer address, if discovery can't find one (see *Hosting Dibs on the TV*).
   - `apps` replaces the dock's apps. Each entry needs `name`, plus `id` (a Roku channel id) or
     `"kind": "dibs"`. Optional: `color` (`0xRRGGBBFF`) and `icon` (a `pkg:` image).
4. **Make it the screensaver** (optional): Home › Settings › Theme › Screensavers › **Window**.

To uninstall, open the TV's installer page (`http://<tv-ip>`) and choose *Delete*, or turn off
Developer Mode.

## Hosting Dibs on the TV

Roku has no web engine and no WebSocket client, so it can't run the Dibs web app. But Dibs's
`/tv` screen takes no input (everyone plays on their phones), so **`tools/streamer/streamer.mjs`**
runs it in headless Chrome and streams it to the TV as live video (HLS):

**On a Mac that stays on at home**, install it as a background service (it starts at login and
restarts itself; re-run to update, or add `-s -- --uninstall` to remove it):

```bash
curl -fsSL https://raw.githubusercontent.com/ttonyxx/sites/main/tv-window/tools/streamer/install-mac.sh | bash
```

To try it from a checkout instead: `cd tv-window/tools && node streamer/streamer.mjs`.

The streamer answers SSDP searches (`urn:tonyxin-com:service:dibs-tv-streamer:1`), so Window finds
it on the Wi-Fi by itself. `"dibsStreamer": "http://ip:8790"` in `local.json` is only a fallback.
Pick a game on the TV, and the streamer opens dibsgames.com/tv, clicks that game, and streams the room.
It keeps the Mac awake only while a room is running. It stops a room after 15 minutes with no word
from the TV (`IDLE_MINUTES`).

The same service relays app launches: `POST /launch?app=<roku channel id>` sends the TV that asked
an ECP `launch` (allowed in "Limited" mode). That's how the dock opens Spotify (channel `22297`).

- **Deep link:** `curl -X POST "http://<tv-ip>:8060/launch/dev?dibs=punchline"` starts Window and
  hosts that game right away. This works in the TV's default "Limited" control mode. Game ids:
  `punchline`, `imposter`, `tee-party`, `brawl`, `piggyback`, `pirates`.
- **Trade-offs:** the TV runs a few seconds behind the phones (HLS buffering), and the stream is
  currently silent (Dibs's TV music isn't captured yet). The machine running the streamer has to
  stay on. Hosting it in the cloud next to the Dibs backend removes that requirement.

## Develop without the TV

```bash
cd tv-window/tools
npm run preview      # http://localhost:8787/?seed=47.6062,-122.3321,Seattle
npm run lint         # BrighterScript checks the BrightScript and SceneGraph XML
npm run assets       # regenerates every image in channel/images and copies the fonts
```

The preview runs the real channel zip in [brs-engine](https://github.com/lvcabral/brs-engine), a
Roku simulator that runs in the browser. Query parameters:
- `seed=lat,lon,Name` presets the city.
- `mock=clear|partly|overcast|rain|snow|storm|fog` swaps in a fake forecast.
- `clear=1` wipes the simulated settings.

Keyboard: arrows, Enter = OK, Escape = Back. The buttons under the screen include ✱.

## Layout

```
channel/                 the Roku package (zipped as-is)
  manifest
  source/main.brs        Main() and RunScreenSaver()
  components/
    MainScene.*          dashboard: full and panel layouts, weather, hints, time travel, screensaver drift
    Sky.*                layered sky: gradient, sun/moon glow, stars, drifting clouds, tweens
    Photos.*             album rotation: portrait pairs, crossfades, slow zoom
    DibsPanel.*          "Play Dibs": game picker + stream player, or the AirPlay card
                         (art rendered by tools/assets/dibs.mjs)
    AlbumTask.*          reads a shared-album page for its photo URLs
    DiscoverTask.*       finds the home streamer on the LAN (SSDP)
    SettingsPanel.*      slide-in settings with keyboard city search
    FetchTask.*          HTTPS GET on a background thread
    lib/                 sky model, weather mapping, prefs, helpers
  images/ fonts/         generated by tools/assets (Nunito, SIL OFL 1.1)
  local.json, local/     per-home settings and branding (gitignored)
tools/                   assets generator, packager, deploy/watch, browser preview
  streamer/              Dibs TV streamer (headless Chrome -> ffmpeg -> HLS)
```

## Roku gotchas found on the real TV

- `roFileSystem` can't be created on the render thread, so the app just calls `ReadAsciiFile` and
  treats an empty result as "missing".
- Fetch `photos.app.goo.gl` links with Roku's own User-Agent. With a desktop-browser UA, Google
  serves an interstitial page instead of redirecting.
- The developer-installer screenshot can come back black even while the app renders fine (it
  happened with the panel layout). Check the TV itself before debugging.
- The debug console (`nc <tv-ip> 8085`) and debug server (`nc <tv-ip> 8080`: `chanperf`,
  `sgnodes <id>`, `r2d2_bitmaps`) need no password in Developer Mode.

Credits: weather data by Open-Meteo.com (CC BY 4.0) · Nunito typeface by Vernon Adams and others (SIL OFL 1.1).
