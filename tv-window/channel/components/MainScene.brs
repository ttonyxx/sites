' Window dashboard: clock, current weather, hourly + 5-day forecast over a live sky or a photo album.
'
' Two layouts:
'   "full"  - sky background; clock top-left, weather top-right, forecast cards along the bottom.
'   "panel" - photo background; everything stacked in a solid left panel so text never sits on a photo,
'             and the photos get the rest of the screen untouched.

sub init()
    m.top.backgroundColor = "0x060A18FF"
    m.top.backgroundUri = ""
    m.LEFT = 128
    m.RIGHT = 1792
    m.PANEL_W = 680

    m.sky = m.top.findNode("sky")
    m.photos = m.top.findNode("photos")
    m.scrim = m.top.findNode("scrim")
    m.content = m.top.findNode("content")
    m.status = m.top.findNode("status")
    m.fades = {}
    m.prefs = LoadPrefs()
    m.local = LoadLocal()
    m.data = invalid
    m.dataAt = 0
    m.vm = invalid
    m.wxTask = invalid
    m.albumTask = invalid
    m.failures = 0
    m.timeShift = 0
    m.lastMinute = -1
    m.layoutMode = ""

    m.f = {
        ' full layout
        clock: MakeFont("ExtraLight", 224)
        ampm: MakeFont("Regular", 54)
        date: MakeFont("Regular", 46)
        greeting: MakeFont("SemiBold", 34)
        temp: MakeFont("Light", 160)
        place: MakeFont("SemiBold", 34)
        cond: MakeFont("SemiBold", 40)
        detail: MakeFont("Regular", 30)
        small: MakeFont("Regular", 26)
        colHead: MakeFont("SemiBold", 28)
        colTemp: MakeFont("Regular", 38)
        colLo: MakeFont("Regular", 30)
        pop: MakeFont("SemiBold", 23)
        status: MakeFont("Regular", 23)
        hint: MakeFont("Regular", 26)
        ' panel layout
        pClock: MakeFont("ExtraLight", 150)
        pAmpm: MakeFont("Regular", 40)
        pDate: MakeFont("Regular", 34)
        pGreeting: MakeFont("SemiBold", 30)
        pSection: MakeFont("SemiBold", 22)
        pTemp: MakeFont("Light", 88)
        pCond: MakeFont("SemiBold", 28)
        pDetail: MakeFont("Regular", 24)
        pSmall: MakeFont("Regular", 22)
        pColHead: MakeFont("SemiBold", 21)
        pColTemp: MakeFont("Regular", 26)
        pColLo: MakeFont("Regular", 22)
        pPop: MakeFont("SemiBold", 18)
        pStatus: MakeFont("Regular", 19)
    }

    buildHints()
    buildToast()

    m.settings = m.top.findNode("settings")
    m.settings.observeField("changed", "onSettingChanged")
    m.settings.observeField("closed", "onSettingsClosed")
    m.dibs = m.top.findNode("dibs")
    m.dibs.observeField("closed", "onSettingsClosed")
    m.streamer = ""
    if m.local.dibsStreamer <> invalid then m.streamer = m.local.dibsStreamer
    m.dibs.streamer = m.streamer
    m.apps = DefaultApps()
    m.dibs.observeField("live", "renderDockBadge")
    m.dibs.observeField("parked", "onDibsParked")
    m.dockBadge = invalid
    if m.local.apps <> invalid then m.apps = m.local.apps
    m.dockFocus = -1
    m.dockRing = invalid
    m.discoverTask = invalid

    observeTimer("tick", "onTick", true)
    observeTimer("refresh", "fetchWeather", true)
    observeTimer("retry", "fetchWeather", false)
    observeTimer("hintTimer", "hideHints", false)
    observeTimer("toastTimer", "hideToast", false)
    observeTimer("driftTimer", "onDrift", false)
    observeTimer("albumTimer", "loadAlbum", true)
    observeTimer("travelTimer", "endTimeTravel", false)
    observeTimer("discoverTimer", "discoverStreamer", true)
    observeTimer("dockIdle", "leaveDock", false)

    loadCachedWeather()
    buildLayout()
    applyBackground()
    loadAlbum()
    discoverStreamer()
    onTick()
    fetchWeather()
    showHints()
    m.top.setFocus(true)
    m.top.signalBeacon("AppLaunchComplete") ' tells Roku OS the UI is ready
