sub init()
    m.top.functionName = "runBridge"
end sub

' Connects in blocking mode (fine on a Task thread; this Roku never reports a non-blocking connect as
' done), then attaches the message port for reads. Every event goes through the one Wait below (a second
' Wait would swallow "send" events), and retries are timed with a roTimespan instead of sleeping.
sub runBridge()
    port = CreateObject("roMessagePort")
    m.top.observeField("send", port)
    m.top.observeField("stop", port)
    pending = []
    if m.top.send <> "" then pending.Push(m.top.send) ' written before this thread started observing
    sock = invalid
    live = false
    since = CreateObject("roTimespan") ' time since the current connect attempt (or the last drop)
    retryMs = 0
    empties = 0 ' readable events with nothing to read in a row (the bridge closed the link)
    buf = ""
    nl = Chr(10)
    while not m.top.stop
        if sock = invalid and since.TotalMilliseconds() >= retryMs
            sock = openSocket(port)
            since.Mark()
            retryMs = 1000
            if sock <> invalid
                live = true
                buf = ""
                empties = 0
                m.top.connected = true
                for each line in pending
                    sock.SendStr(line + nl)
                end for
                pending = []
            end if
        end if

        msg = Wait(250, port)
        t = Type(msg)
        if t = "roSGNodeEvent"
            if msg.GetField() = "send"
                line = msg.GetData()
                if live then sock.SendStr(line + nl) else pending.Push(line)
            end if
        else if t = "roSocketEvent" and live
            if sock.IsReadable()
                n = sock.GetCountRcvBuf()
                if n > 0
                    empties = 0
                    buf = buf + sock.ReceiveStr(n)
                    i = Instr(1, buf, nl)
                    while i > 0
                        line = Left(buf, i - 1)
                        buf = Mid(buf, i + 1)
                        if line <> ""
                            obj = ParseJson(line)
                            if obj <> invalid then m.top.message = obj
                        end if
                        i = Instr(1, buf, nl)
                    end while
                else
                    empties = empties + 1
                    if empties >= 3
                        sock = dropSocket(sock, true, "closed by bridge")
                        live = false
                        empties = 0
                        since.Mark()
                    end if
                end if
            end if
        end if

    end while
    if sock <> invalid then sock.Close()
end sub

function openSocket(port as Object) as Dynamic
    if m.top.host = "" then return invalid
    s = CreateObject("roStreamSocket")
    addr = CreateObject("roSocketAddress")
    addr.SetAddress(m.top.host)
    s.SetSendToAddress(addr)
    if not s.Connect()
        s.Close()
        return invalid
    end if
    s.SetMessagePort(port)
    s.NotifyReadable(true)
    print "[window] bridge connected "; m.top.host; " (isConnected="; s.IsConnected(); ")"
    return s
end function

function dropSocket(s as Object, wasLive as Boolean, why as String) as Dynamic
    print "[window] bridge disconnected: "; why
    if wasLive
        m.top.connected = false
    end if
    s.Close()
    return invalid
end function
