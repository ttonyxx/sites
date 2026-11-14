sub init()
    m.X = 1196
    m.W = 600
    m.ROW_Y = 236
    m.ROW_H = 92
    m.MAX_ROWS = 6
    m.mode = "main"
    m.focus = 0
    m.items = []
    m.results = []
    m.geoTask = invalid
    m.dialog = invalid

    body = m.top.findNode("body")
    m.title = AddLabel(body, MakeFont("SemiBold", 52), White(1), m.X, 104)
    m.subtitle = AddLabel(body, MakeFont("Regular", 28), White(0.6), m.X, 176)

    rowFont = MakeFont("Regular", 34)
    m.rows = []
    for i = 0 to m.MAX_ROWS - 1
        g = body.CreateChild("Group")
        g.translation = [m.X - 28, m.ROW_Y + i * m.ROW_H]
        f = AddPoster(g, "pkg:/images/focus.9.png", 0, 0, m.W + 56, 80)
        t = AddLabel(g, rowFont, White(0.92), 28, 20)
        v = AddLabel(g, rowFont, White(0.55), 0, 20)
        t.width = m.W - 220
        t.ellipsizeOnBoundary = true
        m.rows.Push({ group: g, focus: f, title: t, value: v })
    end for

    m.desc = AddLabel(body, MakeFont("Regular", 28), White(0.66), m.X, 0)
    m.desc.width = m.W
    m.desc.wrap = true
    m.desc.lineSpacing = 6

    m.footer = AddLabel(body, MakeFont("Regular", 23), White(0.42), m.X, 950)
    m.footer.text = "Weather data by Open-Meteo.com (CC BY 4.0)" + Chr(10) + "Window 1.0"
    m.footer.width = m.W
    m.footer.wrap = true

    hints = body.CreateChild("Group")
    hints.translation = [m.X, 1020]
    hintFont = MakeFont("Regular", 24)
    x = 0
    for each item in [["key_updown", 60, "Move"], ["key_ok", 72, "Select"], ["key_back", 60, "Back"]]
        AddPoster(hints, "pkg:/images/" + item[0] + ".png", x, 0, item[1] * 0.7, 48 * 0.7)
        l = AddLabel(hints, hintFont, White(0.6), x + item[1] * 0.7 + 12, 3)
        l.text = item[2]
        x = x + item[1] * 0.7 + 12 + TextWidth(l) + 34
    end for
end sub

sub onOpen()
    if not m.top.open then return
    m.prefs = m.top.prefs
    m.top.visible = true
    m.focus = 0
    showMain()
    m.top.findNode("slide").control = "start"
    m.top.setFocus(true)
end sub

sub closePanel()
    m.top.open = false
    m.top.visible = false
    m.top.closed = true
end sub

' ---- modes --------------------------------------------------------------------------------

sub showMain()
    m.mode = "main"
    p = m.prefs
    place = "Not set"
    if p.loc <> invalid then place = p.loc.name
    units = Chr(176) + "F"
    if p.units = "C" then units = Chr(176) + "C"
    clock = "12-hour"
    if p.clock = "24" then clock = "24-hour"
    layout = "Full"
    if p.layout = "minimal" then layout = "Minimal"
    hasAlbum = LoadLocal().album <> invalid
    bg = p.bg
    if bg = "" or not hasAlbum
        bg = "sky"
        if hasAlbum then bg = "photos"
    end if
    bgNames = { photos: "Photos", mix: "Photos + sky", sky: "Sky" }
    m.items = [
        { key: "loc", title: "Location", value: place, desc: "Used for the forecast and for where the sun sits in the sky. Search by city or town name." }
        { key: "units", title: "Temperature", value: units, desc: "Fahrenheit or Celsius." }
        { key: "clock", title: "Clock", value: clock, desc: "12-hour or 24-hour time." }
        { key: "layout", title: "Layout", value: layout, desc: "Minimal hides the forecast cards so the background gets the whole screen. You can also press Play/Pause on the dashboard to switch." }
        { key: "saver", title: "Screensaver", value: "How to", desc: "To show Window whenever the TV sits idle: Home " + Chr(8250) + " Settings " + Chr(8250) + " Theme " + Chr(8250) + " Screensavers " + Chr(8250) + " Window." }
    ]
    if hasAlbum
        m.items.Unshift({ key: "bg", title: "Background", value: bgNames[bg], desc: "Photos rotates through the shared album. Photos + sky mixes in the live sky. Sky shows only the live sky." })
    end if
    m.title.text = "Settings"
    m.subtitle.text = "Living room"
    house = LoadLocal().title
    if house <> invalid then m.subtitle.text = house
    renderRows()
end sub

sub showMessage(title as String, message as String)
    m.mode = "busy"
    m.items = []
    m.title.text = title
    m.subtitle.text = ""
    renderRows()
    m.desc.text = message
    m.desc.translation = [m.X, m.ROW_Y]
end sub

sub showResults(query as String, results as Object)
    m.mode = "results"
    m.results = results
    m.items = []
    for each r in results
        region = ""
        if r.admin1 <> invalid then region = r.admin1
        if r.country_code <> invalid
            if region <> "" then region = region + ", "
            region = region + r.country_code
        end if
        m.items.Push({ key: "result", title: r.name, value: region, desc: "Press OK to use this place." })
    end for
    m.title.text = "Choose a place"
    m.subtitle.text = "Results for " + Chr(8220) + query + Chr(8221)
    m.focus = 0
    renderRows()