end sub

sub observeTimer(id as String, handler as String, start as Boolean)
    t = m.top.findNode(id)
    t.observeField("fire", handler)
    if start then t.control = "start"
end sub

' ---- building the screen ------------------------------------------------------------------

' (Re)builds the clock / weather / forecast nodes for the layout that suits the background.
sub buildLayout()
    mode = "full"
    if BackgroundMode() <> "sky" then mode = "panel"
    if mode = m.layoutMode then return
    m.layoutMode = mode
    for each id in ["panelBg", "header", "clock", "now", "cards", "dock"]
        g = m.top.findNode(id)
        g.removeChildrenIndex(g.getChildCount(), 0)
    end for
    m.fades = {}
    m.top.findNode("cards").opacity = 1

    if mode = "panel"
        buildPanel()
        m.scrim.visible = false
        m.photos.areaX = m.PANEL_W
        m.photos.areaW = 1920 - m.PANEL_W
        m.photos.dim = 0.04
        m.status.font = m.f.pStatus
        m.status.color = White(0.42)
        m.top.findNode("hints").translation = [m.PANEL_W + 64, 990]
    else
        buildFull()
        m.scrim.visible = true
        m.photos.areaX = 0
        m.photos.areaW = 1920
        m.photos.dim = 0.3
        m.status.font = m.f.status
        m.status.color = White(0.5)
        m.top.findNode("hints").translation = [m.LEFT - 24, 970]
    end if

    buildDock()
    m.lastMinute = -1
    renderWeather()
    renderClock(ClockNow())
    applyLayout(false)
end sub

sub buildFull()
    if m.local.logo <> invalid
        h = 176
        w = h * LogoAspect()
        AddPoster(m.top.findNode("header"), m.local.logo, (1920 - w) / 2, 44, w, h)
    end if

    g = m.top.findNode("clock")
    m.greeting = AddLabel(g, m.f.greeting, White(0.78), m.LEFT, 104)
    m.time = AddLabel(g, m.f.clock, White(1), m.LEFT - 10, 120)
    m.ampm = AddLabel(g, m.f.ampm, White(0.85), 0, 0)
    m.date = AddLabel(g, m.f.date, White(0.9), m.LEFT, 392)
    m.clockGeom = { y: 120, size: 224, ampmSize: 54 }

    g = m.top.findNode("now")
    m.place = AddLabel(g, m.f.place, White(0.85), 0, 108)
    m.wxIcon = AddPoster(g, "", 0, 172, 150, 150)
    m.temp = AddLabel(g, m.f.temp, White(1), 0, 142)
    m.cond = AddLabel(g, m.f.cond, White(0.95), 0, 344)
    m.details = AddLabel(g, m.f.detail, White(0.75), 0, 400)
    m.sun = AddLabel(g, m.f.small, White(0.6), 0, 446)

    g = m.top.findNode("cards")
    hourlySpec = { h: 292, headY: 50, iconY: 94, iconS: 76, popY: 172, tempY: 202, loY: -1, head: m.f.colHead, temp: m.f.colTemp, lo: m.f.colLo, pop: m.f.pop, bg: "0x0A1226FF", bgA: 0.44, edgeA: 0.16 }
    dailySpec = { h: 292, headY: 34, iconY: 78, iconS: 76, popY: 156, tempY: 186, loY: 230, head: m.f.colHead, temp: m.f.colTemp, lo: m.f.colLo, pop: m.f.pop, bg: "0x0A1226FF", bgA: 0.44, edgeA: 0.16 }
    m.hourly = buildCard(g, m.LEFT, 664, 1004, 8, hourlySpec)
    m.daily = buildCard(g, 1172, 664, m.RIGHT - 1172, 5, dailySpec)
end sub

