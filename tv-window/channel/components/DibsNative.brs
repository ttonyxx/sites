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
'   fight / champ / tees  (Tee Party; see the Tee Party section)
'   fbready / fbturn / fbround / fbover  (Fishbowl; see the Fishbowl section)
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
    m.timerGroup = invalid
    m.sea = invalid
    m.flashSeq = -1
    m.fight = invalid
    m.fightNote = invalid
    m.fightCallout = ""
    m.teeKey = ""
    m.fbKey = ""
    m.fbTurn = invalid
    m.fbScores = []
    m.urgent = invalid
    m.top.findNode("flashTimer").observeField("fire", "onFlashDone")
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
    t = s.t
    ' Pirates changes every second or so: redraw only the parts of the sea that changed.
    if t = "sea" and m.sea <> invalid
        if m.sea.code = s.code
            updateSea(s)
            return
        end if
    end if
    m.sea = invalid
    ' Tee Party re-sends a fight as votes come in: just update the count.
    if t = "fight" and m.fight <> invalid and not Truthy(s.reveal) and s.key <> invalid and s.code <> invalid
        if m.fight.key = s.key and m.fight.code = s.code
            updateFight(s)
            if s.secs <> invalid and m.timerLabel <> invalid then setSecs(s.secs)
            return
        end if
    end if
    m.fight = invalid
    m.fightNote = invalid
    ' Fishbowl re-sends a turn on every card got: pop in the new cards, keep the clock running.
    if t = "fbturn" and m.fbTurn <> invalid and s.key <> invalid and s.code <> invalid
        if m.fbTurn.key = s.key and m.fbTurn.code = s.code
            updateFbTurn(s)
            if s.secs <> invalid and m.timerLabel <> invalid then setSecs(s.secs)
            return
        end if
    end if
    m.fbTurn = invalid
    m.urgent = invalid
    setTheme(Truthy(s.dark))
    if s.color <> invalid then m.top.findNode("bg").color = s.color
    m.spin.control = "stop"
    m.view.removeChildrenIndex(m.view.getChildCount(), 0)
    m.timerLabel = invalid
    m.timerGroup = invalid
    m.secs = 0
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
    else if t = "sea"
        drawSea(s)
    else if t = "haul"
        drawHaul(s)
    else if t = "fight"
        drawFight(s)
    else if t = "champ"
        drawChamp(s)
    else if t = "tees"
        drawTees(s)
    else if t = "fbready"
        drawFbReady(s)
    else if t = "fbturn"
        drawFbTurn(s)
    else if t = "fbround"
        drawFbRound(s)
    else if t = "fbover"
        drawFbOver(s)
    else
        drawMessage(s)
    end if
    drawChip(s, t <> "lobby" and s.code <> invalid)
    if s.secs <> invalid and t <> "sea" and t <> "fbturn" then drawTimer(s.secs) ' a turn draws its own big clock
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
            MiniPill(pc, cx + 122, cy - 18, 84, "HOST", "0xFFC93CFF")
        else if Truthy(p.bot)
            MiniPill(pc, cx + 122, cy - 18, 84, "BOT", m.MINT)
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
            ' Up to 12 faces at full size; bigger rooms (Punchline and Fishbowl take 16) squeeze in.
            pitch = 138
            if n * pitch > 1760 then pitch = 1760 / n
            size = 84
            if size > pitch - 26 then size = pitch - 26
            x0 = (1920 - n * pitch) / 2
            for i = 0 to n - 1
                p = s.players[i]
                ax = x0 + i * pitch + (pitch - size) / 2
                a = Avatar(v, p, ax, 790, size)
                if Truthy(p.done)
                    tick = DCard(v, ax + size - 30, 778, 44, 44, "0x2DD4A0FF")
                    Txt(tick, "OK", DF("Display-Bold", 18), m.INK, 0, 11, 44, "center")
                else
                    a.opacity = 0.55
                end if
                nm = Txt(v, p.name, DF("Text-Bold", 24), m.FG, x0 + i * pitch, 884, pitch, "center")
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

' ---- Pirates ------------------------------------------------------------------------------------
'   sea  { kicker, lastCall, paused, pool (letters in flip order), fresh (index of the newest tile), bagLeft, flips,
'          votes, secs, voteLabel, holds: [{name, color, score, bot, away, lead, voted, words: []}],
'          feed: [{seq, name, color, text, word, steal}] (newest first) }
'   haul { champs: [{name, color}], eyebrow, title, points, rows: [{name, color, score, bot, words, stats}],
'          awards: [{name, color, title, detail}], missed: [words], note }

' A small rounded label (pill.9.png is a perfect pill at 44 px tall).
function MiniPill(parent as Object, x as Float, y as Float, w as Float, text as String, fill as String) as Object
    g = parent.CreateChild("Group")
    g.translation = [x, y]
    p = AddPoster(g, "pkg:/images/pill.9.png", 0, 0, w, 44)
    p.blendColor = fill
    Txt(g, text, DF("Display-Bold", 20), m.INK, 0, 10, w, "center")
    return g
end function

' One letter tile: a pre-drawn tile image (outline and shadow included) and its letter.
sub LetterTile(parent as Object, l as String, x as Float, y as Float, size as Float, fill as String)
    p = AddPoster(parent, "pkg:/images/tile.png", x, y, size, size * 70 / 64)
    p.blendColor = fill
    t = parent.CreateChild("Label")
    t.font = DF("Display-ExtraBold", Cint(size * 0.6))
    t.color = m.INK
    t.translation = [x, y + size * 0.13]
    t.width = size
    t.horizAlign = "center"
    t.text = l
end sub

' Width of a word drawn as tiles.
function WordWidth(word as String, size as Float) as Float
    return Len(word) * (size + size * 0.1) - size * 0.1
end function

sub drawSea(s as Object)
    drawTitle(s)
    v = m.view
    m.sea = { code: s.code, sigs: {} }
    for each k in ["phase", "holds", "flags", "pool", "status", "feed"]
        m.sea[k] = v.CreateChild("Group")
    end for
    m.sea.flash = v.CreateChild("Group")
    ' Old steals aren't news: only flash ones that happen from here on.
    m.flashSeq = -1
    if s.feed <> invalid and s.feed.Count() > 0 then m.flashSeq = s.feed[0].seq
    updateSea(s)
end sub

' The cards without the vote flags (those flip every second; the cards only change on a claim).
function HoldsSig(holds as Dynamic) as Object
    out = []
    if holds = invalid then return out
    for each h in holds
        c = {}
        c.Append(h)
        c.Delete("voted")
        out.Push(c)
    end for
    return out
end function

' Redraw each part only when what it shows changed.
sub updateSea(s as Object)
    parts = {
        phase: [s.kicker, s.lastCall]
        holds: HoldsSig(s.holds)
        flags: [s.holds, s.voteLabel]
        pool: [s.pool, s.fresh, s.flips]
        status: [s.bagLeft, s.votes, s.lastCall, s.paused]
        feed: s.feed
    }
    for each k in parts
        sig = FormatJson(parts[k])
        if m.sea.sigs[k] <> sig
            m.sea.sigs[k] = sig
            g = m.sea[k]
            g.removeChildrenIndex(g.getChildCount(), 0)
            if k = "phase" then drawSeaPhase(g, s)
            if k = "holds" then drawHolds(g, s)
            if k = "flags" then drawVoteFlags(g, s)
            if k = "pool" then drawPool(g, s)
            if k = "status" then drawSeaStatus(g, s)
            if k = "feed" then drawFeed(g, s)
        end if
    end for
    ' Clock: the next flip, or the end of last call.
    if s.secs <> invalid
        if m.timerGroup = invalid
            drawTimer(s.secs)
        else
            m.timerGroup.visible = true
            setSecs(s.secs)
        end if
    else if m.timerGroup <> invalid
        m.timerGroup.visible = false
    end if
    ' A steal gets a banner.
    if s.feed <> invalid and s.feed.Count() > 0
        e = s.feed[0]
        if e.seq > m.flashSeq
            m.flashSeq = e.seq
            if Truthy(e.steal) then showFlash(e)
        end if
    end if
end sub

sub drawSeaPhase(g as Object, s as Object)
    text = "GRAB AND STEAL"
    if s.kicker <> invalid then text = UCase(s.kicker)
    fill = m.WHITE
    tc = m.INK
    if Truthy(s.lastCall)
        fill = m.RED
        tc = m.WHITE
    end if
    pill = DCard(g, 600, 66, 380, 66, fill)
    Txt(pill, text, DF("Display-ExtraBold", 32), tc, 0, 13, 380, "center")
