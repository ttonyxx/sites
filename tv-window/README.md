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
- **Time travel:** press ◀ / ▶ to scrub the sky and forecast through the day. The ↺ Replay key
  returns to now, and so does a minute without input. The TV keeps the Back key for itself, so
  apps never see it.
- **Play Dibs:** press ▼ for a card that puts [Dibs](https://dibsgames.com) party games on the TV:
  open dibsgames.com/tv on a laptop or phone (QR code included) and mirror it with AirPlay. Roku
  has no web engine and no WebSocket client, so Dibs can't run natively without a Roku port.
- **Screensaver:** Window is also a Roku screensaver, so it can appear whenever the TV is idle.

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
     "album": "https://photos.app.goo.gl/…"
   }
   ```

   - `loc` is the first-run location. The TV saves it to its own settings, and you can change it
     later in Settings. Rounded coordinates (2 decimals, about 1 km) are plenty for weather.
   - `title` names the house in Settings.
   - `logo` shows at the top of the dashboard. `npm run logo -- ~/Downloads/logo.png` turns a logo
     on a black background into `channel/local/logo.png` and prints its `logoAspect`.
   - `album` is a public Google Photos shared-album link. The TV re-reads it every 6 hours, so new
     photos show up without reinstalling.
4. **Make it the screensaver** (optional): Home › Settings › Theme › Screensavers › **Window**.

To uninstall, open the TV's installer page (`http://<tv-ip>`) and choose *Delete*, or turn off
Developer Mode.

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
    DibsPanel.*          "Play Dibs" card (art rendered by tools/assets/dibs.mjs)
    AlbumTask.*          reads a shared-album page for its photo URLs
    SettingsPanel.*      slide-in settings with keyboard city search
    FetchTask.*          HTTPS GET on a background thread
    lib/                 sky model, weather mapping, prefs, helpers
  images/ fonts/         generated by tools/assets (Nunito, SIL OFL 1.1)
  local.json, local/     per-home settings and branding (gitignored)
tools/                   assets generator, packager, deploy/watch, browser preview
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
