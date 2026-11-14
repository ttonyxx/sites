' Window dashboard: clock, current weather, hourly + 5-day forecast over a live sky.

sub init()
    m.top.backgroundColor = "0x060A18FF"
    m.top.backgroundUri = ""
    m.LEFT = 128
    m.RIGHT = 1792

    m.sky = m.top.findNode("sky")
    m.content = m.top.findNode("content")
    m.fades = {}
    m.prefs = LoadPrefs()
    m.data = invalid
    m.dataAt = 0
    m.vm = invalid
    m.wxTask = invalid
    m.failures = 0
    m.timeShift = 0
    m.lastMinute = -1
    m.skyReady = false

    m.f = {
        clock: MakeFont("ExtraLight", 250)
        ampm: MakeFont("Regular", 58)
        date: MakeFont("Regular", 46)
        greeting: MakeFont("Medium", 34)
        temp: MakeFont("ExtraLight", 168)
        place: MakeFont("Medium", 34)
        cond: MakeFont("Medium", 40)
        detail: MakeFont("Regular", 30)
        small: MakeFont("Regular", 26)
        colHead: MakeFont("Medium", 28)
        colTemp: MakeFont("Regular", 38)
        colLo: MakeFont("Regular", 30)
        pop: MakeFont("Medium", 23)
        status: MakeFont("Regular", 23)
        hint: MakeFont("Regular", 26)
    }

    buildClock()
    buildNow()
    buildCards()
    buildHints()
    buildToast()

    m.status = m.top.findNode("status")
    m.status.font = m.f.status
    m.status.color = White(0.5)

    m.settings = m.top.findNode("settings")
    m.settings.observeField("changed", "onSettingChanged")
    m.settings.observeField("closed", "onSettingsClosed")

    observeTimer("tick", "onTick", true)
    observeTimer("refresh", "fetchWeather", true)
    observeTimer("retry", "fetchWeather", false)
    observeTimer("hintTimer", "hideHints", false)
    observeTimer("toastTimer", "hideToast", false)
    observeTimer("driftTimer", "onDrift", false)

    loadCachedWeather()
    applyLayout(false)
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

sub buildClock()
    g = m.top.findNode("clock")
    m.greeting = AddLabel(g, m.f.greeting, White(0.78), m.LEFT, 104)
    m.time = AddLabel(g, m.f.clock, White(1), m.LEFT - 10, 120)
    m.ampm = AddLabel(g, m.f.ampm, White(0.85), 0, 0)
    m.date = AddLabel(g, m.f.date, White(0.9), m.LEFT, 408)
end sub

sub buildNow()
    g = m.top.findNode("now")
    m.place = AddLabel(g, m.f.place, White(0.85), 0, 108)
    m.wxIcon = AddPoster(g, "", 0, 172, 150, 150)
    m.temp = AddLabel(g, m.f.temp, White(1), 0, 142)
    m.cond = AddLabel(g, m.f.cond, White(0.95), 0, 344)
    m.details = AddLabel(g, m.f.detail, White(0.75), 0, 400)
    m.sun = AddLabel(g, m.f.small, White(0.6), 0, 446)
end sub

sub buildCards()
    g = m.top.findNode("cards")
    m.hourly = buildCard(g, m.LEFT, 664, 1004, 8, false)
    m.daily = buildCard(g, 1172, 664, m.RIGHT - 1172, 5, true)
end sub

' A frosted card with n evenly spaced forecast columns.
function buildCard(parent as Object, x as Float, y as Float, w as Float, n as Integer, isDaily as Boolean) as Object
    card = parent.CreateChild("Group")
    card.translation = [x, y]
    h = 292
    bg = AddPoster(card, "pkg:/images/card.9.png", 0, 0, w, h)
    bg.blendColor = "0x0A1226FF"
    bg.opacity = 0.34
    edge = AddPoster(card, "pkg:/images/card_edge.9.png", 0, 0, w, h)
    edge.opacity = 0.16
    pad = 22
    colW = (w - pad * 2) / n
    cols = []
    for i = 0 to n - 1
        cx = pad + i * colW
        c = {}
        dy = 0
        if not isDaily then dy = 16 ' no low-temperature row, so centre the column vertically
        c.head = AddLabel(card, m.f.colHead, White(0.7), cx, 34 + dy)
        c.icon = AddPoster(card, "", cx + (colW - 76) / 2, 78 + dy, 76, 76)
        c.pop = AddLabel(card, m.f.pop, "0x8CCBFFFF", cx, 156 + dy)
        c.temp = AddLabel(card, m.f.colTemp, White(1), cx, 186 + dy)
        if isDaily then c.lo = AddLabel(card, m.f.colLo, White(0.55), cx, 230)
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
    g.translation = [m.LEFT, 982]
    m.hintItems = []
    x = 0
    for each item in [["key_star", 60, "Settings"], ["key_ok", 72, "Minimal"], ["key_lr", 76, "Time travel"]]
        AddPoster(g, "pkg:/images/" + item[0] + ".png", x, 0, item[1] * 0.8, 48 * 0.8)
        l = AddLabel(g, m.f.hint, White(0.72), x + item[1] * 0.8 + 14, 4)
        l.text = item[2]
        m.hintItems.Push(l)
        x = x + item[1] * 0.8 + 14 + TextWidth(l) + 40
    end for
    m.hintLayout = m.hintItems[1]