end sub

' Where each pirate's card goes (the same for the cards and the vote badges drawn over them).
function HoldLayout(n as Integer) as Object
    L = { cols: 1, gap: 18 }
    if n > 4 then L.cols = 2
    L.rows = (n + L.cols - 1) \ L.cols
    L.w = (940 - (L.cols - 1) * L.gap) / L.cols
    L.h = Int((870 - (L.rows - 1) * L.gap) / L.rows)
    if L.h > 300 then L.h = 300
    L.tile = 34
    if L.cols = 2 or L.rows > 3 then L.tile = 28
    return L
end function

function HoldPos(i as Integer, L as Object) as Object
    return [60 + (i mod L.cols) * (L.w + L.gap), 172 + (i \ L.cols) * (L.h + L.gap)]
end function

' "FLIP" / "DONE" badges: they change all the time, so they live in their own layer over the cards.
sub drawVoteFlags(g as Object, s as Object)
    holds = []
    if s.holds <> invalid then holds = s.holds
    L = HoldLayout(holds.Count())
    vt = "FLIP"
    if s.voteLabel <> invalid then vt = s.voteLabel
    for i = 0 to holds.Count() - 1
        if Truthy(holds[i].voted)
            xy = HoldPos(i, L)
            MiniPill(g, xy[0] + L.w - 170, xy[1] + 14, 74, vt, m.MINT)
        end if
    end for
end sub

sub drawHolds(g as Object, s as Object)
    holds = []
    if s.holds <> invalid then holds = s.holds
    n = holds.Count()
    if n = 0 then return
    L = HoldLayout(n)
    w = L.w
    h = L.h
    tile = L.tile
    for i = 0 to n - 1
        p = holds[i]
        xy = HoldPos(i, L)
        card = DCard(g, xy[0], xy[1], w, h, m.WHITE)
        if Truthy(p.away) then card.opacity = 0.6
        Avatar(card, p, 16, 14, 44)
        ' Right to left: score, the vote badge's slot (drawn by drawVoteFlags), BOT, TOP.
        bx = w - 176
        if Truthy(p.bot)
            MiniPill(card, bx - 62, 14, 56, "BOT", "0xE9E4F2FF")
            bx = bx - 62
        end if
        if Truthy(p.lead)
            MiniPill(card, bx - 62, 14, 56, "TOP", "0xFFC93CFF")
            bx = bx - 62
        end if
        nm = Txt(card, p.name, DF("Display-Bold", 30), m.INK, 72, 16, bx - 80, "left")
        nm.wrap = false
        score = "0"
        if p.score <> invalid then score = p.score.ToStr()
        Txt(card, score, DF("Display-ExtraBold", 40), m.INK, w - 100, 12, 80, "right")
        ' Their words, as tiles, wrapping; whatever doesn't fit becomes "+N more".
        words = []
        if p.words <> invalid then words = p.words
        if words.Count() = 0
            Txt(card, "No words yet", DF("Text-Regular", 24), "0x22183680", 20, 76, w - 40, "left")
        else
            wx = 18
            wy = 74
            rowStep = tile * 1.09 + 10
            placed = [] ' { g, x, y } per word drawn, so the last one can make room for "+N more"
            for each word in words
                ww = WordWidth(word, tile)
                if wx + ww > w - 18 and wx > 18
                    wx = 18
                    wy = wy + rowStep
                end if
                if wy + rowStep > h - 6 then exit for
                wg = card.CreateChild("Group")
                for c = 0 to Len(word) - 1
                    LetterTile(wg, Mid(word, c + 1, 1), wx + c * tile * 1.1, wy, tile, "0xFFF3D6FF")
                end for
                placed.Push({ g: wg, x: wx, y: wy, endX: wx + ww })
                wx = wx + ww + tile * 0.6
            end for
            if placed.Count() < words.Count()
                ' Put "+N more" after the last word, giving up that word if there isn't room.
                lastW = placed[placed.Count() - 1]
                x = lastW.endX + tile * 0.6
                if x + 110 > w - 18 and placed.Count() > 1
                    card.removeChild(lastW.g)
                    placed.Pop()
                    x = lastW.x
                end if
                more = Txt(card, "+" + (words.Count() - placed.Count()).ToStr() + " more", DF("Text-Bold", 22), "0x22183699", x, lastW.y + tile * 0.12, 120, "left")
                more.wrap = false
            end if
        end if
    end for
end sub

sub drawPool(g as Object, s as Object)
    card = DCard(g, 1040, 172, 820, 528, "0xF6DCA2FF")
    pool = ""
    if s.pool <> invalid then pool = s.pool
    n = Len(pool)
    Txt(card, "The pool", DF("Display-Bold", 36), m.INK, 30, 20, 400, "left")
    Txt(card, n.ToStr(), DF("Display-Bold", 36), "0x22183680", 200, 20, 200, "left")
    if n = 0
        msg = "Tiles flip here"
        if s.flips <> invalid and s.flips > 0 then msg = "Empty! Every tile is in a word."
        Txt(card, msg, DF("Text-Regular", 32), "0x22183699", 0, 240, 820, "center")
        return
    end if
    ' The biggest tiles that fit the box.
    areaW = 760
    areaH = 410
    size = 28
    for each sz in [76, 66, 58, 50, 44, 38, 33, 28]
        gap = sz * 0.16
        cols = Int((areaW + gap) / (sz + gap))
        rows = (n + cols - 1) \ cols
        if rows * (sz * 1.09 + gap) <= areaH
            size = sz
            exit for
        end if
    end for
    gap = size * 0.16
    cols = Int((areaW + gap) / (size + gap))
    fresh = -1
    if s.fresh <> invalid then fresh = s.fresh
    for i = 0 to n - 1
        fill = "0xFFF3D6FF"
        if i = fresh then fill = "0xFFC93CFF"
        LetterTile(card, Mid(pool, i + 1, 1), 30 + (i mod cols) * (size + gap), 86 + (i \ cols) * (size * 1.09 + gap), size, fill)
    end for
end sub

sub drawSeaStatus(g as Object, s as Object)
    left = 0
    if s.bagLeft <> invalid then left = s.bagLeft
    if Truthy(s.lastCall)
        Txt(g, "Bag's empty. Grab what you can!", DF("Display-ExtraBold", 34), m.FG, 1040, 724, 560, "left")
    else
        bag = left.ToStr() + " tiles left"
        if left = 1 then bag = "1 tile left"
        Txt(g, bag, DF("Display-ExtraBold", 40), m.FG, 1040, 720, 400, "left")
    end if
    line = ""
    if s.votes <> invalid then line = s.votes
    if Truthy(s.paused) then line = "Paused: nobody's connected"
    if line <> "" then Txt(g, line, DF("Text-Bold", 28), m.FG2, 1440, 730, 420, "right")
end sub

sub drawFeed(g as Object, s as Object)
    feed = []
    if s.feed <> invalid then feed = s.feed
    for i = 0 to feed.Count() - 1
        if i >= 3 then exit for
        e = feed[i]
        y = 800 + i * 44
        Avatar(g, e, 1040, y, 32)
        l = Txt(g, e.name + " " + e.text, DF("Text-Bold", 26), m.FG, 1086, y + 2, 780, "left")
        l.wrap = false
        if i > 0 then l.opacity = 0.7
    end for
end sub

sub showFlash(e as Object)
    g = m.sea.flash
    g.removeChildrenIndex(g.getChildCount(), 0)
    card = DCard(g, 1040, 172, 820, 110, m.RED)
    Avatar(card, e, 22, 22, 66)
    l = Txt(card, e.name + " steals!", DF("Display-ExtraBold", 40), m.WHITE, 106, 12, 690, "left")
    l.wrap = false
    d = Txt(card, e.text, DF("Text-Bold", 28), m.WHITE, 106, 62, 690, "left")
    d.wrap = false
    g.visible = true
    t = m.top.findNode("flashTimer")
    t.control = "stop"
    t.control = "start"
end sub

sub onFlashDone()
    if m.sea <> invalid then m.sea.flash.visible = false
end sub

