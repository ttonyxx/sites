// Synthetic Open-Meteo forecast responses for the preview harness, one per weather scenario.
// Shapes match what the channel requests (timeformat=unixtime, current/hourly/daily blocks).

const SCENARIOS = {
  clear: { code: 0, cloud: 3, pop: 0 },
  partly: { code: 2, cloud: 45, pop: 10 },
  overcast: { code: 3, cloud: 96, pop: 15 },
  rain: { code: 63, cloud: 100, pop: 85 },
  snow: { code: 73, cloud: 100, pop: 70 },
  storm: { code: 95, cloud: 100, pop: 90 },
  fog: { code: 45, cloud: 80, pop: 5 },
};

export function mockForecast(scenario, searchParams) {
  const s = SCENARIOS[scenario] ?? SCENARIOS.partly;
  const celsius = searchParams.get("temperature_unit") === "celsius";
  const toUnit = (f) => (celsius ? ((f - 32) * 5) / 9 : f);
  const offset = -new Date().getTimezoneOffset() * 60; // pretend the place shares the machine's zone
  const now = Math.floor(Date.now() / 1000);
  const hourStart = now - (now % 3600);
  const localMidnight = (t) => t - ((t + offset) % 86400 + 86400) % 86400;
  const today = localMidnight(now);

  const hi = 64, lo = 49;
  const tempAt = (t) => {
    const h = (((t + offset) % 86400) + 86400) % 86400 / 3600;
    return lo + (hi - lo) * (0.5 + 0.5 * Math.cos(((h - 15) / 24) * 2 * Math.PI));
  };
  const isDay = (t) => {
    const h = (((t + offset) % 86400) + 86400) % 86400 / 3600;
    return h >= 6.83 && h < 16.97 ? 1 : 0;
  };
  const dailyCodes = [s.code, 2, 3, 61, 0, 1, 71];
  const hourlyCode = (i) => (i < 5 ? s.code : i < 9 ? (s.code >= 51 ? 3 : 2) : 1);

  const hours = Array.from({ length: 36 }, (_, i) => hourStart + i * 3600);
  const days = Array.from({ length: 7 }, (_, i) => today + i * 86400);
  return {
    latitude: 47.61,
    longitude: -122.33,
    utc_offset_seconds: offset,
    current: {
      time: now,
      temperature_2m: +toUnit(tempAt(now)).toFixed(1),
      apparent_temperature: +toUnit(tempAt(now) - 3).toFixed(1),
      weather_code: s.code,
      is_day: isDay(now),
      cloud_cover: s.cloud,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((t) => +toUnit(tempAt(t)).toFixed(1)),
      weather_code: hours.map((_, i) => hourlyCode(i)),
      precipitation_probability: hours.map((_, i) => Math.max(0, s.pop - i * 6)),
      is_day: hours.map(isDay),
    },
    daily: {
      time: days,
      weather_code: days.map((_, i) => dailyCodes[i]),
      temperature_2m_max: days.map((_, i) => +toUnit(hi + [0, 2, -3, -6, 1, 4, -2][i]).toFixed(1)),
      temperature_2m_min: days.map((_, i) => +toUnit(lo + [0, 1, -2, -4, 0, 2, -5][i]).toFixed(1)),
      sunrise: days.map((d) => d + Math.round(6.83 * 3600)),
      sunset: days.map((d) => d + Math.round(16.97 * 3600)),
      precipitation_probability_max: days.map((_, i) => [s.pop, 10, 25, 80, 0, 5, 60][i]),
    },
  };
}