end sub

sub buildToast()
    g = m.top.findNode("toast")
    bg = AddPoster(g, "pkg:/images/pill.9.png", 0, 0, 420, 64)
    bg.blendColor = "0x0A1226FF"
    bg.opacity = 0.6
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
    tw = TextWidth(m.time)
    m.ampm.translation = [m.time.translation[0] + tw + 14, 120 + (250 - 58) * 0.969]
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
    if m.prefs.loc = invalid
        setNow("No city set", "", "", "Choose your city for weather", "Press  *  on your remote for Settings", "")
        m.top.findNode("cards").visible = false
    else if vm = invalid
        msg = "Loading weather" + Chr(8230)
        subline = ""
        if m.failures > 0
            msg = "Weather unavailable"
            subline = "Retrying in a few minutes"
        end if
        setNow(m.prefs.loc.name, "", "", msg, subline, "")
        m.top.findNode("cards").visible = false
    else
        setNow(m.prefs.loc.name, vm.temp, vm.icon, vm.label, vm.details, vm.sun)
        fillCard(m.hourly, vm.hourly, false)
        fillCard(m.daily, vm.daily, true)
        m.top.findNode("cards").visible = true
    end if
    renderStatus()
end sub

sub setNow(place as String, temp as String, icon as String, cond as String, details as String, sun as String)
    R = m.RIGHT
    m.place.text = place
    PlaceRight(m.place, R, 108)
    m.temp.text = temp
    PlaceRight(m.temp, R + 6, 142)
    m.wxIcon.uri = icon
    m.wxIcon.visible = icon <> ""
    m.wxIcon.translation = [m.temp.translation[0] - 168, 168]
    condY = 344
    if temp = "" then condY = 170
    m.cond.text = cond
    PlaceRight(m.cond, R, condY)
    m.details.text = details
    PlaceRight(m.details, R, condY + 56)
    m.sun.text = sun
    PlaceRight(m.sun, R, condY + 102)
end sub

sub fillCard(card as Object, items as Object, isDaily as Boolean)
    for i = 0 to card.cols.Count() - 1
        c = card.cols[i]
        it = invalid
        if i < items.Count() then it = items[i]
        if it = invalid
            c.head.text = "" : c.temp.text = "" : c.pop.text = "" : c.icon.uri = ""
            if isDaily then c.lo.text = ""
        else
            if isDaily
                c.head.text = it.day
                c.temp.text = it.hi
                c.lo.text = it.lo
            else
                c.head.text = it.time
                c.temp.text = it.temp
            end if
            c.icon.uri = it.icon
            c.pop.text = it.pop
        end if
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
    PlaceRight(m.status, m.RIGHT, 988)
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
    m.top.findNode("toast").translation = [(1920 - w) / 2, 64]
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
    if m.timeShift = 0
        showToast("Back to now")
        m.top.findNode("toastTimer").control = "start"
    else
        h = m.timeShift \ 3600
        sign = "+"
        if h < 0 then sign = "-"
        showToast("Time travel  " + sign + Abs(h).ToStr() + "h   " + Chr(183) + "   Back returns to now")
    end if
end sub

' ---- screensaver -------------------------------------------------------------------------------

sub onScreensaverSet()
    if not m.top.screensaver then return
    m.top.findNode("hints").visible = false
    m.top.findNode("toast").visible = false
    m.top.findNode("driftTimer").control = "start"
end sub

' Slowly wander the content a few pixels so nothing sits still for hours.
sub onDrift()
    interp = m.top.findNode("driftInterp")
    target = [Rnd(48) - 24, Rnd(36) - 18]
    interp.keyValue = [m.content.translation, target]
    m.top.findNode("drift").control = "start"
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
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.top.screensaver then return false
    if key = "options"
        openSettings()
        return true
    else if key = "OK"
        if m.prefs.layout = "minimal" then m.prefs.layout = "full" else m.prefs.layout = "minimal"
        SavePref("layout", m.prefs.layout)
        applyLayout(true)
        showHints()
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
