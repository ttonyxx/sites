sub init()
    m.top.functionName = "discover"
end sub

sub discover()
    st = "urn:tonyxin-com:service:dibs-tv-streamer:1"
    crlf = Chr(13) + Chr(10)
    query = "M-SEARCH * HTTP/1.1" + crlf + "HOST: 239.255.255.250:1900" + crlf + "MAN: " + Chr(34) + "ssdp:discover" + Chr(34) + crlf + "MX: 1" + crlf + "ST: " + st + crlf + crlf

    port = CreateObject("roMessagePort")
    sock = CreateObject("roDatagramSocket")
    sock.SetMessagePort(port)
    dest = CreateObject("roSocketAddress")
    dest.SetAddress("239.255.255.250:1900")
    sock.SetSendToAddress(dest)
    sock.NotifyReadable(true)
    re = CreateObject("roRegex", "LOCATION:\s*(\S+)", "i")

    found = ""
    for attempt = 1 to 3
        sock.SendStr(query)
        clock = CreateObject("roTimespan")
        while found = "" and clock.TotalMilliseconds() < 1200
            ev = Wait(250, port)
            if Type(ev) = "roSocketEvent"
                if sock.IsReadable()
                    data = sock.ReceiveStr(4096)
                    if Instr(1, data, st) > 0
                        hit = re.Match(data)
                        if hit.Count() > 1 then found = hit[1]
                    end if
                end if
            end if
        end while
        if found <> "" then exit for
    end for
    sock.Close()
    if Right(found, 1) = "/" then found = Left(found, Len(found) - 1)
    print "[window] streamer discovery: "; found
    m.top.result = found
end sub