sub buildPanel()
    W = m.PANEL_W
    X = 72
    bg = m.top.findNode("panelBg")
    r = bg.CreateChild("Rectangle")
    r.width = W
    r.height = 1080
    r.color = "0x0A0F1CFF"
    r.opacity = 0.94
    edge = AddPoster(bg, "pkg:/images/fade_h.png", W, 0, 96, 1080)
    edge.blendColor = "0x0A0F1CFF"
    edge.opacity = 0.94

    if m.local.logo <> invalid
        AddPoster(m.top.findNode("header"), m.local.logo, X - 4, 44, 124 * LogoAspect(), 124)
    end if

    g = m.top.findNode("clock")
    m.greeting = AddLabel(g, m.f.pGreeting, White(0.72), X, 192)
    m.time = AddLabel(g, m.f.pClock, White(1), X - 7, 220)
    m.ampm = AddLabel(g, m.f.pAmpm, White(0.85), 0, 0)
    m.date = AddLabel(g, m.f.pDate, White(0.9), X, 396)
    m.clockGeom = { y: 220, size: 150, ampmSize: 40 }

    g = m.top.findNode("now")
    m.place = AddLabel(g, m.f.pSection, White(0.5), X, 464)
    m.wxIcon = AddPoster(g, "", X - 4, 510, 84, 84)
    m.temp = AddLabel(g, m.f.pTemp, White(1), X + 92, 490)
    m.cond = AddLabel(g, m.f.pCond, White(0.95), 0, 502)
    m.details = AddLabel(g, m.f.pDetail, White(0.72), 0, 542)
    m.sun = AddLabel(g, m.f.pSmall, White(0.55), 0, 576)

    g = m.top.findNode("cards")
    hourlySpec = { h: 140, headY: 16, iconY: 46, iconS: 50, popY: -1, tempY: 98, loY: -1, head: m.f.pColHead, temp: m.f.pColTemp, lo: m.f.pColLo, pop: m.f.pPop, bg: "0xFFFFFFFF", bgA: 0.06, edgeA: 0.1 }
    dailySpec = { h: 196, headY: 16, iconY: 46, iconS: 50, popY: 158, tempY: 98, loY: 128, head: m.f.pColHead, temp: m.f.pColTemp, lo: m.f.pColLo, pop: m.f.pPop, bg: "0xFFFFFFFF", bgA: 0.06, edgeA: 0.1 }
    m.hourly = buildCard(g, X - 16, 640, W - 2 * (X - 16), 6, hourlySpec)
    m.daily = buildCard(g, X - 16, 796, W - 2 * (X - 16), 5, dailySpec)
end sub

function LogoAspect() as Float
    if m.local.logoAspect <> invalid then return m.local.logoAspect
    return 1.0
end function

' A frosted card with n evenly spaced forecast columns. spec sets the card height, row positions and fonts;
' a negative row position leaves that row out.
function buildCard(parent as Object, x as Float, y as Float, w as Float, n as Integer, spec as Object) as Object
    card = parent.CreateChild("Group")
    card.translation = [x, y]
    bg = AddPoster(card, "pkg:/images/card.9.png", 0, 0, w, spec.h)
    bg.blendColor = spec.bg
    bg.opacity = spec.bgA
    edge = AddPoster(card, "pkg:/images/card_edge.9.png", 0, 0, w, spec.h)
    edge.opacity = spec.edgeA
    pad = 14
    colW = (w - pad * 2) / n
    cols = []
    for i = 0 to n - 1
        cx = pad + i * colW
        c = {}
        c.head = AddLabel(card, spec.head, White(0.68), cx, spec.headY)
        c.icon = AddPoster(card, "", cx + (colW - spec.iconS) / 2, spec.iconY, spec.iconS, spec.iconS)
        if spec.popY >= 0 then c.pop = AddLabel(card, spec.pop, "0x8CCBFFFF", cx, spec.popY)
        c.temp = AddLabel(card, spec.temp, White(1), cx, spec.tempY)
        if spec.loY >= 0 then c.lo = AddLabel(card, spec.lo, White(0.55), cx, spec.loY)
        for each k in ["head", "temp", "lo", "pop"]
            if c[k] <> invalid
                c[k].width = colW
                c[k].horizAlign = "center"
            end if
        end for
        cols.Push(c)
    end for
    return { node: card, cols: cols }
end function

sub buildHints()
    g = m.top.findNode("hints")
    pill = AddPoster(g, "pkg:/images/pill.9.png", 0, 0, 100, 64)
    pill.blendColor = "0x0A0F1CFF"
    pill.opacity = 0.72
    m.hintItems = []
    x = 24
    for each item in [["key_star", 60, "Settings"], ["key_ok", 72, "Minimal"], ["key_lr", 76, "Time travel"], ["key_down", 60, "Apps"]]
        AddPoster(g, "pkg:/images/" + item[0] + ".png", x, 13, item[1] * 0.8, 48 * 0.8)
        l = AddLabel(g, m.f.hint, White(0.8), x + item[1] * 0.8 + 14, 15)
        l.text = item[2]
        m.hintItems.Push(l)
        x = x + item[1] * 0.8 + 14 + TextWidth(l) + 40
    end for
    pill.width = x - 16
    m.hintLayout = m.hintItems[1]