' Game over: the captain, everyone's haul, awards and the words nobody made.
sub drawHaul(s as Object)
    drawTitle(s)
    v = m.view
    ' Champion card.
    champ = DCard(v, 80, 170, 700, 400, m.WHITE)
    champs = []
    if s.champs <> invalid then champs = s.champs
    n = champs.Count()
    if n > 0
        size = 130
        if n > 1 then size = 96
        if n > 3 then size = 72
        gap = 24
        w = n * size + (n - 1) * gap
        for i = 0 to n - 1
            Avatar(champ, champs[i], (700 - w) / 2 + i * (size + gap), 40, size)
        end for
        badge = DCard(champ, (700 + w) / 2 - 30, 22, 110, 40, "0xFFC93CFF")
        Txt(badge, "CAPTAIN", DF("Display-Bold", 18), m.INK, 0, 10, 110, "center")
    end if
    eyebrow = ""
    if s.eyebrow <> invalid and n > 0 then eyebrow = UCase(s.eyebrow)
    Txt(champ, eyebrow, DF("Display-Bold", 26), "0x22183699", 0, 196, 700, "center")
    title = ""
    if s.title <> invalid then title = s.title
    tl = Txt(champ, title, DF("Display-ExtraBold", 60), m.INK, 20, 230, 660, "center")
    tl.wrap = false
    if s.points <> invalid then Txt(champ, s.points, DF("Text-Bold", 32), m.INK, 0, 318, 700, "center")
    ' Awards, two by two.
    awards = []
    if s.awards <> invalid then awards = s.awards
    for i = 0 to awards.Count() - 1
        if i >= 4 then exit for
        a = awards[i]
        ax = 80 + (i mod 2) * 360
        ay = 600 + (i \ 2) * 170
        card = DCard(v, ax, ay, 340, 150, m.WHITE)
        Avatar(card, a, 18, 18, 48)
        Txt(card, UCase(a.title), DF("Display-Bold", 18), "0x22183699", 80, 18, 245, "left")
        nm = Txt(card, a.name, DF("Display-Bold", 28), m.INK, 80, 42, 245, "left")
        nm.wrap = false
        if a.detail <> invalid
            d = Txt(card, a.detail, DF("Text-Regular", 21), m.INK, 18, 86, 305, "left")
            d.maxLines = 2
        end if
    end for
    ' Everyone's haul.
    Txt(v, "The haul", DF("Display-ExtraBold", 44), m.FG, 830, 160, 600, "left")
    rows = []
    if s.rows <> invalid then rows = s.rows
    for i = 0 to rows.Count() - 1
        if i >= 8 then exit for
        r = rows[i]
        fill = m.WHITE
        if i = 0 and n > 0 then fill = "0xFFF1B8FF"
        row = DCard(v, 830, 228 + i * 88, 1030, 78, fill)
        Txt(row, (i + 1).ToStr(), DF("Display-ExtraBold", 34), m.INK, 10, 16, 50, "center")
        Avatar(row, r, 66, 12, 54)
        name = r.name
        if Truthy(r.bot) then name = name + "  (bot)"
        nm = Txt(row, name, DF("Display-Bold", 30), m.INK, 136, 6, 330, "left")
        nm.wrap = false
        if r.stats <> invalid
            st = Txt(row, r.stats, DF("Text-Regular", 20), "0x22183699", 136, 44, 330, "left")
            st.wrap = false
        end if
        words = ""
        if r.words <> invalid
            for each w in r.words
                if words <> "" then words = words + "   "
                words = words + w
            end for
        end if
        wl = Txt(row, words, DF("Display-Bold", 24), m.INK, 480, 0, 420, "left")
        wl.height = 78
        wl.vertAlign = "center"
        wl.wrap = true
        wl.maxLines = 2
        score = "0"
        if r.score <> invalid then score = r.score.ToStr()
        Txt(row, score, DF("Display-ExtraBold", 40), m.INK, 900, 14, 110, "right")
    end for
    line = ""
    if s.missed <> invalid
        if s.missed.Count() > 0
            line = "Missed loot: "
            for i = 0 to s.missed.Count() - 1
                if i > 0 then line = line + ", "
                line = line + s.missed[i]
            end for
        else
            line = "Clean sweep: not a word left to make."
        end if
    end if
    if line <> ""
        ml = Txt(v, line, DF("Text-Bold", 26), m.FG2, 80, 944, 1330, "left")
        ml.wrap = false
    end if
    if s.note <> invalid then Txt(v, s.note, DF("Display-Bold", 32), m.FG, 80, 994, 1330, "left")
end sub

' ---- Tee Party -----------------------------------------------------------------------------------
'   fight { key, kicker, shirts: [a, b], reveal (bool), callout, note, headline, points: [{name, color, points}], secs }
'           shirt = { img, corner, votes, voters: [{name, color}], won, ko, badge, credits: [lines] } (votes on: reveal)
'   champ { key, kicker, title, img, wins, credits: [lines], note, secs }
'   tees  { key, kicker, img, credits: [lines], empty, rows: [{name, color, score}], awards: [{title, name, color, detail}], note }
' img is a shirt the home streamer painted ("/tee.png?k=..." under base). Each key animates once.

' A painted shirt, over a faint blank one with the same outline that shows until the image arrives.
function TeeShirt(parent as Object, img as Dynamic, x as Float, y as Float, size as Float) as Object
    g = parent.CreateChild("Group")
    g.translation = [x, y]
    AddPoster(g, "pkg:/images/tko_blank.png", 0, 0, size, size)
    if img <> invalid and m.top.base <> ""
        p = AddPoster(g, m.top.base + img, 0, 0, size, size)
        p.loadWidth = size
        p.loadHeight = size
        p.loadDisplayMode = "scaleToFit"
    end if
    return g
end function

' Interpolates node "target" (id.field) through values at the given seconds of anim (which starts at 0).
sub Keyframes(anim as Object, kind as String, target as String, times as Object, values as Object)
    it = anim.CreateChild(kind)
    keys = []
    for each t in times
        k = t / anim.duration
        if k > 1 then k = 1
        keys.Push(k)
    end for
    it.key = keys
    it.keyValue = values
    it.fieldToInterp = target
end sub

function NewAnim(parent as Object, seconds as Float) as Object
    a = parent.CreateChild("Animation")
    a.duration = seconds
    a.easeFunction = "linear"
    return a
end function

' Uppercase label on an outlined chip, sized to its text.
function CornerChip(parent as Object, text as String, cx as Float, y as Float, fill as String, tc as String) as Object
    font = DF("Display-ExtraBold", 26)
    probe = Txt(parent, UCase(text), font, tc, 0, 0, 0, "left")
    probe.wrap = false
    w = TextWidth(probe) + 52
    parent.removeChild(probe)
    chip = DCard(parent, cx - w / 2, y, w, 56, fill)
    Txt(chip, UCase(text), font, tc, 0, 12, w, "center")
    return chip
end function

