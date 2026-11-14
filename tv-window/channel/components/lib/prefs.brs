' Settings and the weather cache live in the channel registry (shared by the app and screensaver).

function PrefsSection() as Object
    return CreateObject("roRegistrySection", "window")
end function

function LoadPrefs() as Object
    sec = PrefsSection()
    p = { loc: invalid, units: "F", clock: "", layout: "full", bg: "", api: "https://api.open-meteo.com" }
    if sec.Exists("bg") then p.bg = sec.Read("bg")
    if sec.Exists("api") then p.api = sec.Read("api") ' test hook used by the preview harness
    if sec.Exists("loc")
        p.loc = ParseJson(sec.Read("loc"))
    else
        ' First run: adopt the default from the (gitignored) pkg:/local.json and remember it on the TV.
        cfg = LoadLocal()
        if cfg.loc <> invalid
            p.loc = cfg.loc
            sec.Write("loc", FormatJson(cfg.loc))
            sec.Flush()
        end if
    end if
    if sec.Exists("units") then p.units = sec.Read("units")
    if sec.Exists("clock") then p.clock = sec.Read("clock")
    if sec.Exists("layout") then p.layout = sec.Read("layout")
    if p.clock = ""
        p.clock = "12"
        if CreateObject("roDeviceInfo").GetClockFormat() = "24h" then p.clock = "24"
    end if
    return p
end function

sub SavePref(key as String, value as String)
    sec = PrefsSection()
    sec.Write(key, value)
    sec.Flush()
end sub

function CacheKey(loc as Object, units as String) as String
    return Coord(loc.lat) + "," + Coord(loc.lon) + "," + units
end function

sub SaveWeatherCache(key as String, body as String)
    sec = PrefsSection()
    sec.Write("wxKey", key)
    sec.Write("wxBody", body)
    sec.Write("wxAt", NowEpoch().ToStr())
    sec.Flush()
end sub

' Returns { data, at } or invalid.
function LoadWeatherCache(key as String) as Dynamic
    sec = PrefsSection()
    if not sec.Exists("wxKey") or not sec.Exists("wxBody") then return invalid
    if sec.Read("wxKey") <> key then return invalid
    data = ParseJson(sec.Read("wxBody"))
    if data = invalid then return invalid
    at = 0
    if sec.Exists("wxAt") then at = sec.Read("wxAt").ToInt()
    return { data: data, at: at }
end function

' Per-home settings and branding from the gitignored pkg:/local.json ({} when absent).
' Keys: loc {name, region, lat, lon}, title, logo (pkg: uri), logoAspect (width / height),
'       album (a public Google Photos shared-album link).
function LoadLocal() as Object
    ' (roFileSystem isn't allowed on the render thread, so just read; a missing file reads as "".)
    raw = ReadAsciiFile("pkg:/local.json")
    if raw = "" then return {}
    cfg = ParseJson(raw)
    if cfg = invalid then return {}
    return cfg
end function