end sub

sub buildToast()
    g = m.top.findNode("toast")
    bg = AddPoster(g, "pkg:/images/pill.9.png", 0, 0, 420, 64)
    bg.blendColor = "0x0A1226FF"
    bg.opacity = 0.72
    m.toastLabel = AddLabel(g, m.f.hint, White(0.95), 0, 16)
    m.toastBg = bg
end sub

' ---- clock + sky (every second; real work once a minute) ---------------------------------

function ClockNow() as Integer
    return NowEpoch() + m.timeShift
end function

sub onTick()
    now = ClockNow()
    minute = now \ 60
    if minute = m.lastMinute then return
    first = m.lastMinute < 0
    m.lastMinute = minute
    renderClock(now)
    renderWeather()
    if first then updateSky(0) else updateSky(8)
end sub

sub renderClock(now as Integer)
    dt = CreateObject("roDateTime")
    dt.FromSeconds(now)
    dt.ToLocalTime()
    use24h = m.prefs.clock = "24"
    t = FormatTime(dt, use24h)
    if use24h
        m.time.text = t
        m.ampm.text = ""
    else
        parts = t.Split(" ")
        m.time.text = parts[0]
        m.ampm.text = parts[1]
    end if
    ' Sit AM/PM on the clock's baseline (Nunito's ascent is 1.011 em).
    cg = m.clockGeom
    m.ampm.translation = [m.time.translation[0] + TextWidth(m.time) + 12, cg.y + (cg.size - cg.ampmSize) * 1.011]
    m.date.text = WeekdayName(dt, false) + ", " + MonthName(dt) + " " + dt.GetDayOfMonth().ToStr()

    h = dt.GetHours()
    g = "Good night"
    if h >= 5 and h < 12 then g = "Good morning"
    if h >= 12 and h < 17 then g = "Good afternoon"
    if h >= 17 and h < 22 then g = "Good evening"
    m.greeting.text = g
end sub

sub updateSky(duration as Float)
    now = ClockNow()
    sunrise = 0 : sunset = 0 : cloud = 0.0 : code = -1
    if m.vm <> invalid
        sunrise = m.vm.sunrise : sunset = m.vm.sunset : cloud = m.vm.cloud : code = m.vm.code
    end if
    if sunrise <= 0 or sunset <= sunrise
        d = DefaultSunTimes(now)
        sunrise = d.sunrise : sunset = d.sunset
    end if
    m.sky.duration = duration
    m.sky.state = SkyState(now, sunrise, sunset, cloud, code)
end sub

' ---- weather ---------------------------------------------------------------------------------

sub loadCachedWeather()
    m.data = invalid
    m.dataAt = 0
    if m.prefs.loc = invalid then return
    c = LoadWeatherCache(CacheKey(m.prefs.loc, m.prefs.units))
    if c = invalid then return
    m.data = c.data
    m.dataAt = c.at
end sub

sub fetchWeather()
    if m.prefs.loc = invalid then return
    if m.wxTask <> invalid then return
    m.wxTask = CreateObject("roSGNode", "FetchTask")
    m.wxTask.url = WeatherUrl(m.prefs.loc, m.prefs.units, m.prefs.api)
    m.wxTask.observeField("result", "onWeatherResult")
    m.wxTask.control = "RUN"
    m.wxKey = CacheKey(m.prefs.loc, m.prefs.units)
    print "[window] fetching weather for "; m.prefs.loc.name
    renderStatus()
end sub

sub onWeatherResult()
    r = m.wxTask.result
    m.wxTask = invalid
    if m.prefs.loc = invalid then return
    if m.wxKey <> CacheKey(m.prefs.loc, m.prefs.units)
        fetchWeather() ' settings changed mid-flight
        return
    end if
    good = false
    if r.ok
        if r.data.current <> invalid then good = true
    end if
    print "[window] weather response "; r.code; " ok="; good
    if good
        m.data = r.data
        m.dataAt = NowEpoch()
        m.failures = 0
        SaveWeatherCache(m.wxKey, r.body)
        renderWeather()
        updateSky(4)
    else
        m.failures = m.failures + 1
        retry = m.top.findNode("retry")
        delay = 60 * m.failures
        if delay > 900 then delay = 900
        retry.duration = delay
        retry.control = "start"
        renderWeather()
    end if
end sub

sub renderWeather()
    m.vm = WeatherModel(m.data, ClockNow(), m.prefs.clock = "24")
    vm = m.vm
    cards = m.top.findNode("cards")
    if m.prefs.loc = invalid
        setNow("No city set", "", "", "Choose your city", "Press  *  for Settings", "")
        cards.visible = false
    else if vm = invalid
        msg = "Loading weather" + Chr(8230)
        subline = ""
        if m.failures > 0
            msg = "Weather unavailable"
            subline = "Retrying in a few minutes"
        end if
        setNow(m.prefs.loc.name, "", "", msg, subline, "")
        cards.visible = false
    else
        details = vm.details
        if m.layoutMode = "panel" then details = vm.hilo
        setNow(m.prefs.loc.name, vm.temp, vm.icon, vm.label, details, vm.sun)
        fillCard(m.hourly, vm.hourly, false)
        fillCard(m.daily, vm.daily, true)
        cards.visible = true
    end if
    renderStatus()
end sub

sub setNow(place as String, temp as String, icon as String, cond as String, details as String, sun as String)
    m.temp.text = temp
    m.wxIcon.uri = icon
    m.wxIcon.visible = icon <> ""
    m.cond.text = cond
    m.details.text = details
    m.sun.text = sun
    if m.layoutMode = "panel"
        ' Section label, then [icon][temp][condition / hi-lo / sunset] in one row.
        m.place.text = UCase(place)
        x = m.temp.translation[0] + TextWidth(m.temp) + 22
        y = 502
        if temp = ""
            x = 72
            y = 500
        end if
        m.cond.translation = [x, y]
        m.details.translation = [x, y + 40]
        m.sun.translation = [x, y + 74]
        return
    end if
    R = m.RIGHT
    m.place.text = place
    PlaceRight(m.place, R, 108)
    PlaceRight(m.temp, R + 6, 142)
    m.wxIcon.translation = [m.temp.translation[0] - 168, 168]
    condY = 344
    if temp = "" then condY = 170
    PlaceRight(m.cond, R, condY)
    PlaceRight(m.details, R, condY + 56)
    PlaceRight(m.sun, R, condY + 102)
end sub

sub fillCard(card as Object, items as Object, isDaily as Boolean)
    for i = 0 to card.cols.Count() - 1
        c = card.cols[i]
        it = invalid
        if i < items.Count() then it = items[i]
        head = "" : temp = "" : lo = "" : pop = "" : icon = ""
        if it <> invalid
            icon = it.icon
            pop = it.pop
            if isDaily
                head = it.day : temp = it.hi : lo = it.lo
            else
                head = it.time : temp = it.temp
            end if
        end if
        c.head.text = head
        c.temp.text = temp
        c.icon.uri = icon
        if c.lo <> invalid then c.lo.text = lo
        if c.pop <> invalid then c.pop.text = pop
    end for
end sub

sub renderStatus()
    s = ""
    if m.dataAt > 0
        dt = CreateObject("roDateTime")
        dt.FromSeconds(m.dataAt)
        dt.ToLocalTime()
        age = NowEpoch() - m.dataAt
        s = "Updated " + FormatTime(dt, m.prefs.clock = "24")
        if age > 3 * 3600 then s = "Offline " + Chr(183) + " last updated " + FormatTime(dt, m.prefs.clock = "24")
        s = "Weather by Open-Meteo.com   " + s
    else if m.prefs.loc <> invalid
        s = "Weather by Open-Meteo.com"
    end if
    if m.timeShift <> 0 then s = ""
    m.status.text = s
    if m.layoutMode = "panel"
        m.status.width = 0
        m.status.translation = [72, 1012]
    else
        PlaceRight(m.status, m.RIGHT, 988)
    end if
end sub

' ---- photo album ---------------------------------------------------------------------------

sub loadAlbum()
    if m.local.album = invalid or m.albumTask <> invalid then return
    m.albumTask = CreateObject("roSGNode", "AlbumTask")
    m.albumTask.url = m.local.album
    m.albumTask.observeField("result", "onAlbumResult")
    m.albumTask.control = "RUN"
end sub

sub onAlbumResult()
    r = m.albumTask.result
    m.albumTask = invalid
    if r.ok then m.photos.photos = r.photos
end sub

' Background: "photos" (album rotation), "mix" (album with the live sky every third slot) or "sky".
' Time travel always shows the sky, since that's what it scrubs through.
function BackgroundMode() as String
    bg = m.prefs.bg
    if bg = ""
        bg = "sky"
        if m.local.album <> invalid then bg = "photos"
    end if
    if m.local.album = invalid then bg = "sky"
    return bg
end function

sub applyBackground()
    bg = BackgroundMode()
    m.photos.mix = bg = "mix"
    m.photos.active = bg <> "sky" and m.timeShift = 0
end sub

' ---- layout, hints, toast ---------------------------------------------------------------------

sub applyLayout(animate as Boolean)
    full = m.prefs.layout <> "minimal"
    target = 0.0
    if full then target = 1.0
    d = 0.0
    if animate then d = 0.6
    Fade(m.top.findNode("cards"), target, d)
    Fade(m.details, target, d)
    Fade(m.sun, target, d)
    if full then m.hintLayout.text = "Minimal" else m.hintLayout.text = "Full view"
end sub

sub Fade(node as Object, target as Float, duration as Float)
    if duration <= 0
        node.opacity = target
        return
    end if
    if node.id = "" then node.id = "fade" + m.fades.Count().ToStr()
    anim = m.fades[node.id]
    if anim = invalid
        anim = node.getParent().CreateChild("Animation")
        anim.easeFunction = "inOutQuad"
        interp = anim.CreateChild("FloatFieldInterpolator")
        interp.key = [0, 1]
        interp.fieldToInterp = node.id + ".opacity"
        m.fades[node.id] = anim
    end if
    anim.control = "stop"
    anim.duration = duration
    anim.getChild(0).keyValue = [node.opacity, target]
    anim.control = "start"
end sub

sub showHints()
    if m.top.screensaver then return
    Fade(m.top.findNode("hints"), 1.0, 0.4)
    t = m.top.findNode("hintTimer")
    t.control = "stop"
    t.control = "start"
end sub

sub hideHints()
    if m.prefs.loc = invalid then return ' keep the way into Settings visible until a city is set
    Fade(m.top.findNode("hints"), 0.0, 0.8)
end sub

sub showToast(text as String)
    m.toastLabel.text = text
    w = TextWidth(m.toastLabel) + 56
    m.toastBg.width = w
    m.toastLabel.translation = [28, 16]
    if m.layoutMode = "panel"
        m.top.findNode("toast").translation = [m.PANEL_W + (1920 - m.PANEL_W - w) / 2, 60]
    else
        m.top.findNode("toast").translation = [(1920 - w) / 2, 572]
    end if
    Fade(m.top.findNode("toast"), 1.0, 0.25)
    t = m.top.findNode("toastTimer")
    t.control = "stop"
    t.control = "start"
end sub

sub hideToast()
    if m.timeShift <> 0 then return
    Fade(m.top.findNode("toast"), 0.0, 0.5)
end sub

' ---- time travel (left / right on the remote) ----------------------------------------------

sub shiftTime(hours as Integer)
    if hours = 0 then m.timeShift = 0 else m.timeShift = m.timeShift + hours * 3600
    now = ClockNow()
    m.lastMinute = now \ 60
    renderClock(now)
    renderWeather()
    updateSky(1.2)
    applyBackground()
    if m.timeShift = 0
        showToast("Back to now")
    else
        h = m.timeShift \ 3600
        sign = "+"
        if h < 0 then sign = "-"
        showToast("Time travel  " + sign + Abs(h).ToStr() + "h   " + Chr(183) + "   Replay key returns to now")
    end if
    ' Never leave the TV stuck in the future: snap back after a minute without input.
    t = m.top.findNode("travelTimer")
    t.control = "stop"
    if m.timeShift <> 0 then t.control = "start"
end sub

sub endTimeTravel()
    if m.timeShift <> 0 then shiftTime(0)
end sub

' ---- screensaver -------------------------------------------------------------------------------

sub onScreensaverSet()
    if not m.top.screensaver then return
    m.top.findNode("hints").visible = false
    m.top.findNode("toast").visible = false
    m.top.findNode("dock").visible = false
    m.top.findNode("driftTimer").control = "start"
end sub

' Slowly wander the content a few pixels so nothing sits still for hours.
sub onDrift()
    interp = m.top.findNode("driftInterp")
    target = [Rnd(48) - 24, Rnd(36) - 18]
    interp.keyValue = [m.content.translation, target]
    m.top.findNode("drift").control = "start"
end sub

' ---- app dock ----------------------------------------------------------------------------------
' Always on screen. Down moves into it, left/right pick, OK opens, up leaves. Dibs opens the game picker;
' other apps are Roku channels, launched through the home streamer (Roku won't let a channel launch apps).

