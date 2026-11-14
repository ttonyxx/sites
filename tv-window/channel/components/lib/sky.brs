' The sky model: turns "what time is it relative to sunrise/sunset, and how cloudy is it"
' into colours and layer strengths for the Sky component.

' Keyframes are offsets (seconds) from sunrise ("R"), sunset ("S") or solar noon ("M").
function SkyKeyframes() as Object
    return [
        { at: "R", off: -6000, top: "070B1A", hor: "141B36", glow: "3A4A86", glowA: 0.0, stars: 1.0 }
        { at: "R", off: -3600, top: "0B1230", hor: "2B2D5E", glow: "5A4B8C", glowA: 0.22, stars: 0.7 }
        { at: "R", off: -1200, top: "1E2A60", hor: "C9746E", glow: "FFAE7A", glowA: 0.7, stars: 0.2 }
        { at: "R", off: 0, top: "33508F", hor: "F2AE86", glow: "FFD09A", glowA: 0.85, stars: 0.0 }
        { at: "R", off: 3600, top: "2C66B0", hor: "9EC4EA", glow: "FFF2D8", glowA: 0.5, stars: 0.0 }
        { at: "M", off: 0, top: "2462B4", hor: "8CBDEB", glow: "FFFFFF", glowA: 0.42, stars: 0.0 }
        { at: "S", off: -5400, top: "2B5FA8", hor: "ABC9E8", glow: "FFF0CC", glowA: 0.45, stars: 0.0 }
        { at: "S", off: -2100, top: "3A5A9A", hor: "EFB07E", glow: "FFC98A", glowA: 0.7, stars: 0.0 }
        { at: "S", off: 0, top: "2B3874", hor: "EE875C", glow: "FF9A62", glowA: 0.9, stars: 0.0 }
        { at: "S", off: 1500, top: "1C2356", hor: "925682", glow: "C3667C", glowA: 0.55, stars: 0.25 }
        { at: "S", off: 3600, top: "0E1538", hor: "2A3264", glow: "434C88", glowA: 0.22, stars: 0.7 }
        { at: "S", off: 6000, top: "070B1A", hor: "141B36", glow: "3A4A86", glowA: 0.0, stars: 1.0 }
    ]
end function

' now/sunrise/sunset are epoch seconds. cloud is 0..1 cover. code is the WMO weather code (-1 unknown).
function SkyState(now as Integer, sunrise as Integer, sunset as Integer, cloud as Float, code as Integer) as Object
    noon = (sunrise + sunset) \ 2
    frames = SkyKeyframes()
    times = []
    for each f in frames
        base = sunrise
        if f.at = "S" then base = sunset
        if f.at = "M" then base = noon
        times.Push(base + f.off)
    end for

    ' Find the surrounding keyframes (night outside the range).
    lastIdx = frames.Count() - 1
    a = frames[0] : b = frames[0] : t = 0.0
    if now >= times[lastIdx]
        a = frames[lastIdx] : b = frames[lastIdx]
    else if now > times[0]
        for i = 0 to lastIdx - 1
            if now >= times[i] and now < times[i + 1]
                a = frames[i] : b = frames[i + 1]
                t = (now - times[i]) / (times[i + 1] - times[i])
                exit for
            end if
        end for
    end if
    t = Smooth(0, 1, t)

    top = MixRgb(Rgb(a.top), Rgb(b.top), t)
    hor = MixRgb(Rgb(a.hor), Rgb(b.hor), t)
    glow = MixRgb(Rgb(a.glow), Rgb(b.glow), t)
    glowA = Mix(a.glowA, b.glowA, t)
    stars = Mix(a.stars, b.stars, t)
    daylight = 1.0 - stars

    ' Weather: clouds grey the sky out, rain and storms darken it, fog flattens it.
    grey = cloud ^ 1.25 * 0.68
    wet = (code >= 51 and code <= 67) or (code >= 80 and code <= 99)
    if code = 45 or code = 48 then grey = Mix(grey, 1.0, 0.55)
    top = MixRgb(top, Desaturate(top), grey)
    hor = MixRgb(hor, Desaturate(hor), grey)
    if wet
        top = ScaleRgb(top, 0.8)
        hor = ScaleRgb(hor, 0.82)
    end if
    glowA = glowA * (1.0 - cloud * 0.75)
    stars = stars * (1.0 - cloud * 0.9)

    ' Sun position: below the left horizon before sunrise, arcing across the day,
    ' below the right horizon after sunset.
    p = Clamp01((now - sunrise) / (sunset - sunrise))
    sx = 1920 * (0.1 + 0.8 * p)
    sy = 1080 * (0.97 - 0.62 * Sin(3.14159265 * p))
    if now < sunrise then sy = 1080 * 0.99
    if now > sunset then sy = 1080 * 0.99

    cloudOpacity = 0.0
    if cloud > 0.04 then cloudOpacity = 0.18 + 0.78 * cloud
    if code = 45 or code = 48 then cloudOpacity = cloudOpacity * 0.6
    cloudTint = ScaleRgb(MixRgb([255, 255, 255], hor, 0.3), 0.3 + 0.7 * daylight)
    if wet then cloudTint = ScaleRgb(cloudTint, 0.78)

    return {
        base: ColorStr(hor)
        top: ColorStr(top)
        glow: ColorStr(glow)
        glowOpacity: glowA
        glowCenter: [sx, sy]
        moonOpacity: (1.0 - daylight) * 0.22 * (1.0 - cloud * 0.8)
        stars: stars
        clouds: cloudOpacity
        cloudTint: ColorStr(cloudTint)
    }
end function

function Desaturate(c as Object) as Object
    l = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15
    return [l * 0.96, l * 0.99, l * 1.06]
end function

' Fallback sun times for when no forecast is loaded: 7:00 and 17:00 local.
function DefaultSunTimes(now as Integer) as Object
    off = LocalOffset()
    midnight = now - ((now + off) mod 86400)
    return { sunrise: midnight + 7 * 3600, sunset: midnight + 17 * 3600 }
end function
