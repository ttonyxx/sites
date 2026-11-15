' Screens (all may carry: game, color "0xRRGGBBFF", code, join (URL), secs (seconds left on the phase timer)):
'   lobby   { players: [{name, color, host}], max, hint, settings }
'   stage   { kicker, heading, body, phones (bool), secs, players: [{name, color, done}] }
'   matchup { kicker, prompt, answers: [{text, author, color, votes, voters: [names], winner, points}], reveal (bool), secs }
'   list    { kicker, prompt, items: [{text, author, color, points, place}], reveal (bool), secs, note }
'   scores  { title, rows: [{name, color, score, delta}], final (bool), note }
'   turns   { kicker, heading, body, people: [{name, color}] (in turn order), callout, note }
'   unmask  { key, lead, everyone: [{name, color}], imposters: [{name, color}], caught (bool), verdict, word, category,
'             tally: [{name, color, count, imp (bool), voters}], rows: [{name, color, score, delta}], note }
'           (spins through everyone's faces like a spotlight, once per key, then shows the rest)
'   message { title, body }
' dark (bool): light text on a dark background (Imposter).

sub init()
    m.INK = "0x221836FF"
    m.WHITE = "0xFFFFFFFF"
    m.RED = "0xFF3D6EFF"
    m.MINT = "0x2DD4A0FF"
    setTheme(false)
    m.spin = m.top.findNode("spin")
    m.spin.observeField("fire", "onSpin")
    m.spunKey = ""
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
    sh.blendColor = m.SHADOW
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
    if sig = m.sig
        if s.secs <> invalid and m.timerLabel <> invalid then setSecs(s.secs)
        return
    end if
    m.sig = sig
    setTheme(Truthy(s.dark))
    if s.color <> invalid then m.top.findNode("bg").color = s.color
    m.spin.control = "stop"
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
    else if t = "turns"
        drawTurns(s)
    else if t = "unmask"
        drawUnmask(s)
    else
        drawMessage(s)
    end if
    drawChip(s, t <> "lobby" and s.code <> invalid)
    if s.secs <> invalid then drawTimer(s.secs)
end sub

sub drawTitle(s as Object)
    name = "Dibs"
    if s.game <> invalid then name = s.game
    Txt(m.view, name, DF("Display-ExtraBold", 92), m.FG, 80, 36, 1200, "left")
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
    Txt(v, hint, DF("Display-ExtraBold", 46), m.FG, 80, 980, 1760, "center")
    if s.settings <> invalid then Txt(v, s.settings, DF("Text-Regular", 26), m.FG2, 80, 1040, 1760, "center")
end sub

sub drawStage(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), m.FG2, 160, 230, 1600, "center")
    heading = ""
    if s.heading <> invalid then heading = s.heading
    Txt(v, heading, DF("Display-ExtraBold", 96), m.FG, 160, 290, 1600, "center")
    if s.body <> invalid then Txt(v, s.body, DF("Text-Regular", 44), m.FG, 260, 520, 1400, "center")
    if Truthy(s.phones)
        pill = DCard(v, 710, 640, 500, 84, m.PILL)
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
                nm = Txt(v, p.name, DF("Text-Bold", 24), m.FG, x0 + i * (size + gap) - 30, 884, size + 60, "center")
                nm.wrap = false
            end for
        end if
    end if
end sub

sub drawMatchup(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 32), m.FG2, 160, 168, 1600, "center")
    prompt = DCard(v, 160, 220, 1600, 230, m.WHITE)
    ptext = ""
    if s.prompt <> invalid then ptext = s.prompt
    pl = Txt(prompt, ptext, DF("Display-ExtraBold", 58), m.INK, 50, 0, 1500, "center")
    pl.height = 230
    pl.vertAlign = "center"
    if s.byline <> invalid then Txt(v, s.byline, DF("Text-Bold", 28), m.FG2, 160, 462, 1600, "center")
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
        if s.note <> invalid then Txt(v, s.note, DF("Display-ExtraBold", 56), m.FG, 40, 930, 1370, "center")
    else
        line = "Vote for the funnier answer on your phones!"
        if s.note <> invalid then line = line + "   " + Chr(183) + "   " + s.note
        Txt(v, line, DF("Display-ExtraBold", 38), m.FG, 40, 944, 1370, "center")
    end if
end sub

