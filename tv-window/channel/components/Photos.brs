sub init()
    m.layer = m.top.findNode("layer")
    m.slide = { A: m.top.findNode("slideA"), B: m.top.findNode("slideB") }
    m.front = "B" ' the next slide loads into "A"
    m.slides = []
    m.pos = 0
    m.slot = 0
    m.pending = 0
    m.loading = false
    m.showingSky = true
    m.failed = false
    m.advance = m.top.findNode("advance")
    m.advance.observeField("fire", "showNext")
    m.loadTimeout = m.top.findNode("loadTimeout")
    m.loadTimeout.observeField("fire", "onLoadTimeout")
end sub

'---- slide list ----------------------------------------------------------------------------

' The photos occupy [areaX, areaX + areaW] horizontally (the panel layout leaves room on the left).
sub onArea()
    m.top.findNode("dim").opacity = m.top.dim
    c = [m.top.areaX + m.top.areaW / 2, 540]
    m.slide.A.scaleRotateCenter = c
    m.slide.B.scaleRotateCenter = c
    m.slides = buildSlides(m.top.photos)
    m.pos = 0
    if m.top.active and m.slides.Count() > 0 and not m.loading then showNext()
end sub

sub onPhotos()
    m.slides = buildSlides(m.top.photos)
    m.pos = 0
    if m.top.active and m.slides.Count() > 0 and not m.loading and m.showingSky then showNext()
end sub

' Landscape photos get a slide each; portraits are paired (A+B, C+A, B+C for three) so
' every slide fills the screen. Google smart-crops each tile to the exact size requested (-p)
' and "-no" drops the play-button overlay it otherwise draws on videos.
function buildSlides(photos as Dynamic) as Object
    slides = []
    if photos = invalid then return slides
    list = []
    for each p in photos
        list.Push(p)
    end for
    Shuffle(list)
    X = m.top.areaX
    AW = Int(m.top.areaW)
    tileW = (AW - 4) \ 2
    full = "=w" + AW.ToStr() + "-h1080-p-no"
    half = "=w" + tileW.ToStr() + "-h1080-p-no"
    portraits = []
    for each p in list
        if p.w >= p.h
            slides.Push([{ url: p.url + full, x: X, w: AW }])
        else
            portraits.Push(p)
        end if
    end for
    n = portraits.Count()
    if n = 1
        slides.Push([{ url: portraits[0].url + full, x: X, w: AW }])
    else if n > 1
        pairs = n \ 2
        if n mod 2 = 1 then pairs = n
        for k = 0 to pairs - 1
            a = portraits[(2 * k) mod n]
            b = portraits[(2 * k + 1) mod n]
            slides.Push([{ url: a.url + half, x: X, w: tileW }, { url: b.url + half, x: X + AW - tileW, w: tileW }])
        end for
    end if
    Shuffle(slides)
    return slides
end function

sub Shuffle(arr as Object)
    for i = arr.Count() - 1 to 1 step -1
        j = Rnd(i + 1) - 1
        t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
    end for
end sub

' ---- rotation --------------------------------------------------------------------------------

sub onActive()
    if m.top.active
        if m.slides.Count() > 0 and not m.loading then showNext()
    else
        m.advance.control = "stop"
        fadeLayer(0)
        m.showingSky = true
    end if
end sub

sub showNext()
    if not m.top.active or m.slides.Count() = 0 then return
    m.slot = m.slot + 1
    if m.top.mix and m.slot mod 3 = 0
        ' Sky's turn.
        fadeLayer(0)
        m.showingSky = true
        schedule(m.top.slideSeconds)
        return
    end if
    spec = m.slides[m.pos mod m.slides.Count()]
    m.pos = m.pos + 1
    back = backName()
    g = m.slide[back]
    g.removeChildrenIndex(g.getChildCount(), 0)
    g.opacity = 0
    m.pending = spec.Count()
    m.failed = false
    m.loading = true
    for each tile in spec
        p = g.CreateChild("Poster")
        p.translation = [tile.x, 0]
        p.width = tile.w
        p.height = 1080
        p.observeField("loadStatus", "onTileStatus")
        p.uri = tile.url
    end for
    m.loadTimeout.control = "start"
end sub

function backName() as String
    if m.front = "A" then return "B"
    return "A"
end function

sub onTileStatus(event as Object)
    status = event.getData()
    if status = "ready" or status = "failed"
        if status = "failed" then m.failed = true
        m.pending = m.pending - 1
        if m.pending <= 0 and m.loading then revealBack()
    end if
end sub

sub onLoadTimeout()
    if m.loading
        m.failed = true
        revealBack()
    end if
end sub

sub revealBack()
    m.loading = false
    m.loadTimeout.control = "stop"
    if not m.top.active then return
    if m.failed
        print "[window] photo failed to load, skipping"
        schedule(5)
        return
    end if
    back = backName()
    ' Slow drift: zoom in or out a little and wander a few pixels while the slide is up.
    k = "kenA"
    if back = "B" then k = "kenB"
    z0 = 1.0 : z1 = 1.07
    if Rnd(2) = 1
        z0 = 1.07 : z1 = 1.0
    end if
    dx = (Rnd(41) - 21) * 1.0
    dy = (Rnd(25) - 13) * 1.0
    m.top.findNode(k + "Scale").keyValue = [[z0, z0], [z1, z1]]
    m.top.findNode(k + "Pos").keyValue = [[-dx, -dy], [dx, dy]]
    ken = m.top.findNode(k)
    ken.control = "stop"
    ken.duration = m.top.slideSeconds + 4
    ken.control = "start"

    xIn = m.top.findNode("xIn")
    xOut = m.top.findNode("xOut")
    xIn.fieldToInterp = "slide" + back + ".opacity"
    xOut.fieldToInterp = "slide" + m.front + ".opacity"
    xIn.keyValue = [0.0, 1.0]
    xOut.keyValue = [m.slide[m.front].opacity, 0.0]
    xf = m.top.findNode("xfade")
    xf.control = "stop"
    xf.control = "start"
    m.front = back
    if m.showingSky
        fadeLayer(1)
        m.showingSky = false
    end if
    schedule(m.top.slideSeconds)
end sub

sub schedule(seconds as Float)
    m.advance.control = "stop"
    m.advance.duration = seconds
    m.advance.control = "start"
end sub

sub fadeLayer(target as Float)
    a = m.top.findNode("layerFade")
    a.control = "stop"
    m.top.findNode("layerInterp").keyValue = [m.layer.opacity, target]
    a.control = "start"
end sub
