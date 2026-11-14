' Weather: Open-Meteo request URLs, WMO code mapping and the view model the dashboard renders.
' Weather data by Open-Meteo.com (CC BY 4.0).

' base: "https://api.open-meteo.com" normally; the preview harness points it at a local fake.
function WeatherUrl(loc as Object, units as String, base as String) as String
    unit = "fahrenheit"
    if units = "C" then unit = "celsius"
    return base + "/v1/forecast?latitude=" + Coord(loc.lat) + "&longitude=" + Coord(loc.lon) + "&current=temperature_2m,apparent_temperature,weather_code,is_day,cloud_cover" + "&hourly=temperature_2m,weather_code,precipitation_probability,is_day" + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" + "&timezone=auto&timeformat=unixtime&forecast_days=7&forecast_hours=36&temperature_unit=" + unit
end function

function GeocodeUrl() as String
    return "https://geocoding-api.open-meteo.com/v1/search?name={q}&count=6&language=en&format=json"
end function

' WMO weather interpretation codes -> icon + label.
function WxInfo(code as Integer, isDay as Boolean) as Object
    icon = "cloudy" : label = "Cloudy"
    if code = 0
        label = "Clear"
        if isDay then icon = "clear_day" else icon = "clear_night"
        if isDay then label = "Sunny"
    else if code = 1
        label = "Mostly clear"
        if isDay then icon = "clear_day" else icon = "clear_night"
    else if code = 2
        label = "Partly cloudy"
        if isDay then icon = "partly_day" else icon = "partly_night"
    else if code = 3
        label = "Overcast" : icon = "cloudy"
    else if code = 45 or code = 48
        label = "Fog" : icon = "fog"
    else if code >= 51 and code <= 55
        label = "Drizzle" : icon = "drizzle"
    else if code = 56 or code = 57
        label = "Freezing drizzle" : icon = "sleet"
    else if code = 61 or code = 80
        label = "Light rain" : icon = "rain"
    else if code = 63 or code = 81
        label = "Rain" : icon = "rain"
    else if code = 65 or code = 82
        label = "Heavy rain" : icon = "rain"
    else if code = 66 or code = 67
        label = "Freezing rain" : icon = "sleet"
    else if code = 71 or code = 85
        label = "Light snow" : icon = "snow"
    else if code = 73 or code = 75 or code = 86
        label = "Snow" : icon = "snow"
    else if code = 77
        label = "Snow grains" : icon = "snow"
    else if code >= 95
        label = "Thunderstorms" : icon = "thunder"
    end if
    return { icon: "pkg:/images/wx_" + icon + ".png", label: label }
end function

function NumAt(arr as Dynamic, i as Integer) as Dynamic
    if arr = invalid then return invalid
    if i < 0 or i >= arr.Count() then return invalid
    return arr[i]
end function

function IntAt(arr as Dynamic, i as Integer, fallback as Integer) as Integer
    v = NumAt(arr, i)
    if v = invalid then return fallback
    return Cint(v)
end function

' data: parsed Open-Meteo response. Returns invalid if it is unusable.
function WeatherModel(data as Dynamic, now as Integer, use24h as Boolean) as Dynamic
    if data = invalid then return invalid
    cur = data.current
    hourly = data.hourly
    daily = data.daily
    if cur = invalid or hourly = invalid or daily = invalid then return invalid
    if daily.time = invalid or hourly.time = invalid then return invalid
    offset = 0
    if data.utc_offset_seconds <> invalid then offset = data.utc_offset_seconds

    ' "Today" is the last daily entry that has started (the cache may be from yesterday).
    d = 0
    for i = 0 to daily.time.Count() - 1
        if daily.time[i] <= now then d = i
    end for

    ' Index of the forecast hour containing "now".
    hourIdx = -1
    for i = 0 to hourly.time.Count() - 1
        if hourly.time[i] <= now and hourly.time[i] + 3600 > now
            hourIdx = i
            exit for
        end if
    end for

    ' Prefer the live "current" block; if it is stale (old cache, or time travel), use the forecast hour.
    temp = cur.temperature_2m
    code = IntAt([cur.weather_code], 0, -1)
    isDay = IntAt([cur.is_day], 0, 1) = 1
    cloud = IntAt([cur.cloud_cover], 0, 0) / 100.0
    feels = "   Feels like " + Deg(cur.apparent_temperature)
    curTime = IntAt([cur.time], 0, now)
    if Abs(now - curTime) > 2700 and hourIdx >= 0
        temp = NumAt(hourly.temperature_2m, hourIdx)
        code = IntAt(hourly.weather_code, hourIdx, code)
        isDay = IntAt(hourly.is_day, hourIdx, 1) = 1
        cloud = CloudForCode(code)
        feels = ""
    end if
    wx = WxInfo(code, isDay)
    vm = {
        temp: Deg(temp)
        icon: wx.icon
        label: wx.label
        code: code
        cloud: cloud
        sunrise: IntAt(daily.sunrise, d, 0)
        sunset: IntAt(daily.sunset, d, 0)
        hourly: []
        daily: []
    }
    vm.hilo = "H " + Deg(NumAt(daily.temperature_2m_max, d)) + "   L " + Deg(NumAt(daily.temperature_2m_min, d))
    vm.details = vm.hilo + feels

    ' Next sun event.
    nextRise = IntAt(daily.sunrise, d + 1, 0)
    if now < vm.sunrise
        vm.sun = "Sunrise " + FormatTime(WallClock(vm.sunrise, offset), use24h)
    else if now < vm.sunset
        vm.sun = "Sunset " + FormatTime(WallClock(vm.sunset, offset), use24h)
    else if nextRise > 0
        vm.sun = "Sunrise " + FormatTime(WallClock(nextRise, offset), use24h)
    else
        vm.sun = ""
    end if

    ' Hourly: start at the current hour.
    start = hourIdx
    if start >= 0
        for i = start to start + 7
            if i >= hourly.time.Count() then exit for
            hcode = IntAt(hourly.weather_code, i, 3)
            hwx = WxInfo(hcode, IntAt(hourly.is_day, i, 1) = 1)
            label = FormatHour(WallClock(hourly.time[i], offset), use24h)
            if i = start then label = "Now"
            pop = IntAt(hourly.precipitation_probability, i, 0)
            popText = ""
            if pop >= 20 then popText = pop.ToStr() + "%"
            vm.hourly.Push({ time: label, icon: hwx.icon, temp: Deg(NumAt(hourly.temperature_2m, i)), pop: popText })
        end for
    end if

    ' Daily: today plus the next four days.
    for i = d to d + 4
        if i >= daily.time.Count() then exit for
        dwx = WxInfo(IntAt(daily.weather_code, i, 3), true)
        name = WeekdayName(WallClock(daily.time[i], offset), true)
        if i = d then name = "Today"
        pop = IntAt(daily.precipitation_probability_max, i, 0)
        popText = ""
        if pop >= 20 then popText = pop.ToStr() + "%"
        vm.daily.Push({ day: name, icon: dwx.icon, hi: Deg(NumAt(daily.temperature_2m_max, i)), lo: Deg(NumAt(daily.temperature_2m_min, i)), pop: popText })
    end for
    return vm
end function

' Rough cloud cover for a weather code, for hours where only the code is known.
function CloudForCode(code as Integer) as Float
    if code = 0 then return 0.03
    if code = 1 then return 0.2
    if code = 2 then return 0.45
    if code = 3 then return 0.95
    if code = 45 or code = 48 then return 0.8
    return 1.0
end function