function DefaultApps() as Object
    return [
        { kind: "dibs", name: "Dibs" }
        { kind: "roku", id: "22297", name: "Spotify", color: "0x1DB954FF", icon: "pkg:/images/app_music.png" }
    ]
end function

sub buildDock()
    g = m.top.findNode("dock")
    g.removeChildrenIndex(g.getChildCount(), 0)
    m.dockTiles = []
    n = m.apps.Count()
    if n = 0 then return
    panel = m.layoutMode = "panel"
    s = 96 : gap = 28 : pad = 18 : font = m.f.pDetail
    if panel
        s = 116 : gap = 34 : pad = 22
    end if
    w = n * s + (n - 1) * gap + pad * 2
    h = s + 40 + pad * 2 - 6
    if panel
        g.translation = [1920 - 56 - w, 1080 - 48 - h]
    else
        g.translation = [m.RIGHT - w + pad, 486]
    end if
    bg = AddPoster(g, "pkg:/images/pill.9.png", 0, 0, w, h)
    bg.blendColor = "0x0A0F1CFF"
    bg.opacity = 0.4
    if panel then bg.opacity = 0.66
    m.dockRing = AddPoster(g, "pkg:/images/ring.9.png", 0, 0, s + 20, s + 20)
    for i = 0 to n - 1
        a = m.apps[i]
        x = pad + i * (s + gap)
        y = pad
        if a.kind = "dibs"
            AddPoster(g, "pkg:/images/app_dibs.png", x, y, s, s)
            ' "LIVE" badge while a hosted Dibs room is running (parked or on screen).
            m.dockBadge = g.CreateChild("Group")
            m.dockBadge.translation = [x + s - 52, y - 12]
            badgeBg = AddPoster(m.dockBadge, "pkg:/images/pill.9.png", 0, 0, 74, 34)
            badgeBg.blendColor = "0xFF6B57FF"
            badgeText = AddLabel(m.dockBadge, m.f.pPop, White(1), 0, 6)
            badgeText.width = 74
            badgeText.horizAlign = "center"
            badgeText.text = "LIVE"
        else
            tile = AddPoster(g, "pkg:/images/card.9.png", x, y, s, s)
            tile.blendColor = "0x2A3550FF"
            if a.color <> invalid then tile.blendColor = a.color
            if a.icon <> invalid
                AddPoster(g, a.icon, x, y, s, s)
            else
                letter = AddLabel(g, m.f.pTemp, White(1), x, y + s * 0.08)
                letter.width = s
                letter.horizAlign = "center"
                letter.text = UCase(Left(a.name, 1))
            end if
        end if
        lbl = AddLabel(g, font, White(0.86), x - 24, y + s + 6)
        lbl.width = s + 48
        lbl.horizAlign = "center"
        lbl.text = a.name
        m.dockTiles.Push([x, y])
    end for
    renderDockFocus()
    renderDockBadge()
