' Screens (all may carry: game, color "0xRRGGBBFF", code, join (URL), secs (seconds left on the phase timer)):
'   lobby   { players: [{name, color, host}], max, hint, settings }
'   stage   { kicker, heading, body, phones (bool), secs, players: [{name, color, done}] }
'   matchup { kicker, prompt, answers: [{text, author, color, votes, voters: [names], winner, points}], reveal (bool), secs }
'   list    { kicker, prompt, items: [{text, author, color, points, place}], reveal (bool), secs, note }
'   scores  { title, rows: [{name, color, score, delta}], final (bool), note }
'   message { title, body }

sub init()
    m.INK = "0x221836FF"
    m.WHITE = "0xFFFFFFFF"
    m.view = m.top.findNode("view")
    m.chip = m.top.findNode("chip")
    m.secs = 0
    m.since = CreateObject("roTimespan")
    m.timerLabel = invalid
    m.sig = ""
    m.top.findNode("tick").observeField("fire", "onTick")
    m.top.findNode("tick").control = "start"
    m.fonts = {}
end sub

function DF(kind as String, size as Integer) as Object
    key = kind + size.ToStr()
    if m.fonts[key] = invalid
        f = CreateObject("roSGNode", "Font")
        f.uri = "pkg:/fonts/Dibs-" + kind + ".ttf"
        f.size = size
        m.fonts[key] = f
    end if
    return m.fonts[key]
end function

' True only for a real boolean true (JSON fields may be missing; comparing invalid to true crashes).
function Truthy(v as Dynamic) as Boolean
    if v = invalid then return false
    if GetInterface(v, "ifBoolean") = invalid then return false
    return v
end function

function NowMs() as Double
    dt = CreateObject("roDateTime")
    ' Doubles: a millisecond timestamp doesn't fit a (single-precision) Float.
    return CDbl(dt.AsSeconds()) * CDbl(1000) + dt.GetMilliseconds()
end function

' Dibs-style card: hard ink shadow, white (or tinted) fill, thick ink outline.
function DCard(parent as Object, x as Float, y as Float, w as Float, h as Float, fill as String) as Object
    g = parent.CreateChild("Group")
    g.translation = [x, y]
    sh = AddPoster(g, "pkg:/images/card.9.png", 8, 8, w, h)
    sh.blendColor = m.INK
    bg = AddPoster(g, "pkg:/images/card.9.png", 0, 0, w, h)
    bg.blendColor = fill
    ring = AddPoster(g, "pkg:/images/ring.9.png", -3, -3, w + 6, h + 6)
    ring.blendColor = m.INK
    return g
end function

function Txt(parent as Object, text as String, font as Object, color as String, x as Float, y as Float, w as Float, align as String) as Object
    l = parent.CreateChild("Label")
    l.font = font
    l.color = color
    l.translation = [x, y]
    l.width = w
    l.horizAlign = align
    l.wrap = true
    l.text = text
    return l
end function

function Avatar(parent as Object, p as Object, x as Float, y as Float, size as Float) as Object
    g = parent.CreateChild("Group")
    g.translation = [x, y]
    ring = AddPoster(g, "pkg:/images/dot.png", -4, -4, size + 8, size + 8)
    ring.blendColor = m.INK
    d = AddPoster(g, "pkg:/images/dot.png", 0, 0, size, size)
    d.blendColor = "0xFFC93CFF"
    if p.color <> invalid then d.blendColor = p.color
    initial = ""
    if p.name <> invalid then initial = UCase(Left(p.name, 1))
    Txt(g, initial, DF("Display-ExtraBold", Cint(size * 0.5)), m.INK, 0, size * 0.18, size, "center")
    return g
end function

sub onScreen()
    s = m.top.screen
    if s = invalid then return
    ' Dibs re-sends the state every second during timers; if only the clock moved, just update it.
    copy = {}
    copy.Append(s)
    copy.Delete("secs")
    copy.Delete("now")
    sig = FormatJson(copy)
    if sig = m.sig and m.timerLabel <> invalid
        if s.secs <> invalid then setSecs(s.secs)
        return
    end if
    m.sig = sig
    if s.color <> invalid then m.top.findNode("bg").color = s.color
    m.view.removeChildrenIndex(m.view.getChildCount(), 0)
    m.timerLabel = invalid
    m.secs = 0
    t = s.t
    if t = "lobby"
        drawLobby(s)
    else if t = "stage"
        drawStage(s)
    else if t = "matchup"
        drawMatchup(s)
    else if t = "list"
        drawList(s)
    else if t = "scores"
        drawScores(s)
    else
        drawMessage(s)
    end if
    drawChip(s, t <> "lobby" and s.code <> invalid)
    if s.secs <> invalid then drawTimer(s.secs)
