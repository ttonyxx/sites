sub init()
    m.top.functionName = "runBridge"
end sub

sub runBridge()
    port = CreateObject("roMessagePort")
    m.top.observeField("send", port)
    m.top.observeField("stop", port)
    pending = []
    sock = invalid
    buf = ""
    nl = Chr(10)
    while not m.top.stop
        if sock = invalid
            sock = openSocket(port)
            if sock <> invalid
                buf = ""
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
                if sock <> invalid then sock.SendStr(line + nl) else pending.Push(line)
            end if
        else if t = "roSocketEvent" and sock <> invalid
            if sock.IsReadable()
                n = sock.GetCountRcvBuf()
                if n > 0
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
                    sock = dropSocket(sock) ' readable with nothing to read: the bridge closed the link
                end if
            end if
        end if

        if sock <> invalid
            if not sock.IsConnected() then sock = dropSocket(sock)
        else
            Wait(1000, port) ' bridge unreachable: retry once a second
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
    s.SetMessagePort(port)
    s.NotifyReadable(true)
    if s.Connect()
        print "[window] bridge connected "; m.top.host
        return s
    end if
    s.Close()
    return invalid
end function

function dropSocket(s as Object) as Dynamic
    print "[window] bridge disconnected"
    s.Close()
    m.top.connected = false
    return invalid
end function