sub drawFight(s as Object)
    drawTitle(s)
    v = m.view
    reveal = Truthy(s.reveal)
    key = ""
    if s.key <> invalid then key = s.key
    animate = key <> m.teeKey
    m.teeKey = key
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), m.FG2, 560, 150, 800, "center")
    shirts = []
    if s.shirts <> invalid then shirts = s.shirts
    if shirts.Count() < 2 then return
    W = 660
    H = 694
    Y = 206
    xs = [170, 1090]
    fills = ["0xFFE3DEFF", "0xDDF1FFFF"]
    tilt = [-0.026, 0.026]
    size = 580
    shirtY = 92
    if reveal
        size = 440
        shirtY = 86
        H = 676
    end if
    nV = 0
    for each sh in shirts
        if sh.voters <> invalid then nV = nV + sh.voters.Count()
    end for
    knockAt = 0.6 + nV * 0.16
    anim = invalid
    if animate
        if reveal then anim = NewAnim(v, knockAt + 0.7) else anim = NewAnim(v, 1.0)
    end if
    voter = 0
    for i = 0 to 1
        sh = shirts[i]
        g = v.CreateChild("Group")
        g.id = "teeSide" + i.ToStr()
        g.translation = [xs[i], Y]
        g.scaleRotateCenter = [W / 2, H / 2]
        g.rotation = tilt[i]
        DCard(g, 0, 0, W, H, fills[i])
        corner = ""
        if sh.corner <> invalid then corner = sh.corner
        if i = 0
            CornerChip(g, corner, W / 2, 22, "0xFF6B57FF", m.WHITE)
        else
            CornerChip(g, corner, W / 2, 22, "0x47B5FFFF", m.INK)
        end if
        TeeShirt(g, sh.img, (W - size) / 2, shirtY, size)
        if reveal
            ' Votes and who cast them, then who made it.
            votes = 0
            if sh.votes <> invalid then votes = sh.votes
            label = votes.ToStr() + " vote"
            if votes <> 1 then label = label + "s"
            voters = []
            if sh.voters <> invalid then voters = sh.voters
            shown = voters.Count()
            if shown > 7 then shown = 7
            probe = Txt(g, label, DF("Display-ExtraBold", 34), m.INK, 0, 0, 0, "left")
            probe.wrap = false
            lw = TextWidth(probe)
            g.removeChild(probe)
            rowW = lw
            if shown > 0 then rowW = lw + 20 + 44 + (shown - 1) * 34
            rx = (W - rowW) / 2
            Txt(g, label, DF("Display-ExtraBold", 34), m.INK, rx, 538, lw + 10, "left")
            for j = 0 to shown - 1
                a = Avatar(g, voters[j], rx + lw + 20 + j * 34, 540, 40)
                a.id = "teeVoter" + voter.ToStr()
                if anim <> invalid
                    a.opacity = 0
                    t = 0.25 + voter * 0.16
                    Keyframes(anim, "FloatFieldInterpolator", a.id + ".opacity", [0, t, t + 0.12, anim.duration], [0.0, 0.0, 1.0, 1.0])
                end if
                voter = voter + 1
            end for
            line = ""
            if sh.credits <> invalid
                for each c in sh.credits
                    if line <> "" then line = line + "   " + Chr(183) + "   "
                    line = line + c
                end for
            end if
            cl = Txt(g, line, DF("Text-Bold", 25), m.INK, 30, 594, W - 60, "center")
            cl.maxLines = 2
            ' The knockout: the loser tips over, the winner gets a badge.
            if Truthy(sh.ko)
                ko = AddPoster(g, "pkg:/images/tko_ko.png", (W - 320) / 2, shirtY + size / 2 - 75, 320, 150)
                ko.id = "teeKO"
                ko.scaleRotateCenter = [160, 75]
                ko.rotation = -0.21
                lostRot = tilt[i] * 3.5
                if anim <> invalid
                    ko.opacity = 0
                    Keyframes(anim, "FloatFieldInterpolator", "teeKO.opacity", [0, knockAt, knockAt + 0.08, anim.duration], [0.0, 0.0, 1.0, 1.0])
                    Keyframes(anim, "Vector2DFieldInterpolator", "teeKO.scale", [0, knockAt, knockAt + 0.3, anim.duration], [[3.0, 3.0], [3.0, 3.0], [1.0, 1.0], [1.0, 1.0]])
                    Keyframes(anim, "FloatFieldInterpolator", g.id + ".rotation", [0, knockAt, knockAt + 0.35, anim.duration], [tilt[i], tilt[i], lostRot, lostRot])
                    Keyframes(anim, "Vector2DFieldInterpolator", g.id + ".translation", [0, knockAt, knockAt + 0.35, anim.duration], [[xs[i], Y], [xs[i], Y], [xs[i], Y + 14], [xs[i], Y + 14]])
                    Keyframes(anim, "FloatFieldInterpolator", g.id + ".opacity", [0, knockAt, knockAt + 0.35, anim.duration], [1.0, 1.0, 0.55, 0.55])
                else
                    g.rotation = lostRot
                    g.translation = [xs[i], Y + 14]
                    g.opacity = 0.55
                end if
            end if
            if sh.badge <> invalid
                badge = CornerChip(g, sh.badge, W - 150, -30, "0xFFC93CFF", m.INK)
                badge.id = "teeBadge"
                badge.scaleRotateCenter = [100, 28]
                if anim <> invalid
                    badge.opacity = 0
                    t = knockAt + 0.15
                    Keyframes(anim, "FloatFieldInterpolator", "teeBadge.opacity", [0, t, t + 0.1, anim.duration], [0.0, 0.0, 1.0, 1.0])
                    Keyframes(anim, "Vector2DFieldInterpolator", "teeBadge.scale", [0, t, t + 0.18, t + 0.3, anim.duration], [[0.5, 0.5], [0.5, 0.5], [1.15, 1.15], [1.0, 1.0], [1.0, 1.0]])
                end if
                if Truthy(sh.won) and anim <> invalid
                    Keyframes(anim, "Vector2DFieldInterpolator", g.id + ".scale", [0, knockAt, knockAt + 0.2, knockAt + 0.45, anim.duration], [[1.0, 1.0], [1.0, 1.0], [1.06, 1.06], [1.02, 1.02], [1.02, 1.02]])
                else if Truthy(sh.won)
                    g.scale = [1.02, 1.02]
                end if
            end if
        else if anim <> invalid
            ' The fighters slide in from the sides.
            from = xs[i] - 300
            if i = 1 then from = xs[i] + 300
            g.opacity = 0
            g.translation = [from, Y]
            t0 = 0.05 + i * 0.2
            Keyframes(anim, "Vector2DFieldInterpolator", g.id + ".translation", [0, t0, t0 + 0.32, t0 + 0.45, anim.duration], [[from, Y], [from, Y], [xs[i] + (xs[i] - from) * 0.04, Y], [xs[i], Y], [xs[i], Y]])
            Keyframes(anim, "FloatFieldInterpolator", g.id + ".opacity", [0, t0, t0 + 0.2, anim.duration], [0.0, 0.0, 1.0, 1.0])
        end if
    end for
    if not reveal
        vs = AddPoster(v, "pkg:/images/tko_vs.png", 960 - 90, 480, 180, 144)
        vs.id = "teeVS"
        vs.scaleRotateCenter = [90, 72]
        if anim <> invalid
            vs.scale = [0, 0]
            Keyframes(anim, "Vector2DFieldInterpolator", "teeVS.scale", [0, 0.55, 0.75, 0.88, 1.0], [[0.0, 0.0], [0.0, 0.0], [1.2, 1.2], [0.95, 0.95], [1.0, 1.0]])
            Keyframes(anim, "FloatFieldInterpolator", "teeVS.rotation", [0, 0.55, 0.8, 1.0], [-0.7, -0.7, 0.05, 0.0])
        end if
        line = ""
        if s.callout <> invalid then line = s.callout
        note = ""
        if s.note <> invalid then note = s.note
        if note <> "" then line = line + "   " + Chr(183) + "   " + note
        m.fightNote = Txt(v, line, DF("Display-ExtraBold", 38), m.FG, 40, 944, 1370, "center")
        m.fightCallout = ""
        if s.callout <> invalid then m.fightCallout = s.callout
    else
        verdict = v.CreateChild("Group")
        verdict.id = "teeVerdict"
        headline = ""
        if s.headline <> invalid then headline = s.headline
        Txt(verdict, headline, DF("Display-ExtraBold", 50), m.FG, 40, 914, 1370, "center")
        points = []
        if s.points <> invalid then points = s.points
        pills = []
        total = 0
        for each p in points
            text = "+" + p.points.ToStr() + "  " + p.name
            probe = Txt(verdict, text, DF("Display-Bold", 20), m.INK, 0, 0, 0, "left")
            probe.wrap = false
            w = TextWidth(probe) + 40
            verdict.removeChild(probe)
            pills.Push({ text: text, w: w })
            total = total + w + 12
            if pills.Count() >= 6 then exit for
        end for
        x = 40 + (1370 - total + 12) / 2
        for each pl in pills
            MiniPill(verdict, x, 984, pl.w, pl.text, m.WHITE)
            x = x + pl.w + 12
        end for
        if anim <> invalid
            verdict.opacity = 0
            Keyframes(anim, "FloatFieldInterpolator", "teeVerdict.opacity", [0, knockAt, knockAt + 0.25, anim.duration], [0.0, 0.0, 1.0, 1.0])
        end if
    end if
    if anim <> invalid then anim.control = "start"
    if not reveal and s.code <> invalid then m.fight = { key: key, code: s.code }
end sub

' Only the vote count changed: rewrite the line under the fight.
sub updateFight(s as Object)
    if m.fightNote = invalid then return
    line = m.fightCallout
    if s.note <> invalid then line = line + "   " + Chr(183) + "   " + s.note
    m.fightNote.text = line
end sub