end sub

sub drawTitle(s as Object)
    name = "Dibs"
    if s.game <> invalid then name = s.game
    Txt(m.view, name, DF("Display-ExtraBold", 92), m.INK, 80, 36, 1200, "left")
end sub

sub drawLobby(s as Object)
    drawTitle(s)
    v = m.view
    ' Join card.
    jc = DCard(v, 80, 190, 720, 760, m.WHITE)
    Txt(jc, "Join on your phone", DF("Display-Bold", 42), m.INK, 0, 40, 720, "center")
    if s.join <> invalid and m.top.base <> ""
        AddPoster(jc, m.top.base + "/qr.png?size=400&data=" + s.join.EncodeUriComponent(), 170, 110, 380, 380)
    end if
    Txt(jc, "or go to dibsgames.com and enter", DF("Text-Regular", 28), m.INK, 0, 516, 720, "center")
    colors = ["0xFFC93CFF", "0x2DD4A0FF", "0xFF7AC6FF"]
    code = ""
    if s.code <> invalid then code = s.code
    tw = 92 : gap = 14
    x0 = (720 - (Len(code) * tw + (Len(code) - 1) * gap)) / 2
    for i = 0 to Len(code) - 1
        tile = DCard(jc, x0 + i * (tw + gap), 584, tw, 112, colors[i mod 3])
        Txt(tile, Mid(code, i + 1, 1), DF("Display-ExtraBold", 72), m.INK, 0, 8, tw, "center")
    end for

    ' Players card.
    pc = DCard(v, 860, 190, 980, 760, m.WHITE)
    players = []
    if s.players <> invalid then players = s.players
    count = players.Count().ToStr()
    if s.max <> invalid then count = count + "/" + s.max.ToStr()
    Txt(pc, "Players", DF("Display-Bold", 44), m.INK, 48, 40, 300, "left")
    Txt(pc, count, DF("Display-Bold", 44), "0x22183699", 230, 40, 300, "left")
    if players.Count() = 0
        Txt(pc, "Waiting for players" + Chr(8230), DF("Text-Regular", 36), "0x22183399", 0, 380, 980, "center")
    end if
    cols = 4
    for i = 0 to players.Count() - 1
        if i >= 16 then exit for
        p = players[i]
        cx = 70 + (i mod cols) * 225
        cy = 140 + (i \ cols) * 150
        av = Avatar(pc, p, cx + 47, cy, 92)
        if Truthy(p.away) then av.opacity = 0.45
        nm = Txt(pc, p.name, DF("Text-Bold", 26), m.INK, cx - 10, cy + 100, 206, "center")
        nm.wrap = false
        if Truthy(p.host)
            badge = DCard(pc, cx + 136, cy - 16, 64, 34, "0xFFC93CFF")
            Txt(badge, "HOST", DF("Display-Bold", 18), m.INK, 0, 6, 64, "center")
        end if
    end for
    hint = "Scan the code to join. Whoever gets in first is the host."
    if s.hint <> invalid then hint = s.hint
    Txt(v, hint, DF("Display-ExtraBold", 46), m.INK, 80, 980, 1760, "center")
    if s.settings <> invalid then Txt(v, s.settings, DF("Text-Regular", 26), "0x221836B3", 80, 1040, 1760, "center")
end sub

sub drawStage(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), "0x221836B3", 160, 230, 1600, "center")
    heading = ""
    if s.heading <> invalid then heading = s.heading
    Txt(v, heading, DF("Display-ExtraBold", 96), m.INK, 160, 290, 1600, "center")
    if s.body <> invalid then Txt(v, s.body, DF("Text-Regular", 44), m.INK, 260, 520, 1400, "center")
    if Truthy(s.phones)
        pill = DCard(v, 710, 640, 500, 84, m.INK)
        Txt(pill, "ON YOUR PHONES", DF("Display-ExtraBold", 40), m.WHITE, 0, 18, 500, "center")
    end if
    ' Who's done.
    if s.players <> invalid
        n = s.players.Count()
        if n > 0
            size = 84
            gap = 54
            w = n * size + (n - 1) * gap
            x0 = (1920 - w) / 2
            for i = 0 to n - 1
                p = s.players[i]
                a = Avatar(v, p, x0 + i * (size + gap), 790, size)
                if Truthy(p.done)
                    tick = DCard(v, x0 + i * (size + gap) + size - 30, 778, 44, 44, "0x2DD4A0FF")
                    Txt(tick, "OK", DF("Display-Bold", 18), m.INK, 0, 11, 44, "center")
                else
                    a.opacity = 0.55
                end if
                nm = Txt(v, p.name, DF("Text-Bold", 24), m.INK, x0 + i * (size + gap) - 30, 884, size + 60, "center")
                nm.wrap = false
            end for
        end if
    end if