sub drawScores(s as Object)
    v = m.view
    title = "Scores"
    if s.title <> invalid then title = s.title
    Txt(v, title, DF("Display-ExtraBold", 96), m.FG, 0, 50, 1920, "center")
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
    if s.note <> invalid then Txt(v, s.note, DF("Display-Bold", 36), m.FG, 40, 990, 1370, "center")
end sub

sub drawList(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 32), m.FG2, 160, 168, 1600, "center")
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
    if line <> "" then Txt(v, line, DF("Display-ExtraBold", 38), m.FG, 40, 960, 1370, "center")
end sub

sub drawMessage(s as Object)
    drawTitle(s)
    title = ""
    if s.title <> invalid then title = s.title
    Txt(m.view, title, DF("Display-ExtraBold", 96), m.FG, 160, 360, 1600, "center")
    if s.body <> invalid then Txt(m.view, s.body, DF("Text-Regular", 44), m.FG, 260, 520, 1400, "center")
end sub

sub setTheme(dark as Boolean)
    dots = m.top.findNode("dots")
    if dark
        m.FG = "0xFFF6E8FF"
        m.FG2 = "0xFFF6E8A6"
        m.SHADOW = "0x0B0716FF"
        m.PILL = m.RED
        dots.blendColor = "0xFFFFFFFF"
        dots.opacity = 0.16
    else
        m.FG = m.INK
        m.FG2 = "0x221836B3"
        m.SHADOW = m.INK
        m.PILL = m.INK
        dots.blendColor = m.INK
        dots.opacity = 1
    end if
end sub

' An imposter's face: sunglasses instead of an initial.
function Disguise(parent as Object, p as Object, x as Float, y as Float, size as Float) as Object
    g = parent.CreateChild("Group")
    g.translation = [x, y]
    ring = AddPoster(g, "pkg:/images/dot.png", -4, -4, size + 8, size + 8)
    ring.blendColor = m.INK
    d = AddPoster(g, "pkg:/images/dot.png", 0, 0, size, size)
    d.blendColor = "0xFFC93CFF"
    if p.color <> invalid then d.blendColor = p.color
    lens = size * 0.3
    for each lx in [size * 0.17, size * 0.53]
        l = AddPoster(g, "pkg:/images/dot.png", lx, size * 0.32, lens, lens * 0.82)
        l.blendColor = m.INK
    end for
    bar = g.CreateChild("Rectangle")
    bar.color = m.INK
    bar.translation = [size * 0.15, size * 0.36]
    bar.width = size * 0.7
    bar.height = size * 0.05
    return g
end function

' Clue order: numbered faces, whoever goes first is bigger.
sub drawTurns(s as Object)
    drawTitle(s)
    v = m.view
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), m.FG2, 160, 196, 1600, "center")
    if s.heading <> invalid then Txt(v, s.heading, DF("Display-ExtraBold", 96), m.FG, 160, 246, 1600, "center")
    if s.body <> invalid then Txt(v, s.body, DF("Text-Regular", 36), m.FG, 260, 380, 1400, "center")
    people = []
    if s.people <> invalid then people = s.people
    n = people.Count()
    if n > 16 then n = 16
    perRow = 8
    rows = (n + perRow - 1) \ perRow
    slotW = 210
    for i = 0 to n - 1
        row = i \ perRow
        k = n - row * perRow
        if k > perRow then k = perRow
        x0 = (1920 - k * slotW) / 2
        cx = x0 + (i mod perRow) * slotW + slotW / 2
        top = 470 + row * 210
        if rows = 1 then top = 520
        size = 110
        if i = 0 then size = 140
        ay = top + (140 - size) / 2
        Avatar(v, people[i], cx - size / 2, ay, size)
        fill = m.WHITE
        numColor = m.INK
        if i = 0
            fill = m.RED
            numColor = m.WHITE
        end if
        chip = DCard(v, cx - size / 2 - 30, ay - 22, 50, 50, fill)
        Txt(chip, (i + 1).ToStr(), DF("Display-ExtraBold", 30), numColor, 0, 6, 50, "center")
        nm = Txt(v, people[i].name, DF("Text-Bold", 30), m.FG, cx - slotW / 2, top + 152, slotW, "center")
        nm.wrap = false
    end for
    if s.callout <> invalid
        pill = DCard(v, 325, 892, 760, 80, m.PILL)
        Txt(pill, UCase(s.callout), DF("Display-ExtraBold", 36), m.WHITE, 0, 18, 760, "center")
    end if
    if s.note <> invalid then Txt(v, s.note, DF("Text-Bold", 28), m.FG2, 40, 998, 1370, "center")
