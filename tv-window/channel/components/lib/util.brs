' Small shared helpers: colour maths, number and time formatting, node builders.

function Clamp01(v as Float) as Float
    if v < 0 then return 0.0
    if v > 1 then return 1.0
    return v
end function

function Smooth(e0 as Float, e1 as Float, x as Float) as Float
    t = Clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
end function

function Mix(a as Float, b as Float, t as Float) as Float
    return a + (b - a) * t
end function

' "1E2A60" -> [30, 42, 96]
function Rgb(hex as String) as Object
    return [HexByte(Mid(hex, 1, 2)), HexByte(Mid(hex, 3, 2)), HexByte(Mid(hex, 5, 2))]
end function

function HexByte(s as String) as Integer
    digits = "0123456789ABCDEF"
    s = UCase(s)
    return (Instr(1, digits, Left(s, 1)) - 1) * 16 + (Instr(1, digits, Right(s, 1)) - 1)
end function

function MixRgb(a as Object, b as Object, t as Float) as Object
    return [Mix(a[0], b[0], t), Mix(a[1], b[1], t), Mix(a[2], b[2], t)]
end function

function ScaleRgb(c as Object, k as Float) as Object
    return [c[0] * k, c[1] * k, c[2] * k]
end function

function Hex2(v as Float) as String
    n = Cint(v)
    if n < 0 then n = 0
    if n > 255 then n = 255
    digits = "0123456789ABCDEF"
    return Mid(digits, (n \ 16) + 1, 1) + Mid(digits, (n mod 16) + 1, 1)
end function

' [r, g, b] (+ optional alpha 0..1) -> "0xRRGGBBAA", the format SceneGraph colour fields take.
function ColorStr(c as Object, alpha = 1.0 as Float) as String
    return "0x" + Hex2(c[0]) + Hex2(c[1]) + Hex2(c[2]) + Hex2(alpha * 255)
end function

function White(alpha as Float) as String
    return ColorStr([255, 255, 255], alpha)
end function

function Deg(v as Dynamic) as String
    if v = invalid then return "--"
    return Cint(v).ToStr() + Chr(176)
end function

' A roDateTime whose fields read as wall-clock time at the given UTC offset (seconds).
function WallClock(epoch as Integer, offset as Integer) as Object
    dt = CreateObject("roDateTime")
    dt.FromSeconds(epoch + offset)
    return dt
end function

' Seconds east of UTC for the TV's own time zone.
function LocalOffset() as Integer
    dt = CreateObject("roDateTime")
    return -dt.GetTimeZoneOffset() * 60
end function

function NowEpoch() as Integer
    return CreateObject("roDateTime").AsSeconds()
end function

function FormatHour(dt as Object, use24h as Boolean) as String
    h = dt.GetHours()
    if use24h then return Right("0" + h.ToStr(), 2) + ":00"
    suffix = " AM"
    if h >= 12 then suffix = " PM"
    h = h mod 12
    if h = 0 then h = 12
    return h.ToStr() + suffix
end function

function FormatTime(dt as Object, use24h as Boolean) as String
    h = dt.GetHours()
    mins = Right("0" + dt.GetMinutes().ToStr(), 2)
    if use24h then return Right("0" + h.ToStr(), 2) + ":" + mins
    suffix = " AM"
    if h >= 12 then suffix = " PM"
    h = h mod 12
    if h = 0 then h = 12
    return h.ToStr() + ":" + mins + suffix
end function

function WeekdayName(dt as Object, short as Boolean) as String
    names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    n = names[dt.GetDayOfWeek()]
    if short then return Left(n, 3)
    return n
end function

function MonthName(dt as Object) as String
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return names[dt.GetMonth() - 1]
end function

' ---- node builders -----------------------------------------------------------------------

function MakeFont(weight as String, size as Integer) as Object
    f = CreateObject("roSGNode", "Font")
    f.uri = "pkg:/fonts/Nunito-" + weight + ".ttf"
    f.size = size
    return f
end function

function AddLabel(parent as Object, font as Object, color as String, x as Float, y as Float) as Object
    l = parent.CreateChild("Label")
    l.font = font
    l.color = color
    l.translation = [x, y]
    return l
end function

function AddPoster(parent as Object, uri as String, x as Float, y as Float, w as Float, h as Float) as Object
    p = parent.CreateChild("Poster")
    p.uri = uri
    p.translation = [x, y]
    p.width = w
    p.height = h
    return p
end function

function TextWidth(label as Object) as Float
    return label.boundingRect().width
end function

' Right-align an auto-sized label so its right edge sits at rightX.
sub PlaceRight(label as Object, rightX as Float, y as Float)
    label.width = 0
    label.translation = [rightX - TextWidth(label), y]
end sub

' Latitude/longitude with four decimals, never in exponent form.
function Coord(v as Dynamic) as String
    neg = v < 0
    a = Abs(v)
    whole = Int(a)
    frac = Cint((a - whole) * 10000)
    if frac >= 10000
        whole = whole + 1
        frac = 0
    end if
    s = whole.ToStr() + "." + Right("000" + frac.ToStr(), 4)
    if neg then s = "-" + s
    return s
end function
