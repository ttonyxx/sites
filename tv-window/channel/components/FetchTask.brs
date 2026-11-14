sub init()
    m.top.functionName = "fetch"
end sub

sub fetch()
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    url = m.top.url
    if m.top.q <> "" then url = url.Replace("{q}", xfer.Escape(m.top.q))

    xfer.SetPort(port)
    xfer.SetUrl(url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.EnableEncodings(true)
    xfer.RetainBodyOnError(true)

    result = { ok: false, code: 0, body: "", data: invalid }
    started = false
    if m.top.method = "POST"
        xfer.SetRequest("POST")
        started = xfer.AsyncPostFromString("")
    else
        started = xfer.AsyncGetToString()
    end if
    if started
        msg = Wait(20000, port)
        if Type(msg) = "roUrlEvent"
            result.code = msg.GetResponseCode()
            result.body = msg.GetString()
            if result.code = 200
                result.data = ParseJson(result.body)
                result.ok = result.data <> invalid
            end if
        else
            xfer.AsyncCancel()
        end if
    end if
    m.top.result = result
end sub