end sub

' The reveal: a spotlight spins through everyone's faces and lands on the imposter(s), then the word, the
' votes and the scores appear. Spins once per round (key); a redraw of the same round shows it landed.
sub drawUnmask(s as Object)
    drawTitle(s)
    v = m.view
    cx = 420
    lead = "The imposter was..."
    if s.lead <> invalid then lead = s.lead
    Txt(v, lead, DF("Display-Bold", 50), m.FG, 60, 140, 720, "center")
    glow = AddPoster(v, "pkg:/images/dot.png", cx - 200, 180, 400, 400)
    glow.blendColor = "0xFFF6E8FF"
    glow.opacity = 0.14

    ' While spinning: one face at a time.
    m.spinBox = v.CreateChild("Group")
    m.spinFaces = []
    if s.everyone <> invalid then m.spinFaces = s.everyone

    ' Landed: everything else (hidden until then).
    m.landed = v.CreateChild("Group")
    m.landed.id = "unmaskLanded"
    imps = []
    if s.imposters <> invalid then imps = s.imposters
    n = imps.Count()
    size = 220
    if n = 2 then size = 170
    if n > 2 then size = 120
    gap = 40
    w = n * size + (n - 1) * gap
    midY = 380 ' the spotlight's centre (where the spinning face sits)
    for i = 0 to n - 1
        x = cx - w / 2 + i * (size + gap)
        Disguise(m.landed, imps[i], x, midY - size / 2, size)
        nm = Txt(m.landed, imps[i].name, DF("Display-ExtraBold", 48), m.FG, x - 60, midY + size / 2 + 14, size + 120, "center")
        nm.wrap = false
    end for
    if s.verdict <> invalid
        fill = m.RED
        tc = m.WHITE
        if Truthy(s.caught)
            fill = m.MINT
            tc = m.INK
        end if
        stamp = DCard(m.landed, cx - 165, 568, 330, 90, fill)
        stamp.id = "unmaskStamp"
        stamp.scaleRotateCenter = [165, 45]
        stamp.rotation = -0.12
        Txt(stamp, UCase(s.verdict), DF("Display-ExtraBold", 50), tc, 0, 14, 330, "center")
    end if
    ' The secret word.
    wc = DCard(m.landed, 100, 690, 640, 226, m.WHITE)
    Txt(wc, "The secret word was", DF("Text-Regular", 30), m.INK, 0, 18, 640, "center")
    word = ""
    if s.word <> invalid then word = s.word
    wl = Txt(wc, word, DF("Display-ExtraBold", 76), m.INK, 20, 54, 600, "center")
    wl.wrap = false
    if s.category <> invalid and s.category <> ""
        catL = Txt(wc, s.category, DF("Text-Bold", 26), m.INK, 0, 0, 0, "left")
        catL.wrap = false
        cw = TextWidth(catL) + 44
        wc.removeChild(catL) ' only here to measure; drawn inside its chip below
        chip = DCard(wc, (640 - cw) / 2, 156, cw, 50, "0x47B5FFFF")
        Txt(chip, s.category, DF("Text-Bold", 26), m.INK, 0, 9, cw, "center")
    end if
    drawTally(m.landed, s)
    drawRoundScores(m.landed, s)
    if s.note <> invalid then Txt(m.landed, s.note, DF("Text-Bold", 30), m.FG2, 40, 992, 1370, "center")

    ' Pop the stamp and fade the rest in when the spotlight lands.
    m.landAnim = v.CreateChild("Animation")
    m.landAnim.duration = 0.45
    m.landAnim.easeFunction = "outCubic"
    fade = m.landAnim.CreateChild("FloatFieldInterpolator")
    fade.key = [0, 1]
    fade.keyValue = [0, 1]
    fade.fieldToInterp = "unmaskLanded.opacity"
    if s.verdict <> invalid
        pop = m.landAnim.CreateChild("Vector2DFieldInterpolator")
        pop.key = [0, 0.4, 1]
        pop.keyValue = [[2.6, 2.6], [2.6, 2.6], [1, 1]]
        pop.fieldToInterp = "unmaskStamp.scale"
    end if

    key = ""
    if s.key <> invalid then key = s.key
    if key = m.spunKey or m.spinFaces.Count() < 2
        landSpotlight(false, key)
        return
    end if
    m.spinKey = key
    m.landed.visible = false
    m.spinI = 0
    showSpinFace()
    m.spinDelay = 0.07
    m.spin.duration = 0.5
    m.spin.control = "start"