sub drawChamp(s as Object)
    drawTitle(s)
    v = m.view
    key = ""
    if s.key <> invalid then key = s.key
    animate = key <> m.teeKey
    m.teeKey = key
    size = 600
    X = 230
    Y = 200
    ' The drop (teeDrop, an offset) and the swing (teeChamp's rotation) are separate nodes.
    drop = v.CreateChild("Group")
    drop.id = "teeDrop"
    g = drop.CreateChild("Group")
    g.id = "teeChamp"
    g.translation = [X, Y]
    g.scaleRotateCenter = [size / 2, size / 2]
    TeeShirt(g, s.img, 0, 0, size)
    ' The belt hangs across the hem, like the web's.
    bw = size * 0.72
    bh = bw * 135 / 450
    belt = AddPoster(g, "pkg:/images/tko_belt.png", (size - bw) / 2, size * 1.15 - bh, bw, bh)
    belt.id = "teeBelt"
    belt.scaleRotateCenter = [bw / 2, bh / 2]
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 36), m.FG2, 960, 250, 860, "left")
    title = ""
    if s.title <> invalid then title = s.title
    Txt(v, title, DF("Display-ExtraBold", 100), m.FG, 960, 296, 880, "left")
    if s.wins <> invalid then Txt(v, s.wins, DF("Display-ExtraBold", 48), m.FG, 960, 548, 880, "left")
    y = 640
    if s.credits <> invalid
        for each c in s.credits
            Txt(v, c, DF("Text-Bold", 36), m.FG, 960, y, 880, "left")
            y = y + 54
        end for
    end if
    if s.note <> invalid then Txt(v, s.note, DF("Text-Regular", 30), m.FG2, 960, 840, 860, "left")
    if animate
        anim = NewAnim(v, 1.3)
        drop.translation = [0, -900]
        g.rotation = -0.24
        belt.scale = [0, 0]
        Keyframes(anim, "Vector2DFieldInterpolator", "teeDrop.translation", [0, 0.2, 0.62, 0.78, 0.92, 1.3], [[0, -900], [0, -900], [0, 24], [0, -10], [0, 0], [0, 0]])
        Keyframes(anim, "FloatFieldInterpolator", "teeChamp.rotation", [0, 0.2, 0.7, 1.3], [-0.24, -0.24, 0.0, 0.0])
        Keyframes(anim, "Vector2DFieldInterpolator", "teeBelt.scale", [0, 0.8, 1.0, 1.12, 1.3], [[0.0, 0.0], [0.0, 0.0], [1.15, 1.15], [0.97, 0.97], [1.0, 1.0]])
        Keyframes(anim, "FloatFieldInterpolator", "teeBelt.rotation", [0, 0.8, 1.1, 1.3], [0.5, 0.5, 0.0, 0.0])
        anim.control = "start"
    end if
end sub

' Game over: the tee of the night and who made it, the scores, and the awards.
sub drawTees(s as Object)
    drawTitle(s)
    v = m.view
    key = ""
    if s.key <> invalid then key = s.key
    animate = key <> m.teeKey
    m.teeKey = key
    if s.img <> invalid
        if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), m.FG, 80, 158, 700, "center")
        g = v.CreateChild("Group")
        g.id = "teeWinner"
        g.translation = [150, 206]
        g.scaleRotateCenter = [280, 280]
        TeeShirt(g, s.img, 0, 0, 560)
        y = 780
        if s.credits <> invalid
            for each c in s.credits
                Txt(v, c, DF("Text-Bold", 32), m.FG, 80, y, 700, "center")
                y = y + 46
            end for
        end if
        if animate
            anim = NewAnim(v, 1.0)
            g.opacity = 0
            g.scale = [0.3, 0.3]
            Keyframes(anim, "FloatFieldInterpolator", "teeWinner.opacity", [0, 0.3, 0.5, 1.0], [0.0, 0.0, 1.0, 1.0])
            Keyframes(anim, "Vector2DFieldInterpolator", "teeWinner.scale", [0, 0.3, 0.72, 0.86, 1.0], [[0.3, 0.3], [0.3, 0.3], [1.06, 1.06], [0.98, 0.98], [1.0, 1.0]])
            Keyframes(anim, "FloatFieldInterpolator", "teeWinner.rotation", [0, 0.3, 0.8, 1.0], [-0.28, -0.28, 0.0, 0.0])
            anim.control = "start"
        end if
    else
        card = DCard(v, 80, 300, 700, 360, m.WHITE)
        empty = "No shirts this time!"
        if s.empty <> invalid then empty = s.empty
        el = Txt(card, empty, DF("Display-ExtraBold", 48), m.INK, 50, 0, 600, "center")
        el.height = 360
        el.vertAlign = "center"
    end if
    ' Scores.
    Txt(v, "Scores", DF("Display-ExtraBold", 44), m.FG, 840, 150, 600, "left")
    rows = []
    if s.rows <> invalid then rows = s.rows
    for i = 0 to rows.Count() - 1
        if i >= 8 then exit for
        r = rows[i]
        fill = m.WHITE
        if i = 0 then fill = "0xFFF1B8FF"
        row = DCard(v, 840, 222 + i * 70, 1020, 58, fill)
        Txt(row, (i + 1).ToStr(), DF("Display-ExtraBold", 32), m.INK, 10, 9, 50, "center")
        Avatar(row, r, 70, 7, 44)
        nm = Txt(row, r.name, DF("Display-Bold", 30), m.INK, 134, 10, 640, "left")
        nm.wrap = false
        score = "0"
        if r.score <> invalid then score = r.score.ToStr()
        Txt(row, score, DF("Display-ExtraBold", 34), m.INK, 780, 7, 210, "right")
    end for
    ' Awards, side by side.
    awards = []
    if s.awards <> invalid then awards = s.awards
    shownRows = rows.Count()
    if shownRows > 8 then shownRows = 8
    awardsY = 222 + shownRows * 70 + 30
    for i = 0 to awards.Count() - 1
        if i >= 3 then exit for
        a = awards[i]
        card = DCard(v, 840 + i * 346, awardsY, 328, 120, m.WHITE)
        Avatar(card, a, 16, 16, 44)
        Txt(card, UCase(a.title), DF("Display-Bold", 18), "0x22183699", 74, 14, 240, "left")
        nm = Txt(card, a.name, DF("Display-Bold", 28), m.INK, 74, 36, 240, "left")
        nm.wrap = false
        if a.detail <> invalid
            d = Txt(card, a.detail, DF("Text-Regular", 20), m.INK, 16, 80, 296, "left")
            d.wrap = false
        end if
    end for
    if s.note <> invalid then Txt(v, s.note, DF("Display-Bold", 32), m.FG, 80, 994, 1330, "left")
end sub

' ---- Fishbowl -----------------------------------------------------------------------------------
'   fbready { key, round, rule, ruleText, giver: {name, color, away}, team, fill, ink, carry, hint,
'             recap: {name, color, team, fill, ink, text, got: []}, left, total, board }
'   fbturn  { key, round, giver: {name, color}, team, fill, ink, heading, rule, got: [], left, total, board, secs }
'             (re-sent on every card got: only the new cards, the count and the scores change)
'   fbround { key, kicker, title, table, recap, next: {round, title, text}, starter, note, secs }
'   fbover  { key, title, fill, ink, faces: [{name, color}], table, givers: [{name, color, score, team, fill, ink}],
'             bowl: [{text, author}], cards, note }
'   board = [{team, fill, ink, score, up, faces: [{name, color, giver, away}]}]
'   table = { rounds: [{label, title}], rows: [{team, fill, ink, scores: [], total, win}] }
' team fill/ink are the web's team colors: Goldfish yellow with ink text, Jellyfish purple with white text.

function FbText(v as Dynamic) as String
    if v = invalid then return ""
    return v
end function

function FbNum(v as Dynamic) as String
    if v = invalid then return "0"
    return v.ToStr()
end function

function FbWidth(parent as Object, text as String, font as Object) as Float
    probe = Txt(parent, text, font, m.INK, 0, 0, 0, "left")
    probe.wrap = false
    w = TextWidth(probe)
    parent.removeChild(probe)
    return w
end function

' A team's name on its color, outlined like the web's team chips. Returns its width.
function FbTag(parent as Object, text as String, x as Float, y as Float, fill as String, ink as String) as Float
    font = DF("Display-ExtraBold", 30)
    w = FbWidth(parent, text, font) + 44
    chip = DCard(parent, x, y, w, 56, fill)
    l = Txt(chip, text, font, ink, 0, 0, w, "center")
    l.height = 56
    l.vertAlign = "center"
    l.wrap = false
    return w