end sub

sub renderDockBadge()
    if m.dockBadge <> invalid then m.dockBadge.visible = m.dibs.live <> ""
end sub

sub onDibsParked()
    showToast(m.dibs.live + " is still running   " + Chr(183) + "   Down, then OK on Dibs to go back")
end sub

sub renderDockFocus()
    if m.dockRing = invalid then return
    f = m.dockFocus
    m.dockRing.visible = f >= 0 and f < m.dockTiles.Count()
    if m.dockRing.visible then m.dockRing.translation = [m.dockTiles[f][0] - 10, m.dockTiles[f][1] - 10]
end sub

sub restartDockIdle()
    t = m.top.findNode("dockIdle")
    t.control = "stop"
    t.control = "start"
end sub

sub leaveDock()
    m.dockFocus = -1
    m.top.findNode("dockIdle").control = "stop"
    renderDockFocus()
end sub

sub activateApp(i as Integer)
    a = m.apps[i]
    kind = "roku"
    if a.kind <> invalid then kind = a.kind
    if kind = "dibs"
        m.dibs.open = true
        Fade(m.top.findNode("hints"), 0.0, 0.2)
        return
    end if
    if m.streamer = ""
        showToast("Opening apps needs the home streamer (see Play Dibs)")
        return
    end if
    showToast("Opening " + a.name + Chr(8230))
    m.launchName = a.name
    m.launchTask = CreateObject("roSGNode", "FetchTask")
    m.launchTask.method = "POST"
    m.launchTask.url = m.streamer + "/launch?app=" + a.id
    m.launchTask.observeField("result", "onLaunchResult")
    m.launchTask.control = "RUN"
