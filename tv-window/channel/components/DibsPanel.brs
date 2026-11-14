sub init()
    name = m.top.findNode("tvName")
    name.font = MakeFont("SemiBold", 30)
    name.color = White(0.92)
    tv = CreateObject("roDeviceInfo").GetFriendlyName()
    name.text = "In the AirPlay / Screen Mirroring list, this TV is " + Chr(8220) + tv + Chr(8221)
    hint = m.top.findNode("closeHint")
    hint.font = MakeFont("Regular", 24)
    hint.color = White(0.55)
    hint.text = "Press OK to close"
    m.autoClose = m.top.findNode("autoClose")
    m.autoClose.observeField("fire", "closePanel")
end sub

sub onOpen()
    if not m.top.open then return
    m.top.visible = true
    m.top.findNode("pop").control = "start"
    m.autoClose.control = "start"
    m.top.setFocus(true)
end sub

sub closePanel()
    if not m.top.visible then return
    m.autoClose.control = "stop"
    m.top.open = false
    m.top.visible = false
    m.top.closed = true
end sub

' Any of these close it (the TV may keep Back for itself, so don't rely on it alone).
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return true
    if key = "OK" or key = "back" or key = "up" or key = "down" or key = "options" or key = "replay"
        closePanel()
    end if
    return true
end function