end function

' A small pill sized to its text (pill.9 is a perfect pill at 44 px tall). Returns its width.
function FbPill(parent as Object, x as Float, y as Float, text as String, fill as String, ink as String) as Float
    font = DF("Display-Bold", 22)
    w = FbWidth(parent, text, font) + 36
    p = AddPoster(parent, "pkg:/images/pill.9.png", x, y, w, 44)
    p.blendColor = fill
    Txt(parent, text, font, ink, x, y + 9, w, "center")
    return w
end function

' Lays out slips of the given widths in rows, starting at x = lead. invalid when they don't fit.
function FbFlow(widths as Object, first as Integer, lead as Float, w as Float, rows as Integer, gap as Float, rowH as Float) as Dynamic
    out = []
    x = lead
    r = 0
    for i = first to widths.Count() - 1
        ww = widths[i]
        if ww > w then ww = w
        if x > 0 and x + ww > w
            r = r + 1
            x = 0
        end if
        if r >= rows then return invalid
        out.Push([x, r * rowH, ww])
        x = x + ww + gap
    end for
    return out
end function

' The cards a turn got, as paper slips in rows. When they don't all fit, the oldest give way to a "+N"
' slip. Slips from index fresh on pop in (fresh < 0: none do).
sub FbSlips(parent as Object, got as Object, x0 as Float, y0 as Float, w as Float, rows as Integer, small as Boolean, fresh as Integer)
    size = 30
    h = 62
    if small
        size = 24
        h = 56
    end if
    font = DF("Display-Bold", size)
    gap = 18
    rowH = h + 16
    widths = []
    for each t in got
        widths.Push(FbWidth(parent, t, font) + h + 30)
    end for
    first = 0
    lead = 0
    spots = FbFlow(widths, 0, 0, w, rows, gap, rowH)
    while spots = invalid and first < got.Count() - 1
        first = first + 1
        lead = FbWidth(parent, "+" + first.ToStr(), font) + 40 + gap
        spots = FbFlow(widths, first, lead, w, rows, gap, rowH)
    end while
    if spots = invalid then return
    if first > 0
        more = DCard(parent, x0, y0, lead - gap, h, "0xE8F6FFFF")
        ml = Txt(more, "+" + first.ToStr(), font, m.INK, 0, 0, lead - gap, "center")
        ml.height = h
        ml.vertAlign = "center"
    end if
    anim = invalid
    if fresh >= 0 and fresh < got.Count() then anim = NewAnim(parent, 0.45 + (got.Count() - 1 - fresh) * 0.08)
    for k = 0 to spots.Count() - 1
        i = first + k
        sp = spots[k]
        ww = sp[2]
        slip = parent.CreateChild("Group")
        slip.translation = [x0 + sp[0] + ww / 2, y0 + sp[1] + h / 2]
        slip.rotation = ((i * 37) mod 9 - 4) * 0.0175
        DCard(slip, -ww / 2, -h / 2, ww, h, "0xFFF6E8FF")
        AddPoster(slip, "pkg:/images/fb_check.png", -ww / 2 + 12, -h / 2 + (h - 40) / 2, 40, 40)
        l = Txt(slip, got[i], font, m.INK, -ww / 2 + 60, -h / 2, ww - 74, "left")
        l.height = h
        l.vertAlign = "center"
        l.wrap = false
        if anim <> invalid and i >= fresh
            slip.id = "fbSlip" + i.ToStr()
            slip.opacity = 0
            slip.scale = [0.3, 0.3]
            t0 = (i - fresh) * 0.08
            Keyframes(anim, "FloatFieldInterpolator", slip.id + ".opacity", [0, t0, t0 + 0.12, anim.duration], [0.0, 0.0, 1.0, 1.0])
            Keyframes(anim, "Vector2DFieldInterpolator", slip.id + ".scale", [0, t0, t0 + 0.22, t0 + 0.34, anim.duration], [[0.3, 0.3], [0.3, 0.3], [1.12, 1.12], [1.0, 1.0], [1.0, 1.0]])
        end if
    end for
    if anim <> invalid then anim.control = "start"
end sub

' Both teams along the bottom: name, score and faces. The team giving clues sits higher, with a label;
' the clue-giver has a white halo.
sub FbBoard(parent as Object, board as Dynamic, upLabel as String)
    m.fbScores = []
    if board = invalid then return
    n = board.Count()
    if n = 0 then return
    gap = 40
    w = (1760 - (n - 1) * gap) / n
    for i = 0 to n - 1
        b = board[i]
        up = Truthy(b.up)
        y = 724
        if up then y = 704
        card = DCard(parent, 80 + i * (w + gap), y, w, 196, b.fill)
        nm = Txt(card, FbText(b.team), DF("Display-ExtraBold", 46), b.ink, 32, 18, w - 280, "left")
        nm.wrap = false
        sc = Txt(card, FbNum(b.score), DF("Display-ExtraBold", 84), b.ink, w - 230, -4, 200, "right")
        sc.id = "fbScore" + i.ToStr()
        sc.scaleRotateCenter = [170, 56]
        m.fbScores.Push(sc)
        faces = []
        if b.faces <> invalid then faces = b.faces
        nf = faces.Count()
        if nf > 0
            pitch = (w - 48) / nf
            if pitch > 110 then pitch = 110
            size = 58
            if size > pitch - 16 then size = pitch - 16
            for j = 0 to nf - 1
                f = faces[j]
                fx = 24 + j * pitch
                ax = fx + (pitch - size) / 2
                if Truthy(f.giver)
                    halo = AddPoster(card, "pkg:/images/dot.png", ax - 11, 91, size + 22, size + 22)
                    halo.blendColor = m.WHITE
                end if
                a = Avatar(card, f, ax, 102, size)
                if Truthy(f.away) then a.opacity = 0.45
                fl = Txt(card, f.name, DF("Text-Bold", 20), b.ink, fx, 166, pitch, "center")
                fl.wrap = false
            end for
        end if
        if up and upLabel <> "" then FbPill(card, 32, -24, upLabel, m.WHITE, m.INK)
    end for
end sub

' Each team's cards per round and the total; the winning team's row is gold. Returns the height.
function FbTable(parent as Object, tbl as Dynamic, x as Float, y as Float, w as Float) as Float
    if tbl = invalid then return 0
    rounds = []
    if tbl.rounds <> invalid then rounds = tbl.rounds
    rows = []
    if tbl.rows <> invalid then rows = tbl.rows
    nR = rounds.Count()
    h = 104 + rows.Count() * 86
    card = DCard(parent, x, y, w, h, m.WHITE)
    teamW = 330
    totW = 190
    colW = w - teamW - totW - 20
    if nR > 0 then colW = colW / nR
    for i = 0 to nR - 1
        Txt(card, rounds[i].label, DF("Display-ExtraBold", 30), m.INK, teamW + i * colW, 20, colW, "center")
        Txt(card, rounds[i].title, DF("Text-Regular", 22), "0x221836B3", teamW + i * colW, 58, colW, "center")
    end for
    Txt(card, "Total", DF("Display-ExtraBold", 30), m.INK, w - totW - 20, 20, totW, "center")
    for j = 0 to rows.Count() - 1
        r = rows[j]
        ry = 104 + j * 86
        if Truthy(r.win)
            band = AddPoster(card, "pkg:/images/card.9.png", 14, ry - 8, w - 28, 72)
            band.blendColor = "0xFFE38AFF"
        end if
        FbTag(card, FbText(r.team), 28, ry, r.fill, r.ink)
        scores = []
        if r.scores <> invalid then scores = r.scores
        for i = 0 to nR - 1
            if i < scores.Count() then Txt(card, FbNum(scores[i]), DF("Display-ExtraBold", 46), m.INK, teamW + i * colW, ry, colW, "center")
        end for
        Txt(card, FbNum(r.total), DF("Display-ExtraBold", 54), m.INK, w - totW - 20, ry - 4, totW, "center")
    end for
    return h
end function

