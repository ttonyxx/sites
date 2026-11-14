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
    m.focus = 0 ' -1 = the "Back to <game>" button
    m.liveInfo = invalid ' { id, name, code } while the streamer is hosting a room
    m.task = invalid
    m.pollTask = invalid
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

    ' Game picker: 3 x 2 tiles under an optional "Back to <game>" button.
    tiles = m.top.findNode("tiles")
    m.tilePos = []
    for i = 0 to m.GAMES.Count() - 1
        x = 260 + (i mod 3) * 480
        y = 330 + (i \ 3) * 284
        AddPoster(tiles, "pkg:/images/dibs_g_" + m.GAMES[i].id + ".png", x, y, 440, 250)
        m.tilePos.Push([x - 16, y - 16])
    end for
    m.top.findNode("resumeText").font = MakeFont("SemiBold", 30)
    m.top.findNode("resumeText").color = White(1)
    m.top.findNode("pickNote").font = MakeFont("Regular", 24)
    m.top.findNode("pickNote").color = White(0.5)
    m.top.findNode("pickHint").font = MakeFont("SemiBold", 28)
    m.top.findNode("pickHint").color = White(0.9)

    st = m.top.findNode("statusText")
    st.font = MakeFont("SemiBold", 32)
    st.color = White(1)

    m.autoClose = m.top.findNode("autoClose")
    m.autoClose.observeField("fire", "closePanel")
    m.top.findNode("statusTimer").observeField("fire", "hideStatus")
    m.top.findNode("poll").observeField("fire", "pollStatus")
end sub

' ---- streamer status (also keeps a parked room alive) -------------------------------------------

sub onStreamer()
    t = m.top.findNode("poll")
    t.control = "stop"
    if m.top.streamer <> ""
        pollStatus()
        t.control = "start"
    end if
end sub

sub pollStatus()
    if m.top.streamer = "" or m.pollTask <> invalid then return
    m.pollTask = CreateObject("roSGNode", "FetchTask")
    m.pollTask.url = m.top.streamer + "/status"
    m.pollTask.observeField("result", "onStatus")
    m.pollTask.control = "RUN"
end sub

sub onStatus()
    r = m.pollTask.result
    m.pollTask = invalid
    info = invalid
    if r.ok
        if r.data.running = true and r.data.game <> invalid
            info = { id: r.data.game, name: GameName(r.data.game), code: "" }
            if r.data.code <> invalid then info.code = r.data.code
        end if
    end if
    setLive(info)
end sub

sub setLive(info as Dynamic)
    m.liveInfo = info
    if info = invalid
        m.top.live = ""
        if m.focus < 0 then m.focus = 0
    else
        m.top.live = info.name
    end if
    if m.mode = "pick" then renderPick()
end sub

function GameName(id as String) as String
    for each g in m.GAMES
        if g.id = id then return g.name
    end for
    return "Dibs"
end function

' ---- modes ---------------------------------------------------------------------------------------

sub onOpen()
    if not m.top.open then return
    m.top.visible = true
    if m.top.streamer <> ""
        if m.liveInfo <> invalid then m.focus = -1
        setMode("pick")
        pollStatus()
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
    if mode = "pick" then renderPick()
end sub

sub renderPick()
    live = m.liveInfo <> invalid
    g = m.top.findNode("resume")
    g.visible = live
    if live
        lbl = m.top.findNode("resumeText")
        lbl.width = 0
        text = "Back to " + m.liveInfo.name
        if m.liveInfo.code <> "" then text = text + "   " + Chr(183) + "   room " + m.liveInfo.code
        lbl.text = text
        w = TextWidth(lbl) + 90
        lbl.width = w
        m.top.findNode("resumeBg").width = w
        g.translation = [(1920 - w) / 2, 242]
        m.resumeW = w
    end if
    if m.focus < 0 and not live then m.focus = 0
    hint = m.top.findNode("pickHint")
    note = m.top.findNode("pickNote")
    if m.focus < 0
        hint.text = "OK  back to the game      " + Chr(183) + "      *  end the room      " + Chr(183) + "      Replay key  close"
        note.text = "The room keeps running while you're away, so phones stay in the game."
    else
        hint.text = "OK  host it on this TV      " + Chr(183) + "      Replay key  close"
        note.text = "The TV shows the room; everyone plays on their phones. It runs a few seconds behind the phones."
        if live then note.text = "Hosting a new game ends the " + m.liveInfo.name + " room."
    end if
    moveRing(false)
end sub

