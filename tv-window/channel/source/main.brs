' Window — entry points.
' Main() runs when the channel is opened from the home screen.
' RunScreenSaver() runs when the TV is idle and Window is chosen in
' Settings > Theme > Screensavers.

sub Main(args as Dynamic)
    RunWindow(false)
end sub

sub RunScreenSaver()
    RunWindow(true)
end sub

sub RunWindow(isScreensaver as Boolean)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.screensaver = isScreensaver

    while true
        msg = Wait(0, port)
        if Type(msg) = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        end if
    end while
end sub