' Between turns: the round's rule, who's up, what the last turn got, and the teams.
sub drawFbReady(s as Object)
    drawTitle(s)
    v = m.view
    key = FbText(s.key)
    animate = key <> m.fbKey
    m.fbKey = key
    fill = "0xFFC93CFF"
    ink = m.INK
    if s.fill <> invalid then fill = s.fill
    if s.ink <> invalid then ink = s.ink
    round = FbNum(s.round)
    rule = v.CreateChild("Group")
    rule.id = "fbRule"
    rule.translation = [80, 166]
    DCard(rule, 0, 0, 860, 300, m.WHITE)
    ring = AddPoster(rule, "pkg:/images/dot.png", 32, 34, 100, 100)
    ring.blendColor = m.INK
    badge = AddPoster(rule, "pkg:/images/dot.png", 36, 38, 92, 92)
    badge.blendColor = "0xFFC93CFF"
    Txt(rule, round, DF("Display-ExtraBold", 54), m.INK, 36, 50, 92, "center")
    Txt(rule, "ROUND " + round + " OF 3", DF("Display-Bold", 28), "0x221836B3", 160, 40, 670, "left")
    Txt(rule, FbText(s.rule), DF("Display-ExtraBold", 64), m.INK, 160, 70, 670, "left")
    rt = Txt(rule, FbText(s.ruleText), DF("Text-Regular", 28), m.INK, 36, 158, 790, "left")
    rt.maxLines = 3
    up = v.CreateChild("Group")
    up.id = "fbUp"
    up.translation = [980, 166]
    DCard(up, 0, 0, 860, 300, fill)
    if s.giver <> invalid
        a = Avatar(up, s.giver, 40, 44, 150)
        if Truthy(s.giver.away) then a.opacity = 0.45
        nl = Txt(up, FbText(s.giver.name) + " is up", DF("Display-ExtraBold", 66), ink, 228, 38, 600, "left")
        nl.wrap = false
        Txt(up, "Giving clues for " + FbText(s.team), DF("Display-Bold", 34), ink, 228, 126, 600, "left")
        if s.carry <> invalid then FbPill(up, 228, 184, s.carry, m.WHITE, m.INK)
        hl = Txt(up, FbText(s.hint), DF("Text-Bold", 28), ink, 40, 238, 780, "left")
        hl.wrap = false
    else
        hl = Txt(up, FbText(s.hint), DF("Display-ExtraBold", 48), ink, 40, 0, 780, "center")
        hl.height = 300
        hl.vertAlign = "center"
    end if
    strip = DCard(v, 80, 498, 1760, 180, m.WHITE)
    AddPoster(strip, "pkg:/images/fb_bowl.png", 1760 - 270, 26, 132, 120)
    bl = Txt(strip, FbNum(s.left), DF("Display-ExtraBold", 60), m.INK, 1760 - 130, 30, 110, "left")
    Txt(strip, "left", DF("Text-Bold", 26), "0x221836B3", 1760 - 128, 104, 110, "left")
    if s.recap <> invalid
        r = s.recap
        tw = FbTag(strip, FbText(r.team), 28, 22, r.fill, r.ink)
        Avatar(strip, r, 28 + tw + 20, 24, 50)
        rl = Txt(strip, FbText(r.text), DF("Display-Bold", 36), m.INK, 28 + tw + 88, 28, 1300 - tw, "left")
        rl.wrap = false
        got = []
        if r.got <> invalid then got = r.got
        if got.Count() > 0
            FbSlips(strip, got, 28, 100, 1440, 1, true, -1)
        else
            Txt(strip, "No cards that time.", DF("Text-Regular", 30), "0x22183699", 28, 110, 1200, "left")
        end if
    else
        where = "in the bowl"
        if s.round <> invalid and s.round > 1 then where = "back in the bowl"
        bt = Txt(strip, "All " + FbNum(s.total) + " cards are " + where, DF("Display-ExtraBold", 54), m.INK, 40, 0, 1400, "left")
        bt.height = 180
        bt.vertAlign = "center"
    end if
    FbBoard(v, s.board, "UP NEXT")
    if animate
        anim = NewAnim(v, 0.6)
        rule.scaleRotateCenter = [430, 150]
        up.scaleRotateCenter = [430, 150]
        rule.opacity = 0
        up.opacity = 0
        Keyframes(anim, "FloatFieldInterpolator", "fbRule.opacity", [0, 0.15, 0.6], [0.0, 1.0, 1.0])
        Keyframes(anim, "Vector2DFieldInterpolator", "fbRule.scale", [0, 0.3, 0.45, 0.6], [[0.9, 0.9], [1.03, 1.03], [1.0, 1.0], [1.0, 1.0]])
        Keyframes(anim, "FloatFieldInterpolator", "fbUp.opacity", [0, 0.15, 0.3, 0.6], [0.0, 0.0, 1.0, 1.0])
        Keyframes(anim, "Vector2DFieldInterpolator", "fbUp.translation", [0, 0.15, 0.45, 0.6], [[1100, 166], [1100, 166], [970, 166], [980, 166]])
        anim.control = "start"
    end if
end sub

' A turn: the clock, who's describing for which team, the cards got so far, and the teams.
sub drawFbTurn(s as Object)
    drawTitle(s)
    v = m.view
    key = FbText(s.key)
    animate = key <> m.fbKey
    m.fbKey = key
    fill = "0xFFC93CFF"
    ink = m.INK
    if s.fill <> invalid then fill = s.fill
    if s.ink <> invalid then ink = s.ink
    ' The clock, in the team's color (red for the last five seconds).
    clock = v.CreateChild("Group")
    clock.id = "fbClock"
    clock.translation = [80, 166]
    clock.scaleRotateCenter = [115, 115]
    ring = AddPoster(clock, "pkg:/images/dot.png", -7, -7, 244, 244)
    ring.blendColor = m.INK
    face = AddPoster(clock, "pkg:/images/dot.png", 0, 0, 230, 230)
    face.blendColor = fill
    m.timerLabel = Txt(clock, "", DF("Display-ExtraBold", 112), ink, 0, 42, 230, "center")
    m.timerGroup = clock
    pulse = NewAnim(v, 0.35)
    Keyframes(pulse, "Vector2DFieldInterpolator", "fbClock.scale", [0, 0.12, 0.35], [[1.0, 1.0], [1.14, 1.14], [1.0, 1.0]])
    m.urgent = { face: face, fill: fill, ink: ink, hot: false, last: -1, pulse: pulse }
    who = { name: "Someone" }
    if s.giver <> invalid then who = s.giver
    Avatar(v, who, 372, 180, 54)
    gl = Txt(v, FbText(who.name) + " is giving clues for " + FbText(s.team), DF("Display-Bold", 40), m.FG, 446, 184, 1400, "left")
    gl.wrap = false
    Txt(v, FbText(s.heading), DF("Display-ExtraBold", 84), m.FG, 372, 246, 1480, "left")
    Txt(v, FbText(s.rule), DF("Display-Bold", 32), m.FG2, 372, 360, 1480, "left")
    panel = DCard(v, 80, 434, 1760, 246, m.WHITE)
    Txt(panel, "Got so far", DF("Display-Bold", 36), m.INK, 36, 22, 600, "left")
    AddPoster(panel, "pkg:/images/fb_bowl.png", 1760 - 236, 10, 66, 60)
    m.fbLeft = Txt(panel, "", DF("Display-ExtraBold", 36), m.INK, 1760 - 162, 22, 140, "left")
    m.fbSlips = panel.CreateChild("Group")
    m.fbTurn = { key: key, code: s.code, got: -1, board: [] }
    FbBoard(v, s.board, "GIVING CLUES")
    updateFbTurn(s)
    if s.secs <> invalid then setSecs(s.secs)
    if animate
        anim = NewAnim(v, 0.5)
        clock.scale = [0.4, 0.4]
        Keyframes(anim, "Vector2DFieldInterpolator", "fbClock.scale", [0, 0.3, 0.42, 0.5], [[0.4, 0.4], [1.1, 1.1], [0.97, 0.97], [1.0, 1.0]])
        anim.control = "start"
    end if
end sub

' A turn moved on: pop in the new cards, update what's left and the scores.
sub updateFbTurn(s as Object)
    t = m.fbTurn
    if t = invalid then return
    got = []
    if s.got <> invalid then got = s.got
    if got.Count() <> t.got
        fresh = t.got
        if fresh < 0 or fresh > got.Count() then fresh = 0
        m.fbSlips.removeChildrenIndex(m.fbSlips.getChildCount(), 0)
        if got.Count() = 0
            Txt(m.fbSlips, "Nothing yet. Come on!", DF("Text-Regular", 36), "0x22183699", 36, 116, 1200, "left")
        else
            FbSlips(m.fbSlips, got, 36, 86, 1688, 2, false, fresh)
        end if
        t.got = got.Count()
    end if
    m.fbLeft.text = FbNum(s.left) + " left"
    if s.board <> invalid
        for i = 0 to s.board.Count() - 1
            if i < m.fbScores.Count()
                sc = m.fbScores[i]
                now = FbNum(s.board[i].score)
                if sc.text <> now
                    sc.text = now
                    pop = NewAnim(m.view, 0.4)
                    Keyframes(pop, "Vector2DFieldInterpolator", sc.id + ".scale", [0, 0.12, 0.4], [[1.0, 1.0], [1.4, 1.4], [1.0, 1.0]])
                    pop.control = "start"
                end if
            end if
        end for
    end if
