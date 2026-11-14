sub init()
    m.GAMES = [
        { id: "punchline", name: "Punchline" }
        { id: "imposter", name: "Imposter" }
        { id: "tee-party", name: "Tee Party" }
        { id: "brawl", name: "Blob Brawl" }
        { id: "piggyback", name: "Piggyback" }
        { id: "pirates", name: "Pirates" }
    ]
    m.mode = "card"
    m.focus = 0
    m.task = invalid
    m.video = m.top.findNode("video")
    m.video.observeField("state", "onVideoState")

    ' AirPlay card text.
    tv = CreateObject("roDeviceInfo").GetFriendlyName()
    name = m.top.findNode("tvName")
    name.font = MakeFont("SemiBold", 30)
    name.color = White(0.92)
    name.text = "In the AirPlay / Screen Mirroring list, this TV is " + Chr(8220) + tv + Chr(8221)
    hint = m.top.findNode("closeHint")
    hint.font = MakeFont("Regular", 24)
    hint.color = White(0.55)
    hint.text = "Press OK to close"

    ' Game picker: 3 x 2 tiles.
    tiles = m.top.findNode("tiles")
    m.tilePos = []
    for i = 0 to m.GAMES.Count() - 1
        x = 260 + (i mod 3) * 480
        y = 290 + (i \ 3) * 290
        AddPoster(tiles, "pkg:/images/dibs_g_" + m.GAMES[i].id + ".png", x, y, 440, 250)
        m.tilePos.Push([x - 16, y - 16])
    end for
    ph = m.top.findNode("pickHint")
    ph.font = MakeFont("SemiBold", 28)
    ph.color = White(0.9)
    ph.text = "OK  host it on this TV      " + Chr(183) + "      Replay key  close"
    pn = m.top.findNode("pickNote")
    pn.font = MakeFont("Regular", 24)
    pn.color = White(0.5)
    pn.text = "The TV shows the room; everyone plays on their phones. It runs a few seconds behind the phones."

    st = m.top.findNode("statusText")
    st.font = MakeFont("SemiBold", 32)
    st.color = White(1)

    m.autoClose = m.top.findNode("autoClose")
    m.autoClose.observeField("fire", "closePanel")
    m.top.findNode("statusTimer").observeField("fire", "hideStatus")
end sub

sub onOpen()
    if not m.top.open then return
    m.top.visible = true
    if m.top.streamer <> ""
        setMode("pick")
    else
        setMode("card")
    end if
    m.top.findNode("pop").control = "start"
    m.autoClose.control = "start"
    m.top.setFocus(true)
end sub

sub setMode(mode as String)
    m.mode = mode
    m.top.findNode("cardMode").visible = mode = "card"
    m.top.findNode("pickMode").visible = mode = "pick" or mode = "starting"
    m.top.findNode("dim").visible = mode <> "playing"
    if mode = "pick" then moveRing(false)
end sub

sub moveRing(animate as Boolean)
    target = m.tilePos[m.focus]
    ring = m.top.findNode("ring")
    if not animate
        ring.translation = target
        return
    end if
    m.top.findNode("ringInterp").keyValue = [ring.translation, target]
    a = m.top.findNode("ringMove")
    a.control = "stop"
    a.control = "start"
end sub

sub closePanel()
    if not m.top.visible then return
    if m.mode = "playing" or m.mode = "starting" then stopGame(false)
    m.autoClose.control = "stop"
    m.top.open = false
    m.top.visible = false
    m.top.closed = true
end sub

' Deep link: host this game straight away (game id as on the streamer, e.g. "punchline").
sub onAutostart()
    if m.top.streamer = "" then return
    for i = 0 to m.GAMES.Count() - 1
        if m.GAMES[i].id = m.top.autostart then m.focus = i
    end for
    if m.mode = "playing" or m.mode = "starting" then stopGame(false)
    startGame()
end sub

' ---- hosting through the streamer ------------------------------------------------------------

sub startGame()
    game = m.GAMES[m.focus]
    m.autoClose.control = "stop"
    setMode("starting")
    showStatus("Setting up " + game.name + Chr(8230), 0)
    m.task = CreateObject("roSGNode", "FetchTask")
    m.task.method = "POST"
    m.task.url = m.top.streamer + "/start?game=" + game.id
    m.task.observeField("result", "onStarted")
    m.task.control = "RUN"
end sub

sub onStarted()
    r = m.task.result
    m.task = invalid
    if m.mode <> "starting" then return
    ok = false
    if r.ok
        if r.data.hls <> invalid then ok = true
    end if
    if not ok
        print "[window] dibs streamer failed: "; r.code; " "; Left(r.body, 120)
        setMode("pick")
        showStatus("Couldn" + Chr(8217) + "t reach the Dibs streamer. Is it running?", 6)
        m.autoClose.control = "start"
        return
    end if
    c = CreateObject("roSGNode", "ContentNode")
    c.url = m.top.streamer + r.data.hls
    c.streamFormat = "hls"
    c.live = true
    m.video.content = c
    m.video.visible = true
    m.video.control = "play"
    setMode("playing")
    showStatus("Room " + r.data.code + "   " + Chr(183) + "   Replay key ends it", 8)
    m.top.setFocus(true)
end sub

sub onVideoState()
    s = m.video.state
    print "[window] dibs video "; s
    if s = "error" and m.mode = "playing"
        stopGame(true)
        showStatus("The stream stopped. Pick a game to start again.", 6)
    end if
end sub

sub stopGame(backToPicker as Boolean)
    m.video.control = "stop"
    m.video.visible = false
    t = CreateObject("roSGNode", "FetchTask")
    t.method = "POST"
    t.url = m.top.streamer + "/stop"
    t.control = "RUN"
    m.stopTask = t
    if backToPicker
        setMode("pick")
        m.autoClose.control = "start"
    end if
end sub

sub showStatus(text as String, seconds as Float)
    g = m.top.findNode("status")
    lbl = m.top.findNode("statusText")
    lbl.text = text
    w = TextWidth(lbl) + 80
    m.top.findNode("statusBg").width = w
    g.translation = [(1920 - w) / 2, 960]
    g.visible = true
    t = m.top.findNode("statusTimer")
    t.control = "stop"
    if seconds > 0
        t.duration = seconds
        t.control = "start"
    end if
end sub

sub hideStatus()
    m.top.findNode("status").visible = false
end sub

' The TV may keep Back for itself, so Replay and * also close / end things.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return true
    leave = (key = "back") or (key = "replay") or (key = "options")
    if m.mode = "card"
        if leave or key = "OK" or key = "up" or key = "down" then closePanel()
    else if m.mode = "pick"
        m.autoClose.control = "stop"
        m.autoClose.control = "start"
        n = m.GAMES.Count()
        if key = "right" and m.focus mod 3 < 2 then m.focus = m.focus + 1
        if key = "left" and m.focus mod 3 > 0 then m.focus = m.focus - 1
        if key = "down" and m.focus + 3 < n then m.focus = m.focus + 3
        if key = "up" and m.focus >= 3 then m.focus = m.focus - 3
        if key = "left" or key = "right" or key = "up" or key = "down" then moveRing(true)
        if key = "OK" then startGame()
        if leave then closePanel()
    else if m.mode = "starting"
        if leave
            m.mode = "pick"
            stopGame(true)
            hideStatus()
        end if
    else if m.mode = "playing"
        if leave
            stopGame(true)
            hideStatus()
        else
            showStatus("Replay key ends the game", 3)
        end if
    end if
    return true
end function