end sub

sub onLaunchResult()
    r = m.launchTask.result
    if not r.ok then showToast("Couldn" + Chr(8217) + "t open " + m.launchName)
end sub

' The home streamer (Dibs hosting + app launching) announces itself on the LAN; local.json can pin one.
sub discoverStreamer()
    if m.discoverTask <> invalid then return
    m.discoverTask = CreateObject("roSGNode", "DiscoverTask")
    m.discoverTask.observeField("result", "onDiscover")
    m.discoverTask.control = "RUN"
end sub

sub onDiscover()
    found = m.discoverTask.result
    m.discoverTask = invalid
    if found <> ""
        m.streamer = found
    else if m.local.dibsStreamer <> invalid
        m.streamer = m.local.dibsStreamer
    end if
    m.dibs.streamer = m.streamer
end sub

' ---- deep links ------------------------------------------------------------------------------

sub onLaunchArgs()
    a = m.top.launchArgs
    if a = invalid or m.top.screensaver then return
    if a.dibs <> invalid
        m.dibs.open = true
        m.dibs.autostart = a.dibs
    end if
end sub

' ---- settings ------------------------------------------------------------------------------------

sub openSettings()
    m.settings.prefs = m.prefs
    m.settings.open = true
    Fade(m.top.findNode("hints"), 0.0, 0.2)