end sub

' The bowl is empty: scores by round, who emptied it, and the next round's rule.
sub drawFbRound(s as Object)
    drawTitle(s)
    v = m.view
    m.fbKey = FbText(s.key)
    if s.kicker <> invalid then Txt(v, UCase(s.kicker), DF("Display-Bold", 34), m.FG2, 160, 150, 1600, "center")
    Txt(v, FbText(s.title), DF("Display-ExtraBold", 96), m.FG, 160, 192, 1600, "center")
    FbTable(v, s.table, 80, 340, 1000)
    if s.recap <> invalid
        r = s.recap
        card = DCard(v, 1120, 340, 720, 300, m.WHITE)
        FbTag(card, FbText(r.team), 28, 24, r.fill, r.ink)
        Avatar(card, r, 640, 26, 50)
        rl = Txt(card, FbText(r.text), DF("Display-Bold", 32), m.INK, 28, 98, 664, "left")
        rl.maxLines = 2
        got = []
        if r.got <> invalid then got = r.got
        ' Two rows of cards when the line above fits on one line.
        if FbWidth(card, FbText(r.text), DF("Display-Bold", 32)) <= 664
            if got.Count() > 0 then FbSlips(card, got, 28, 150, 664, 2, true, -1)
        else
            if got.Count() > 0 then FbSlips(card, got, 28, 210, 664, 1, true, -1)
        end if
    end if
    if s["next"] <> invalid
        nx = s["next"]
        card = DCard(v, 80, 690, 1340, 196, m.WHITE)
        FbPill(card, 28, -22, "UP NEXT", "0xFFC93CFF", m.INK)
        Txt(card, "Round " + FbNum(nx.round) + " of 3: " + FbText(nx.title), DF("Display-ExtraBold", 54), m.INK, 36, 34, 1270, "left")
        nt = Txt(card, FbText(nx.text), DF("Text-Regular", 30), m.INK, 36, 108, 1270, "left")
        nt.maxLines = 2
    end if
    y = 914
    if s.starter <> invalid
        Txt(v, s.starter, DF("Display-Bold", 32), m.FG, 80, y, 1320, "left")
        y = y + 52
    end if
    if s.note <> invalid then Txt(v, s.note, DF("Text-Bold", 28), m.FG, 80, y, 1320, "left")
end sub

' Game over: the winning team, the scores, the best clue-givers, and every card that was in the bowl.
sub drawFbOver(s as Object)
    drawTitle(s)
    v = m.view
    key = FbText(s.key)
    animate = key <> m.fbKey
    m.fbKey = key
    fill = m.WHITE
    ink = m.INK
    if s.fill <> invalid then fill = s.fill
    if s.ink <> invalid then ink = s.ink
    win = v.CreateChild("Group")
    win.id = "fbWin"
    win.translation = [580, 316]
    win.rotation = -0.017
    DCard(win, -500, -150, 1000, 300, fill)
    AddPoster(win, "pkg:/images/fb_crown.png", -60, -136, 120, 91)
    wl = Txt(win, FbText(s.title), DF("Display-ExtraBold", 80), ink, -480, -44, 960, "center")
    wl.wrap = false
    faces = []
    if s.faces <> invalid then faces = s.faces
    nf = faces.Count()
    if nf > 0
        pitch = 900 / nf
        if pitch > 76 then pitch = 76
        size = 52
        if size > pitch - 12 then size = pitch - 12
        x0 = -(nf * pitch) / 2
        for i = 0 to nf - 1
            Avatar(win, faces[i], x0 + i * pitch + (pitch - size) / 2, 74, size)
        end for
    end if
    th = FbTable(v, s.table, 80, 494, 1000)
    givers = []
    if s.givers <> invalid then givers = s.givers
    n = givers.Count()
    if n > 3 then n = 3
    if n > 0
        gy = 494 + th + 30
        card = DCard(v, 80, gy, 1000, 70 + n * 52, m.WHITE)
        Txt(card, "Best clue-givers", DF("Display-Bold", 32), m.INK, 28, 16, 600, "left")
        for i = 0 to n - 1
            g = givers[i]
            ry = 66 + i * 52
            Txt(card, (i + 1).ToStr(), DF("Display-ExtraBold", 30), m.INK, 20, ry + 4, 40, "center")
            Avatar(card, g, 76, ry, 40)
            nm = Txt(card, FbText(g.name), DF("Text-Bold", 28), m.INK, 134, ry + 4, 420, "left")
            nm.wrap = false
            FbPill(card, 580, ry - 2, FbText(g.team), g.fill, g.ink)
            Txt(card, FbNum(g.score), DF("Display-ExtraBold", 34), m.INK, 840, ry, 130, "right")
        end for
    end if
    ' The bowl: every card and who wrote it.
    bowl = []
    if s.bowl <> invalid then bowl = s.bowl
    card = DCard(v, 1120, 160, 760, 714, m.WHITE)
    Txt(card, "What was in the bowl", DF("Display-Bold", 34), m.INK, 28, 22, 520, "left")
    count = FbNum(s.cards) + " cards"
    cw = FbWidth(card, count, DF("Display-Bold", 22)) + 36
    FbPill(card, 760 - 28 - cw, 20, count, "0xFFC93CFF", m.INK)
    tints = ["0xFFE9A8FF", "0xFFD3E8FF", "0xD9F2FFFF", "0xDDF7ECFF"]
    colW = 344
    for i = 0 to bowl.Count() - 1
        if i >= 22 then exit for
        c = bowl[i]
        cx = 28 + (i mod 2) * (colW + 16)
        cy = 86 + (i \ 2) * 56
        p = AddPoster(card, "pkg:/images/pill.9.png", cx, cy, colW, 44)
        p.blendColor = tints[i mod 4]
        ct = Txt(card, FbText(c.text), DF("Display-Bold", 22), m.INK, cx + 18, cy + 9, colW - 140, "left")
        ct.wrap = false
        ca = Txt(card, FbText(c.author), DF("Text-Regular", 18), "0x221836A6", cx + colW - 126, cy + 12, 110, "right")
        ca.wrap = false
    end for
    if s.note <> invalid then Txt(v, s.note, DF("Display-Bold", 30), m.FG, 1120, 896, 760, "left")
    if animate
        anim = NewAnim(v, 1.0)
        win.opacity = 0
        win.scale = [0.6, 0.6]
        Keyframes(anim, "FloatFieldInterpolator", "fbWin.opacity", [0, 0.25, 0.4, 1.0], [0.0, 0.0, 1.0, 1.0])
        Keyframes(anim, "Vector2DFieldInterpolator", "fbWin.scale", [0, 0.25, 0.65, 0.82, 1.0], [[0.6, 0.6], [0.6, 0.6], [1.05, 1.05], [0.98, 0.98], [1.0, 1.0]])
        Keyframes(anim, "FloatFieldInterpolator", "fbWin.rotation", [0, 0.25, 0.75, 1.0], [-0.1, -0.1, -0.017, -0.017])
        anim.control = "start"
    end if
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
    m.timerGroup = g
    setSecs(secs)
end sub

sub onTick()
    if m.timerLabel = invalid then return
    remain = m.secs - Int(m.since.TotalMilliseconds() / 1000)
    if remain < 0 then remain = 0
    m.timerLabel.text = remain.ToStr()
    ' A Fishbowl turn's clock goes red for the last five seconds and thumps once a second.
    u = m.urgent
    if u = invalid then return
    hot = remain <= 5
    if hot <> u.hot
        u.hot = hot
        if hot
            u.face.blendColor = m.RED
            m.timerLabel.color = m.WHITE
        else
            u.face.blendColor = u.fill
            m.timerLabel.color = u.ink
        end if
    end if
    if hot and remain > 0 and remain <> u.last then u.pulse.control = "start"
    u.last = remain
end sub
