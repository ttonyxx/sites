sub init()
    m.tween = m.top.findNode("tween")
    m.layers = {
        base: m.top.findNode("base")
        top: m.top.findNode("top")
        sunGlow: m.top.findNode("sunGlow")
        moonGlow: m.top.findNode("moonGlow")
        stars: m.top.findNode("stars")
        clouds: m.top.findNode("clouds")
        tints: [m.top.findNode("farA"), m.top.findNode("farB"), m.top.findNode("nearA"), m.top.findNode("nearB")]
    }
    m.stars = m.top.findNode("stars")
    m.stars.opacity = 0
    m.drifts = [m.top.findNode("driftFar"), m.top.findNode("driftNear")]
    m.twinkle = m.top.findNode("twinkle")
    m.tween.observeField("state", "onTweenState")
    m.cloudsOn = false
    m.starsOn = false
end sub

sub onState()
    s = m.top.state
    if s = invalid then return
    L = m.layers
    glowPos = [s.glowCenter[0] - 750, s.glowCenter[1] - 750]

    ' Run the layers that are about to become visible.
    setRunning(s.clouds > 0.01 or L.clouds.opacity > 0.01, s.stars > 0.01 or L.stars.opacity > 0.01)

    if m.top.duration <= 0
        m.tween.control = "stop"
        L.base.color = s.base
        L.top.blendColor = s.top
        L.sunGlow.blendColor = s.glow
        L.sunGlow.opacity = s.glowOpacity
        L.sunGlow.translation = glowPos
        L.moonGlow.opacity = s.moonOpacity
        L.stars.opacity = s.stars
        L.clouds.opacity = s.clouds
        for each p in L.tints
            p.blendColor = s.cloudTint
        end for
        onTweenState()
        return
    end if

    m.tween.control = "stop"
    m.tween.duration = m.top.duration
    setKeys("iBase", L.base.color, s.base)
    setKeys("iTop", L.top.blendColor, s.top)
    setKeys("iGlow", L.sunGlow.blendColor, s.glow)
    setKeys("iGlowA", L.sunGlow.opacity, s.glowOpacity)
    setKeys("iGlowPos", L.sunGlow.translation, glowPos)
    setKeys("iMoon", L.moonGlow.opacity, s.moonOpacity)
    setKeys("iStars", L.stars.opacity, s.stars)
    setKeys("iClouds", L.clouds.opacity, s.clouds)
    ids = ["iTintFarA", "iTintFarB", "iTintNearA", "iTintNearB"]
    for i = 0 to 3
        setKeys(ids[i], L.tints[i].blendColor, s.cloudTint)
    end for
    m.tween.control = "start"
end sub

sub setKeys(id as String, fromValue as Dynamic, toValue as Dynamic)
    m.top.findNode(id).keyValue = [fromValue, toValue]
end sub

' Once a tween settles, stop animating layers nobody can see (saves GPU on the TV).
sub onTweenState()
    if m.tween.state = "running" then return
    L = m.layers
    setRunning(L.clouds.opacity > 0.01, L.stars.opacity > 0.01)
end sub

sub setRunning(clouds as Boolean, stars as Boolean)
    if clouds <> m.cloudsOn
        m.cloudsOn = clouds
        m.layers.clouds.visible = clouds
        for each a in m.drifts
            if clouds then a.control = "start" else a.control = "stop"
        end for
    end if
    if stars <> m.starsOn
        m.starsOn = stars
        m.layers.stars.visible = stars
        if stars then m.twinkle.control = "start" else m.twinkle.control = "stop"
    end if
end sub