end sub

sub drawMatchup(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 32), "0x221836B3", 160, 168, 1600, "center")
    prompt = DCard(v, 160, 220, 1600, 230, m.WHITE)
    ptext = ""
    if s.prompt <> invalid then ptext = s.prompt
    pl = Txt(prompt, ptext, DF("Display-ExtraBold", 58), m.INK, 50, 0, 1500, "center")
    pl.height = 230
    pl.vertAlign = "center"
    if s.byline <> invalid then Txt(v, s.byline, DF("Text-Bold", 28), "0x221836B3", 160, 462, 1600, "center")
    answers = []
    if s.answers <> invalid then answers = s.answers
    n = answers.Count()
    if n = 0 then return
    gap = 60
    w = (1600 - (n - 1) * gap) / n
    for i = 0 to n - 1
        a = answers[i]
        fill = m.WHITE
        if Truthy(a.winner) then fill = "0xFFF1B8FF"
        card = DCard(v, 160 + i * (w + gap), 500, w, 380, fill)
        at = Txt(card, Chr(8220) + a.text + Chr(8221), DF("Display-Bold", 54), m.INK, 36, 30, w - 72, "center")
        at.height = 220
        at.vertAlign = "center"
        if Truthy(s.reveal)
            who = ""
            if a.author <> invalid then who = a.author
            Txt(card, who, DF("Text-Bold", 32), m.INK, 0, 268, w, "center")
            votes = ""
            if a.votes <> invalid
                votes = a.votes.ToStr() + " vote"
                if a.votes <> 1 then votes = votes + "s"
            end if
            if a.points <> invalid then votes = votes + "   +" + a.points.ToStr()
            Txt(card, votes, DF("Display-Bold", 34), "0x221836B3", 0, 318, w, "center")
            if Truthy(a.winner)
                badge = DCard(v, 160 + i * (w + gap) + w / 2 - 110, 474, 220, 52, "0xFF6B57FF")
                Txt(badge, "WINNER", DF("Display-ExtraBold", 30), m.WHITE, 0, 10, 220, "center")
            end if
        end if
    end for
    if Truthy(s.reveal)
        if s.note <> invalid then Txt(v, s.note, DF("Display-ExtraBold", 56), m.INK, 40, 930, 1370, "center")
    else
        line = "Vote for the funnier answer on your phones!"
        if s.note <> invalid then line = line + "   " + Chr(183) + "   " + s.note
        Txt(v, line, DF("Display-ExtraBold", 38), m.INK, 40, 944, 1370, "center")
    end if
end sub

sub drawScores(s as Object)
    v = m.view
    title = "Scores"
    if s.title <> invalid then title = s.title
    Txt(v, title, DF("Display-ExtraBold", 96), m.INK, 0, 50, 1920, "center")
    rows = []
    if s.rows <> invalid then rows = s.rows
    for i = 0 to rows.Count() - 1
        if i >= 8 then exit for
        r = rows[i]
        fill = m.WHITE
        if i = 0 then fill = "0xFFF1B8FF"
        row = DCard(v, 360, 200 + i * 100, 1200, 82, fill)
        Txt(row, (i + 1).ToStr(), DF("Display-ExtraBold", 44), m.INK, 24, 12, 60, "center")
        Avatar(row, r, 100, 9, 64)
        Txt(row, r.name, DF("Display-Bold", 42), m.INK, 190, 14, 640, "left")
        score = ""
        if r.score <> invalid then score = r.score.ToStr()
        Txt(row, score, DF("Display-ExtraBold", 46), m.INK, 840, 10, 220, "right")
        if r.delta <> invalid
            if r.delta > 0 then Txt(row, "+" + r.delta.ToStr(), DF("Display-Bold", 32), "0x1E9E73FF", 1070, 20, 110, "left")
        end if
    end for
    if s.note <> invalid then Txt(v, s.note, DF("Display-Bold", 36), m.INK, 40, 990, 1370, "center")
end sub