end sub

sub showSpinFace()
    m.spinBox.removeChildrenIndex(m.spinBox.getChildCount(), 0)
    f = m.spinFaces[m.spinI mod m.spinFaces.Count()]
    Avatar(m.spinBox, f, 420 - 110, 380 - 110, 220)
end sub

sub onSpin()
    if m.spinBox = invalid then return
    m.spinI = m.spinI + 1
    showSpinFace()
    m.spinDelay = m.spinDelay * 1.13
    if m.spinDelay > 0.33
        landSpotlight(true, m.spinKey)
        return
    end if
    m.spin.duration = m.spinDelay
    m.spin.control = "start"
end sub

sub landSpotlight(animate as Boolean, key as String)
    m.spunKey = key
    m.spinBox.visible = false
    m.landed.visible = true
    if animate
        m.landed.opacity = 0
        m.landAnim.control = "start"
    end if
end sub

sub drawTally(parent as Object, s as Object)
    tally = []
    if s.tally <> invalid then tally = s.tally
    shown = tally.Count()
    if shown > 8 then shown = 8
    h = 92 + shown * 82
    if tally.Count() > shown then h = h + 40
    card = DCard(parent, 820, 150, 520, h, m.WHITE)
    Txt(card, "The votes", DF("Display-Bold", 36), m.INK, 28, 22, 400, "left")
    top = 1
    for each t in tally
        if t.count <> invalid and t.count > top then top = t.count
    end for
    for i = 0 to shown - 1
        t = tally[i]
        y = 84 + i * 82
        imp = Truthy(t.imp)
        if imp
            Disguise(card, t, 26, y + 4, 44)
        else
            Avatar(card, t, 26, y + 4, 44)
        end if
        nm = Txt(card, t.name, DF("Text-Bold", 28), m.INK, 86, y, 250, "left")
        nm.wrap = false
        if imp
            Txt(card, "IMPOSTER", DF("Display-ExtraBold", 22), m.RED, 300, y + 4, 130, "right")
        end if
        count = 0
        if t.count <> invalid then count = t.count
        Txt(card, count.ToStr(), DF("Display-ExtraBold", 34), m.INK, 440, y - 4, 56, "right")
        track = card.CreateChild("Rectangle")
        track.translation = [86, y + 42]
        track.width = 410
        track.height = 10
        track.color = "0xE9E4F2FF"
        if count > 0
            bar = card.CreateChild("Rectangle")
            bar.translation = [86, y + 42]
            bar.width = 410 * count / top
            bar.height = 10
            bar.color = "0x9B6CFFFF"
            if imp then bar.color = m.RED
        end if
        if t.voters <> invalid and t.voters <> ""
            vl = Txt(card, t.voters, DF("Text-Regular", 20), "0x22183699", 86, y + 54, 410, "left")
            vl.wrap = false
        end if
    end for
    if tally.Count() > shown
        Txt(card, "+" + (tally.Count() - shown).ToStr() + " more", DF("Text-Bold", 22), "0x22183699", 28, h - 46, 460, "left")
    end if
end sub

sub drawRoundScores(parent as Object, s as Object)
    rows = []
    if s.rows <> invalid then rows = s.rows
    shown = rows.Count()
    if shown > 11 then shown = 11
    h = 92 + shown * 60
    card = DCard(parent, 1380, 150, 480, h, m.WHITE)
    Txt(card, "Scores", DF("Display-Bold", 36), m.INK, 28, 22, 400, "left")
    for i = 0 to shown - 1
        r = rows[i]
        y = 84 + i * 60
        Txt(card, (i + 1).ToStr(), DF("Display-ExtraBold", 28), m.INK, 16, y + 2, 40, "center")
        Avatar(card, r, 64, y, 40)
        nm = Txt(card, r.name, DF("Text-Bold", 26), m.INK, 120, y + 3, 200, "left")
        nm.wrap = false
        score = "0"
        if r.score <> invalid then score = r.score.ToStr()
        Txt(card, score, DF("Display-ExtraBold", 30), m.INK, 320, y + 1, 80, "right")
        if r.delta <> invalid
            if r.delta > 0 then Txt(card, "+" + r.delta.ToStr(), DF("Display-Bold", 22), "0x1E9E73FF", 404, y + 7, 70, "left")
        end if
    end for
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
