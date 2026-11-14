' Window — entry points.
' Main() runs when the channel is opened from the home screen.
' RunScreenSaver() runs when the TV is idle and Window is chosen in
' Settings > Theme > Screensavers.

sub Main(args as Dynamic)
    RunWindow(false, args)
end sub

sub RunScreenSaver()
    RunWindow(true, invalid)
end sub

' Deep links: launch (or send input to) the channel with dibs=<game> to host that Dibs game right away,
' e.g. curl -X POST "http://<tv>:8060/launch/dev?dibs=punchline". Works in the TV's "Limited" ECP mode.
sub RunWindow(isScreensaver as Boolean, args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.screensaver = isScreensaver
    if args <> invalid then scene.launchArgs = args
    input = CreateObject("roInput")
    input.SetMessagePort(port)

    while true
        msg = Wait(0, port)
        if Type(msg) = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        else if Type(msg) = "roInputEvent"
            if msg.IsInput() then scene.launchArgs = msg.GetInfo()
        end if
    end while
end sub