sub drawList(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 32), "0x221836B3", 160, 168, 1600, "center")
    prompt = DCard(v, 160, 220, 1600, 150, m.WHITE)
    ptext = ""
    if s.prompt <> invalid then ptext = s.prompt
    pl = Txt(prompt, ptext, DF("Display-ExtraBold", 52), m.INK, 40, 0, 1520, "center")
    pl.height = 150
    pl.vertAlign = "center"
    items = []
    if s.items <> invalid then items = s.items
    reveal = Truthy(s.reveal)
    medals = ["0xFFC93CFF", "0xD9DEE8FF", "0xF0A36BFF"]
    n = items.Count()
    if n > 8 then n = 8
    rowH = 68
    if n > 0 and n <= 5 then rowH = 84
    for i = 0 to n - 1
        it = items[i]
        fill = m.WHITE
        if reveal and i = 0 then fill = "0xFFF1B8FF"
        row = DCard(v, 260, 410 + i * (rowH + 14), 1400, rowH, fill)
        x = 30
        if reveal and it.place <> invalid
            chipFill = "0xFFFFFFFF"
            if it.place <= 3 then chipFill = medals[it.place - 1]
            medal = DCard(row, 18, (rowH - 50) / 2, 70, 50, chipFill)
            Txt(medal, it.place.ToStr(), DF("Display-ExtraBold", 30), m.INK, 0, 7, 70, "center")
            x = 110
        end if
        tl = Txt(row, Chr(8220) + it.text + Chr(8221), DF("Display-Bold", 36), m.INK, x, 0, 900, "left")
        tl.height = rowH
        tl.vertAlign = "center"
        tl.wrap = false
        if reveal and it.author <> invalid
            Avatar(row, { name: it.author, color: it.color }, 1040, (rowH - 50) / 2, 50)
            an = Txt(row, it.author, DF("Text-Bold", 28), m.INK, 1104, 0, 170, "left")
            an.height = rowH
            an.vertAlign = "center"
            an.wrap = false
            if it.points <> invalid
                pt = Txt(row, "+" + it.points.ToStr(), DF("Display-ExtraBold", 32), "0x1E9E73FF", 1270, 0, 110, "right")
                pt.height = rowH
                pt.vertAlign = "center"
            end if
        end if
    end for
    line = ""
    if Truthy(s.phones) then line = "Pick your top 3 on your phones!"
    if s.note <> invalid
        if line <> "" then line = line + "   " + Chr(183) + "   "
        line = line + s.note
    end if
    if line <> "" then Txt(v, line, DF("Display-ExtraBold", 38), m.INK, 40, 960, 1370, "center")
end sub

sub drawMessage(s as Object)
    drawTitle(s)
    title = ""
    if s.title <> invalid then title = s.title
    Txt(m.view, title, DF("Display-ExtraBold", 96), m.INK, 160, 360, 1600, "center")
    if s.body <> invalid then Txt(m.view, s.body, DF("Text-Regular", 44), m.INK, 260, 520, 1400, "center")
end sub

' Corner join chip (code + small QR), like the web TV keeps on screen during games.
sub drawChip(s as Object, show as Boolean)
    m.chip.removeChildrenIndex(m.chip.getChildCount(), 0)
    m.chip.visible = show
    if not show then return
    c = DCard(m.chip, 1430, 940, 430, 110, m.WHITE)
    Txt(c, "Join at dibsgames.com", DF("Text-Regular", 22), m.INK, 22, 12, 280, "left")
    Txt(c, s.code, DF("Display-ExtraBold", 50), m.INK, 20, 40, 280, "left")
    if s.join <> invalid and m.top.base <> ""
        AddPoster(c, m.top.base + "/qr.png?size=200&data=" + s.join.EncodeUriComponent(), 322, 10, 90, 90)
    end if
end sub

sub setSecs(secs as Integer)
    m.secs = secs
    m.since.Mark()
    onTick()
end sub

sub drawTimer(secs as Integer)
    g = m.view.CreateChild("Group")
    g.translation = [1700, 40]
    ring = AddPoster(g, "pkg:/images/dot.png", -5, -5, 130, 130)
    ring.blendColor = m.INK
    face = AddPoster(g, "pkg:/images/dot.png", 0, 0, 120, 120)
    face.blendColor = m.WHITE
    m.timerLabel = Txt(g, "", DF("Display-ExtraBold", 52), m.INK, 0, 26, 120, "center")
    setSecs(secs)
end sub

sub onTick()
    if m.timerLabel = invalid then return
    remain = m.secs - Int(m.since.TotalMilliseconds() / 1000)
    if remain < 0 then remain = 0
    m.timerLabel.text = remain.ToStr()
end sub