end sub

sub renderRows()
    for i = 0 to m.MAX_ROWS - 1
        row = m.rows[i]
        if i < m.items.Count()
            it = m.items[i]
            row.group.visible = true
            row.title.text = it.title
            row.value.text = it.value
            PlaceRight(row.value, m.W + 28, 20)
            row.title.width = row.value.translation[0] - 28 - 24
        else
            row.group.visible = false
        end if
    end for
    renderFocus()
end sub

sub renderFocus()
    for i = 0 to m.MAX_ROWS - 1
        row = m.rows[i]
        isOn = (i = m.focus) and (i < m.items.Count())
        row.focus.visible = isOn
        if isOn
            row.title.color = White(1)
            row.value.color = White(0.85)
        else
            row.title.color = White(0.82)
            row.value.color = White(0.5)
        end if
    end for
    if m.focus < m.items.Count()
        m.desc.text = m.items[m.focus].desc
        m.desc.translation = [m.X, m.ROW_Y + m.items.Count() * m.ROW_H + 28]
    end if
end sub

' ---- actions --------------------------------------------------------------------------------

sub activate()
    if m.focus >= m.items.Count() then return
    it = m.items[m.focus]
    if it.key = "loc"
        openKeyboard()
    else if it.key = "units"
        v = "C"
        if m.prefs.units = "C" then v = "F"
        setPref("units", v)
    else if it.key = "clock"
        v = "24"
        if m.prefs.clock = "24" then v = "12"
        setPref("clock", v)
    else if it.key = "layout"
        v = "minimal"
        if m.prefs.layout = "minimal" then v = "full"
        setPref("layout", v)
    else if it.key = "bg"
        current = it.value
        v = "photos"
        if current = "Photos" then v = "mix"
        if current = "Photos + sky" then v = "sky"
        setPref("bg", v)
    else if it.key = "result"
        r = m.results[m.focus]
        region = it.value
        loc = { name: r.name, region: region, lat: r.latitude, lon: r.longitude }
        SavePref("loc", FormatJson(loc))
        m.prefs.loc = loc
        m.top.changed = "loc"
        m.focus = 0
        showMain()
    end if
end sub

sub setPref(key as String, value as String)
    SavePref(key, value)
    m.prefs[key] = value
    keep = m.focus
    showMain()
    m.focus = keep
    renderFocus()
    m.top.changed = key
end sub

sub openKeyboard()
    dlg = CreateObject("roSGNode", "StandardKeyboardDialog")
    dlg.title = "Find your city"
    dlg.message = ["Type a city or town, then choose Search."]
    dlg.buttons = ["Search", "Cancel"]
    pal = CreateObject("roSGNode", "RSGPalette")
    pal.colors = {
        DialogBackgroundColor: "0x111829FF"
        DialogTextColor: "0xEEF2FAFF"
        DialogSecondaryTextColor: "0x9AA6BFFF"
        DialogItemColor: "0xEEF2FAFF"
        DialogFocusColor: "0xEEF2FAFF"
        DialogFocusItemColor: "0x111829FF"
        DialogSecondaryItemColor: "0x2A3550FF"
        DialogInputFieldColor: "0x1B2338FF"
        DialogKeyboardColor: "0x1B2338FF"
        DialogFootprintColor: "0x2A3550FF"
    }
    dlg.palette = pal
    dlg.observeField("buttonSelected", "onKeyboardButton")
    dlg.observeField("wasClosed", "onKeyboardClosed")
    m.dialog = dlg
    m.top.getScene().dialog = dlg
end sub

sub onKeyboardButton()
    dlg = m.dialog
    if dlg = invalid then return
    query = dlg.text.Trim()
    choice = dlg.buttonSelected
    dlg.close = true
    m.dialog = invalid
    m.top.setFocus(true)
    if choice = 0 and query <> "" then search(query)
end sub

sub onKeyboardClosed()
    m.dialog = invalid
    m.top.setFocus(true)
end sub

sub search(query as String)
    m.query = query
    showMessage("Searching" + Chr(8230), "Looking up " + Chr(8220) + query + Chr(8221))
    m.geoTask = CreateObject("roSGNode", "FetchTask")
    m.geoTask.url = GeocodeUrl()
    m.geoTask.q = query
    m.geoTask.observeField("result", "onGeoResult")
    m.geoTask.control = "RUN"
end sub

sub onGeoResult()
    r = m.geoTask.result
    m.geoTask = invalid
    if m.mode <> "busy" then return
    results = invalid
    if r.ok then results = r.data.results
    found = false
    if results <> invalid
        if results.Count() > 0 then found = true
    end if
    if not found
        showMain()
        msg = "Couldn" + Chr(8217) + "t reach the weather service. Check the TV" + Chr(8217) + "s internet connection."
        if r.ok then msg = "No places found for " + Chr(8220) + m.query + Chr(8221) + ". Try another spelling."
        m.desc.text = msg
        return
    end if
    showResults(m.query, results)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return true
    n = m.items.Count()
    if key = "up"
        if n > 0
            m.focus = (m.focus - 1 + n) mod n
            renderFocus()
        end if
    else if key = "down"
        if n > 0
            m.focus = (m.focus + 1) mod n
            renderFocus()
        end if
    else if key = "OK"
        activate()
    else if key = "back"
        if m.mode = "main"
            closePanel()
        else
            m.focus = 0
            showMain()
        end if
    else if key = "options"
        closePanel()
    end if
    return true
end function
