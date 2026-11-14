sub init()
    m.top.functionName = "load"
end sub

' The share page embeds every photo as ["https://lh3.googleusercontent.com/pw/<id>",<width>,<height>,...].
' Those base URLs take size suffixes (=w1920-h1080-p for a smart crop), so no API key is needed.
sub load()
    result = { ok: false, photos: [], code: 0 }
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetPort(port)
    xfer.SetUrl(m.top.url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.EnableEncodings(true)
    ' Keep Roku's own User-Agent: with a desktop-browser UA the photos.app.goo.gl short link
    ' answers with an interstitial page instead of redirecting to the album.
    xfer.AddHeader("Accept-Language", "en-US,en;q=0.9")
    if xfer.AsyncGetToString()
        msg = Wait(30000, port)
        if Type(msg) = "roUrlEvent"
            result.code = msg.GetResponseCode()
            if result.code = 200
                re = CreateObject("roRegex", "\[""(https://lh3\.googleusercontent\.com/pw/[A-Za-z0-9_\-]+)"",(\d+),(\d+)", "")
                seen = {}
                seen.SetModeCaseSensitive()
                for each hit in re.MatchAll(msg.GetString())
                    if not seen.DoesExist(hit[1])
                        seen[hit[1]] = true
                        result.photos.Push({ url: hit[1], w: hit[2].ToInt(), h: hit[3].ToInt() })
                    end if
                end for
                result.ok = result.photos.Count() > 0
            end if
        else
            xfer.AsyncCancel()
        end if
    end if
    print "[window] album: "; result.photos.Count(); " photos (http "; result.code; ")"
    m.top.result = result
end sub