end sub

sub onSettingsClosed()
    m.top.setFocus(true)
    showHints()
end sub

sub onSettingChanged()
    key = m.settings.changed
    m.prefs = LoadPrefs()
    if key = "loc" or key = "units"
        loadCachedWeather()
        m.failures = 0
        renderWeather()
        updateSky(2)
        fetchWeather()
    else if key = "clock"
        renderClock(ClockNow())
        renderWeather()
    else if key = "layout"
        applyLayout(true)
    else if key = "bg"
        buildLayout()
        applyBackground()
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.top.screensaver then return false
    if m.dockFocus >= 0
        restartDockIdle()
        if key = "left" or key = "rev"
            if m.dockFocus > 0 then m.dockFocus = m.dockFocus - 1
            renderDockFocus()
        else if key = "right" or key = "fwd"
            if m.dockFocus < m.apps.Count() - 1 then m.dockFocus = m.dockFocus + 1
            renderDockFocus()
        else if key = "OK"
            i = m.dockFocus
            leaveDock()
            activateApp(i)
        else if key = "up" or key = "back" or key = "replay"
            leaveDock()
        else if key = "options"
            leaveDock()
            openSettings()
        end if
        return true
    end if
    if key = "options"
        openSettings()
        return true
    else if key = "OK"
        if m.prefs.layout = "minimal" then m.prefs.layout = "full" else m.prefs.layout = "minimal"
        SavePref("layout", m.prefs.layout)
        applyLayout(true)
        showHints()
        return true
    else if key = "down"
        if m.apps.Count() > 0
            m.dockFocus = 0
            renderDockFocus()
            restartDockIdle()
        end if
        return true
    else if key = "right" or key = "fwd"
        shiftTime(1)
        return true
    else if key = "left" or key = "rev"
        shiftTime(-1)
        return true
    else if key = "back" or key = "replay"
        if m.timeShift <> 0
            shiftTime(0)
            return true
        end if
        return false
    end if
    showHints()
    return true
end function