sub moveRing(animate as Boolean)
    ring = m.top.findNode("ring")
    if m.focus < 0
        target = [(1920 - m.resumeW) / 2 - 14, 228]
        ring.width = m.resumeW + 28
        ring.height = 92
    else
        target = m.tilePos[m.focus]
        ring.width = 472
        ring.height = 282
    end if
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
    if m.mode = "starting" then stopRoom()
    if m.mode = "playing" then parkGame(false)
    m.autoClose.control = "stop"
    m.top.open = false
    m.top.visible = false
    m.top.closed = true
end sub

' ---- hosting through the streamer ------------------------------------------------------------

' Deep link: host this game straight away (game id as on the streamer, e.g. "punchline").
sub onAutostart()
    if m.top.streamer = "" then return
    for i = 0 to m.GAMES.Count() - 1
        if m.GAMES[i].id = m.top.autostart then m.focus = i
    end for
    startGame()
end sub

sub startGame()
    game = m.GAMES[m.focus]
    if m.liveInfo <> invalid
        if m.liveInfo.id = game.id
            resumeGame()
            return
        end if
    end if
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
    setLive({ id: r.data.game, name: GameName(r.data.game), code: r.data.code })
    play(r.data.hls)
    showStatus("Room " + r.data.code + "   " + Chr(183) + "   Replay key goes back to Window (the game keeps going)", 8)
end sub

sub resumeGame()
    m.autoClose.control = "stop"
    play("/live/index.m3u8")
    showStatus("Back to " + m.liveInfo.name, 3)
end sub

sub play(hlsPath as String)
    c = CreateObject("roSGNode", "ContentNode")
    c.url = m.top.streamer + hlsPath
    c.streamFormat = "hls"
    c.live = true
    m.video.content = c
    m.video.visible = true
    m.video.control = "play"
    setMode("playing")
    m.top.setFocus(true)
end sub

sub onVideoState()
    s = m.video.state
    print "[window] dibs video "; s
    if s = "error" and m.mode = "playing"
        m.video.visible = false
        setMode("pick")
        pollStatus()
        showStatus("The stream stopped. Pick a game to start again.", 6)
        m.autoClose.control = "start"
    end if
end sub

' Leave the stream but keep the room running; the dock's Dibs tile and "Back to" button return to it.
sub parkGame(closeAfter as Boolean)
    m.video.control = "stop"
    m.video.visible = false
    hideStatus()
    m.mode = "pick"
    if closeAfter
        m.mode = "card"
        m.top.open = false
        m.top.visible = false
        m.top.parked = true
        m.top.closed = true
    end if
end sub

sub stopRoom()
    m.video.control = "stop"
    m.video.visible = false
    t = CreateObject("roSGNode", "FetchTask")
    t.method = "POST"
    t.url = m.top.streamer + "/stop"
    t.control = "RUN"
    m.stopTask = t
    setLive(invalid)
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

' The TV may keep Back for itself, so Replay and * also work.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return true
    leave = (key = "back") or (key = "replay")
    if m.mode = "card"
        if leave or key = "OK" or key = "up" or key = "down" or key = "options" then closePanel()
    else if m.mode = "pick"
        m.autoClose.control = "stop"
        m.autoClose.control = "start"
        n = m.GAMES.Count()
        moved = false
        if m.focus < 0
            if key = "down"
                m.focus = 0 : moved = true
            else if key = "OK"
                resumeGame()
            else if key = "options"
                stopRoom()
                showStatus("Room ended", 3)
            end if
        else
            if key = "right" and m.focus mod 3 < 2
                m.focus = m.focus + 1 : moved = true
            else if key = "left" and m.focus mod 3 > 0
                m.focus = m.focus - 1 : moved = true
            else if key = "down" and m.focus + 3 < n
                m.focus = m.focus + 3 : moved = true
            else if key = "up" and m.focus >= 3
                m.focus = m.focus - 3 : moved = true
            else if key = "up" and m.liveInfo <> invalid
                m.focus = -1 : moved = true
            else if key = "OK"
                startGame()
            else if key = "options"
                closePanel()
            end if
        end if
        if moved then renderPick()
        if leave then closePanel()
    else if m.mode = "starting"
        if leave
            stopRoom()
            setMode("pick")
            hideStatus()
        end if
    else if m.mode = "playing"
        if leave or key = "options"
            parkGame(true)
        else
            showStatus("Replay key goes back to Window (the game keeps going)", 3)
        end if
    end if
    return true
end function
