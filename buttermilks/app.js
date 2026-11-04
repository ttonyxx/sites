/* Buttermilks boulder map — plain JS, Leaflet for the map. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bm:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bm:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

  const BUCKETS = [
    { label: "VB–V2", min: -9, max: 2.99, c: "var(--g0)" },
    { label: "V3–V5", min: 3, max: 5.99, c: "var(--g1)" },
    { label: "V6–V8", min: 6, max: 8.99, c: "var(--g2)" },
    { label: "V9–V11", min: 9, max: 11.99, c: "var(--g3)" },
    { label: "V12+", min: 12, max: 99, c: "var(--g4)" },
  ];
  const bucketOf = (g) => (g == null ? -1 : BUCKETS.findIndex((b) => g >= b.min && g <= b.max));
  const colorOf = (g) => (g == null ? "#7b6f63" : BUCKETS[bucketOf(g)].c);
  const gradeHTML = (p) => `<span class="grade" style="--c:${colorOf(p.g)}">${esc(p.grade.replace(/\s*(PG13|R|X)$/, ""))}</span>`;
  const starsHTML = (s) => {
    if (s == null) return `<span class="stars"><span class="off">★★★★</span></span>`;
    const full = Math.round(s);
    return `<span class="stars" title="${s.toFixed(1)} stars">${"★".repeat(full)}<span class="off">${"★".repeat(4 - full)}</span></span>`;
  };
  const safetyHTML = (p) => (p.safety ? `<span class="tag" title="Protection rating">${esc(p.safety)}</span>` : "");

  // geo
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  function distM(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];
  function fmtDist(m) {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
    const mi = m / 1609.34;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString()} mi`;
  }

  // ------------------------------------------------------------------ state
  let D, P = {}, B = {};
  const state = {
    tab: "problems",
    q: "",
    buckets: new Set(store.get("buckets", [])),
    minStars: store.get("minStars", 0),
    sort: store.get("sort", "grade"),
    sel: null, // boulder id
    selP: null, // problem id
    me: null, // {lat, lon, acc}
    heading: null,
  };

  // ------------------------------------------------------------------ boulder geometry (in feet)
  // Each boulder is drawn "unrolled": its problems in Mountain Project's left-to-right order,
  // each reaching the problem's listed height. Areas with several blocks get split into rocks.
  const layoutCache = new Map();
  function layout(b) {
    if (layoutCache.has(b.id)) return layoutCache.get(b.id);
    const r = rng(b.id);
    const ps = b.problems.map((id) => P[id]).filter(Boolean);
    const known = ps.map((p) => p.height_ft).filter((h) => h && h > 3 && h < 60);
    const med = median(known) ?? 12;
    const hs = ps.map((p) => clamp(p.height_ft && p.height_ft > 3 && p.height_ft < 60 ? p.height_ft : med, 7, 45));
    const multi = /boulders|rocks|blocks|area|twins|grains|camp/i.test(b.name) && ps.length >= 5;
    const nGroups = multi ? Math.ceil(ps.length / 5) : 1;
    const per = Math.ceil(ps.length / nGroups) || 1;
    const groups = [];
    let x = 0, Hmax = 0;
    for (let gi = 0; gi < nGroups; gi++) {
      const idx = [];
      for (let i = gi * per; i < Math.min(ps.length, (gi + 1) * per); i++) idx.push(i);
      if (!idx.length) continue;
      const H = Math.max(...idx.map((i) => hs[i]));
      Hmax = Math.max(Hmax, H);
      const s = Math.max(3.4, H * 0.24);
      const pad = Math.max(3, H * 0.32) * (0.8 + r() * 0.5);
      const x0 = x, x1 = x0 + pad * 2 + s * (idx.length - 1);
      const pts = [[x0, 0], [x0 + pad * 0.3, H * (0.25 + r() * 0.2)]];
      const lines = [];
      idx.forEach((i, k) => {
        const px = x0 + pad + s * k;
        if (k > 0) {
          // shoulders between problems stay high, so the outline reads as one block, not spikes
          const prev = pts[pts.length - 1];
          pts.push([(prev[0] + px) / 2, Math.max(prev[1], hs[i]) * (0.9 + r() * 0.12)]);
        }
        pts.push([px, hs[i]]);
        lines.push({ i, x: px, h: hs[i], known: !!(ps[i].height_ft), lean: (r() - 0.5) * s * 0.5 });
      });
      pts.push([x1 - pad * 0.3, H * (0.3 + r() * 0.25)], [x1, 0]);
      // For single-problem rocks give the top a little shoulder so it reads as a boulder.
      if (idx.length === 1) pts.splice(2, 0, [x0 + pad * 0.62, hs[idx[0]] * (0.82 + r() * 0.1)]);
      groups.push({ x0, x1, H, pts, lines });
      x = x1 + 4 + r() * 3;
    }
    const W = groups.length ? groups[groups.length - 1].x1 : 12;
    // Map footprint (meters): a boulder's problems wrap around it, so its length is roughly
    // a third of the unrolled width, and never thinner than it is tall.
    const footM = clamp((multi ? W / 1.6 : Math.max(Hmax * 1.3, W / 2.6)) * 0.3048, 3, 45);
    const L = { groups, W, Hmax: Hmax || med, ps, multi, anyKnown: known.length > 0, footM };
    layoutCache.set(b.id, L);
    return L;
  }

  function smoothPath(pts) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // Full illustration (detail view) or thumbnail (list rows).
  function boulderSVG(b, { mini = false, hl = null } = {}) {
    const L = layout(b);
    const S = 10; // svg units per foot
    const r = rng(b.id * 7 + 3);
    const left = mini ? -1 : -9, right = L.W + (mini ? 1 : 4);
    const top = L.Hmax + (mini ? 1 : 4.5), bottom = mini ? 0.6 : 3.4;
    const vb = [left * S, -top * S, (right - left) * S, (top + bottom) * S];
    const fs = clamp(vb[2] / 32, 9, 40); // text size in svg units
    const uid = `b${b.id}${mini ? "m" : ""}`;
    const xy = ([x, y]) => [x * S, -y * S];
    let defs = `<linearGradient id="${uid}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcc29b"/><stop offset=".55" stop-color="#c9a77c"/><stop offset="1" stop-color="#a5835b"/></linearGradient>`;
    let rocks = "", tex = "", lines = "", badges = "";
    L.groups.forEach((g, gi) => {
      const pts = g.pts.map(xy);
      const d = smoothPath(pts) + "Z";
      defs += `<clipPath id="${uid}c${gi}"><path d="${d}"/></clipPath>`;
      rocks += `<path d="${d}" fill="url(#${uid}g)" stroke="#5a4532" stroke-width="${mini ? 6 : 3.5}" stroke-linejoin="round"/>`;
      if (!mini) {
        let t = "";
        // patina streaks + granite speckle, clipped to the rock
        const w = g.x1 - g.x0;
        for (let k = 0; k < Math.round(w / 6) + 1; k++) {
          const sx = g.x0 + r() * w, sy = g.H * (0.5 + r() * 0.5);
          t += `<path d="M${sx * S},${-sy * S} q${(r() - 0.5) * 20},${g.H * S * 0.25} ${(r() - 0.5) * 30},${g.H * S * (0.3 + r() * 0.4)}" stroke="#7d5f40" stroke-opacity=".22" stroke-width="${6 + r() * 10}" fill="none" stroke-linecap="round"/>`;
        }
        for (let k = 0; k < w * g.H * 0.35; k++) {
          t += `<circle cx="${(g.x0 + r() * w) * S}" cy="${-r() * g.H * S}" r="${1.2 + r() * 2}" fill="${r() < 0.5 ? "#fff" : "#4a3a2a"}" fill-opacity=".28"/>`;
        }
        t += `<path d="${smoothPath(pts.slice(1, -1).map(([x, y]) => [x, y + 6]))}" stroke="#fff" stroke-opacity=".35" stroke-width="5" fill="none"/>`;
        tex += `<g clip-path="url(#${uid}c${gi})">${t}</g>`;
      }
      g.lines.forEach((ln) => {
        const p = L.ps[ln.i];
        const on = hl == null || hl === p.id;
        const col = colorOf(p.g);
        const x0 = ln.x * S, y0 = -0.5 * S, x1 = ln.x * S, y1 = -(ln.h - 0.5) * S;
        const cx = (x0 + x1) / 2 + ln.lean * S * 0.8, cy = (y0 + y1) / 2;
        const wd = mini ? 10 : hl === p.id ? 9 : 5.5;
        lines += `<path d="M${x0},${y0} Q${cx},${cy} ${x1},${y1}" stroke="${col}" stroke-width="${wd}" fill="none" stroke-linecap="round" opacity="${on ? 1 : 0.28}"${mini ? "" : ` stroke-dasharray="${ln.known ? "none" : "10 7"}"`}/>`;
        if (!mini) {
          lines += `<circle cx="${x1}" cy="${y1}" r="${wd * 0.9}" fill="${col}" opacity="${on ? 1 : 0.28}"/>`;
          const br = Math.min(fs * 0.78, Math.max(8, (Math.max(3.4, g.H * 0.24) * S) * 0.45));
          badges += `<g data-p="${p.id}" class="badge" opacity="${on ? 1 : 0.45}" style="cursor:pointer"><circle cx="${x0}" cy="${1.45 * S}" r="${br}" fill="${col}" stroke="#fff" stroke-width="2"/><text x="${x0}" y="${1.45 * S}" dy=".35em" text-anchor="middle" font-size="${br * 1.15}" font-weight="700" fill="#fff">${ln.i + 1}</text></g>`;
        }
      });
    });
    let ground = "", over = "";
    if (!mini) {
      // ground band (drawn over the rock base), a 5'9" climber + pad for scale, and a height marker
      ground = `<rect x="${vb[0]}" y="0" width="${vb[2]}" height="${bottom * S}" fill="#e6dac7"/><line x1="${vb[0]}" x2="${vb[0] + vb[2]}" y1="0" y2="0" stroke="#8a7d70" stroke-width="2"/>`;
      const px = -5 * S, ph = 5.75 * S;
      over += `<g stroke="#5c5146" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <circle cx="${px}" cy="${-ph + 5}" r="5" fill="#5c5146" stroke="none"/>
        <path d="M${px},${-ph + 11} V${-ph * 0.47}"/>
        <path d="M${px},${-ph * 0.47} L${px - 7},0 M${px},${-ph * 0.47} L${px + 7},0"/>
        <path d="M${px - 10},${-ph * 0.52} L${px},${-ph * 0.76} L${px + 10},${-ph * 0.52}"/></g>`;
      over += `<rect x="${px - 8}" y="${-0.9 * S}" width="${S * 1.6}" height="${S * 0.9}" rx="3" fill="#3f6fb5" opacity=".85"/>`;
      over += `<text x="${px}" y="${-ph - fs * 0.5}" text-anchor="middle" font-size="${fs * 0.8}" fill="#5c5146">5′9″</text>`;
      const hx = (L.W + 2) * S, hy = -L.Hmax * S;
      over += `<g stroke="#8a7d70" stroke-width="2"><line x1="${hx}" x2="${hx}" y1="0" y2="${hy}"/><line x1="${hx - 6}" x2="${hx + 6}" y1="${hy}" y2="${hy}"/><line x1="${hx - 6}" x2="${hx + 6}" y1="0" y2="0"/></g>`;
      over += `<text x="${hx}" y="${hy - fs * 0.45}" text-anchor="end" font-size="${fs}" font-weight="600" fill="#5c5146">${L.anyKnown ? "" : "~"}${Math.round(L.Hmax)} ft</text>`;
    }
    const font = mini ? "" : ` font-family="ui-sans-serif,-apple-system,system-ui,sans-serif"`;
    // Detail drawings keep ~5px per foot, so wide boulders scroll sideways instead of shrinking.
    const size = mini ? "" : ` style="width:max(100%, ${Math.round((right - left) * 5)}px)"`;
    return `<svg viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" role="img" aria-label="Drawing of ${esc(b.name)}"${font}${size}><defs>${defs}</defs>${rocks}${tex}${ground}${lines}${over}${badges}</svg>`;
  }

  // Top-down rock blob for the map, in a -50..50 box.
  function blobPath(id) {
    const r = rng(id * 13 + 1);
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      const rr = 42 * (0.72 + r() * 0.28);
      pts.push([Math.cos(a) * rr * 1.15, Math.sin(a) * rr * 0.9]);
    }
    let d = "";
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      d += i === 0 ? `M${m[0].toFixed(1)},${m[1].toFixed(1)}` : "";
      const nxt = pts[(i + 1) % n], m2 = [(nxt[0] + pts[(i + 2) % n][0]) / 2, (nxt[1] + pts[(i + 2) % n][1]) / 2];
      d += `Q${nxt[0].toFixed(1)},${nxt[1].toFixed(1)} ${m2[0].toFixed(1)},${m2[1].toFixed(1)}`;
    }
    return d + "Z";
  }

  // ------------------------------------------------------------------ map
  let map, satLayer, markers = {}, meMarker, meCircle;
  const mapEl = $("#map");
  const isDesktop = () => matchMedia("(min-width: 900px)").matches;

  function initMap() {
    map = L.map(mapEl, { zoomControl: false, maxZoom: 21, minZoom: 12, zoomSnap: 0.25, attributionControl: true });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Paths © <a href="https://www.openstreetmap.org/copyright">OSM</a> · Data: <a href="https://www.mountainproject.com">Mountain Project</a>');
    satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    });
    map.createPane("paths").style.zIndex = 410;
    map.createPane("boulders").style.zIndex = 620;

    // Paths: roads, 4WD tracks, climber trails.
    const styles = {
      road: [{ color: "#fff", weight: 7, opacity: 1 }, { color: "#b9a68c", weight: 9, opacity: 1 }],
      track: [{ color: "#a07850", weight: 3, dashArray: "8 5", opacity: 0.9 }],
      trail: [{ color: "#7a6650", weight: 1.8, dashArray: "4 4", opacity: 0.85 }],
    };
    const order = { road: 0, track: 1, trail: 2 };
    [...D.paths].sort((a, b) => order[a.k] - order[b.k]).forEach((p) => {
      const st = styles[p.k] || styles.trail;
      if (p.k === "road") L.polyline(p.c, { ...st[1], pane: "paths", interactive: false }).addTo(map);
      L.polyline(p.c, { ...st[0], pane: "paths", interactive: false }).addTo(map);
    });

    // Boulders, drawn at real-world size (min size on screen so they stay tappable).
    D.boulders.forEach((b) => {
      const Lb = layout(b);
      const rot = Math.round(rng(b.id)() * 180 - 90);
      const html = `<div class="rock" style="--w:${Lb.footM.toFixed(1)};--rot:${rot}deg"><svg viewBox="-50 -50 100 100"><path d="${blobPath(b.id)}"/></svg></div><div class="boulder-label" style="--w:${Lb.footM.toFixed(1)}">${esc(b.name)} <i>${b.problems.length}</i></div>`;
      const m = L.marker([b.lat, b.lon], {
        icon: L.divIcon({ className: "boulder-icon", html, iconSize: [0, 0] }),
        pane: "boulders", keyboard: false, title: b.name, riseOnHover: true,
      }).addTo(map);
      m.on("click", () => go(`b/${b.id}`));
      markers[b.id] = m;
    });

    map.on("zoomend", onZoom);
    if (store.get("sat", false)) toggleSat(true);
    fitAll(false, true);
    onZoom();
  }

  function onZoom() {
    const z = map.getZoom();
    const lat = map.getCenter().lat;
    const ppm = (256 * 2 ** z) / (40075016.686 * Math.cos(rad(lat)));
    mapEl.style.setProperty("--ppm", ppm.toFixed(4));
    mapEl.classList.toggle("z-labels", z >= 18.5);
  }

  // core = the main cluster (Heaven & Sherman Acres sit a few km out and would shrink the first view)
  function fitAll(animate = true, core = false) {
    let bs = D.boulders;
    if (core) {
      const mid = { lat: median(bs.map((b) => b.lat)), lon: median(bs.map((b) => b.lon)) };
      bs = bs.filter((b) => distM(mid, b) < 1300);
    }
    const pts = bs.map((b) => [b.lat, b.lon]);
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: padTL(), paddingBottomRight: padBR(), animate });
  }
  function padTL() { return isDesktop() ? [$("#sheet").offsetWidth + 40, 30] : [20, 70]; }
  function padBR() { return isDesktop() ? [70, 30] : [60, sheetCover() + 10]; }
  function sheetCover() {
    const r = $("#sheet").getBoundingClientRect();
    return Math.max(0, innerHeight - r.top);
  }
  // Center a point in the part of the map the sheet doesn't cover.
  function focus(latlng, zoom) {
    const z = zoom ?? Math.max(map.getZoom(), 18.5);
    const px = map.project(latlng, z);
    if (isDesktop()) px.x -= ($("#sheet").offsetWidth + 12) / 2;
    else px.y += Math.min(sheetCoverFor("half"), innerHeight * 0.6) / 2 - 20;
    map.flyTo(map.unproject(px, z), z, { duration: 0.6 });
  }
  function sheetCoverFor(snap) {
    if (snap === "half") return innerHeight * 0.52;
    if (snap === "full") return innerHeight * 0.88;
    return 178;
  }

  function toggleSat(force) {
    const on = force ?? !map.hasLayer(satLayer);
    if (on) satLayer.addTo(map); else satLayer.remove();
    mapEl.classList.toggle("sat", on);
    mapEl.classList.toggle("simple", !on);
    $("#btn-layer").classList.toggle("on", on);
    store.set("sat", on);
  }

  function highlightMarkers() {
    const vis = new Set(filteredBoulders().map((x) => x.b.id));
    for (const [id, m] of Object.entries(markers)) {
      const el = m.getElement();
      if (!el) continue;
      el.classList.toggle("dim", !vis.has(+id));
      el.classList.toggle("sel", +id === state.sel);
      if (+id === state.sel) m.setZIndexOffset(1000); else m.setZIndexOffset(0);
    }
  }

  // ------------------------------------------------------------------ location
  let watchId = null, firstFix = true, lastListUpdate = 0;
  const AREA = () => L.latLngBounds(D.boulders.map((b) => [b.lat, b.lon])).pad(0.6);

  function startLocate(userGesture) {
    if (!("geolocation" in navigator)) return toast("This browser can’t share location.");
    if (userGesture) askCompass();
    if (watchId != null) {
      if (state.me) focus([state.me.lat, state.me.lon], Math.max(map.getZoom(), 17.5));
      return;
    }
    $("#btn-locate").classList.add("wait");
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 });
  }

  function onPos(pos) {
    const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
    const prev = state.me;
    state.me = { lat, lon, acc };
    $("#btn-locate").classList.remove("wait");
    $("#btn-locate").classList.add("on");
    const ll = [lat, lon];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: acc, color: "#1d6fd1", weight: 1, fillOpacity: 0.1, interactive: false, pane: "paths" }).addTo(map);
      meMarker = L.marker(ll, {
        icon: L.divIcon({ className: "me-icon", iconSize: [0, 0], html: `<svg class="me-cone" viewBox="-30 -30 60 60"><defs><radialGradient id="cone"><stop offset="0" stop-color="#1d6fd1" stop-opacity=".55"/><stop offset="1" stop-color="#1d6fd1" stop-opacity="0"/></radialGradient></defs><path d="M0,0 L-14,-28 A31,31 0 0 1 14,-28 Z" fill="url(#cone)"/></svg><div class="me-dot"></div>` }),
        interactive: false, keyboard: false, zIndexOffset: 2000, pane: "boulders",
      }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(acc);
    }
    const near = AREA().contains(ll);
    if (firstFix) {
      firstFix = false;
      if (near) {
        if (!state.sel) focus(ll, 18);
      } else {
        const center = AREA().getCenter();
        toast(`You’re ${fmtDist(distM({ lat, lon }, { lat: center.lat, lon: center.lng }))} from the Buttermilks — distances are straight-line.`, 5000);
      }
      if (store.get("sort", null) == null && near) { state.sort = "near"; $("#sort").value = "near"; }
    }
    updateLocStatus();
    const moved = !prev || distM(prev, state.me) > 4;
    if (moved && Date.now() - lastListUpdate > 2500) {
      lastListUpdate = Date.now();
      if (state.sort === "near") renderList();
      else updateListDistances();
      if (state.sel) updateWhere();
    }
  }

  function onPosErr(err) {
    $("#btn-locate").classList.remove("wait");
    if (err.code === 1) {
      toast("Location is blocked. Allow it for this site in your browser settings to see where you are.", 6000);
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    } else if (!state.me) {
      toast("Still looking for GPS… step into the open sky.", 4000);
    }
  }

  function nearestBoulder() {
    if (!state.me) return null;
    let best = null, bd = Infinity;
    for (const b of D.boulders) {
      const d = distM(state.me, b);
      if (d < bd) { bd = d; best = b; }
    }
    return best && { b: best, d: bd };
  }

  function updateLocStatus() {
    const el = $("#locstatus");
    if (!state.me) { el.hidden = true; return; }
    const n = nearestBoulder();
    el.hidden = false;
    if (n.d > 3000) {
      el.innerHTML = `You’re <b>${fmtDist(n.d)}</b> away`;
    } else {
      el.innerHTML = `Nearest: <b>${esc(n.b.name)}</b> · ${fmtDist(n.d)} ${compass(bearing(state.me, n.b))}`;
    }
  }

  // Compass heading (iOS needs a tap to grant it).
  let compassOn = false;
  function askCompass() {
    if (compassOn) return;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    const listen = () => {
      compassOn = true;
      const handler = (e) => {
        let h = null;
        if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
        else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
        if (h == null) return;
        state.heading = (h + screenAngle()) % 360;
        const cone = $(".me-cone");
        if (cone) { cone.classList.add("on"); cone.style.setProperty("--hd", `${state.heading}deg`); }
        if (state.sel) updateArrow();
      };
      window.addEventListener("deviceorientationabsolute", handler);
      window.addEventListener("deviceorientation", handler);
    };
    if (typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
    } else listen();
  }
  const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;

  // ------------------------------------------------------------------ filtering
  function tokens() {
    return state.q.toLowerCase().split(/\s+/).filter(Boolean);
  }
  function problemMatches(p, toks) {
    const b = B[p.boulder];
    if (state.buckets.size && !state.buckets.has(bucketOf(p.g))) return false;
    if (state.minStars && (p.stars ?? 0) < state.minStars) return false;
    if (!toks.length) return true;
    const hay = `${p.name} ${b.name} ${b.sector} ${p.fa ?? ""}`.toLowerCase();
    return toks.every((t) => {
      const m = t.match(/^v(b|\d+)\+?$/);
      if (m) {
        if (m[1] === "b") return p.g != null && p.g < 0;
        const n = +m[1];
        return p.g != null && (t.endsWith("+") ? p.g >= n : Math.floor(p.g + 0.3) === n);
      }
      return hay.includes(t);
    });
  }
  function filteredProblems() {
    const toks = tokens();
    return D.problems.filter((p) => problemMatches(p, toks));
  }
  function filteredBoulders() {
    const toks = tokens();
    const out = [];
    for (const b of D.boulders) {
      const ps = b.problems.map((id) => P[id]).filter((p) => problemMatches(p, toks));
      const nameHit = toks.length && toks.every((t) => `${b.name} ${b.sector}`.toLowerCase().includes(t));
      if (ps.length || (nameHit && !state.buckets.size && !state.minStars)) out.push({ b, ps });
    }
    return out;
  }
  const ploc = (p) => (p.lat ? { lat: p.lat, lon: p.lon } : B[p.boulder]);

  // ------------------------------------------------------------------ list rendering
  function renderList() {
    const list = $("#list");
    const sort = state.sort === "near" && !state.me ? "grade" : state.sort;
    let html = "";
    if (state.tab === "problems") {
      const ps = filteredProblems();
      const cmp = {
        grade: (a, b) => (a.g ?? 99) - (b.g ?? 99) || (b.stars ?? 0) - (a.stars ?? 0),
        stars: (a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.votes - a.votes,
        name: (a, b) => a.name.localeCompare(b.name),
        near: (a, b) => distM(state.me, ploc(a)) - distM(state.me, ploc(b)),
      }[sort];
      ps.sort(cmp);
      $("#n-problems").textContent = ps.length;
      $("#n-boulders").textContent = filteredBoulders().length;
      html = ps.map((p) => {
        const b = B[p.boulder];
        return `<li><button class="item" data-go="p/${p.id}">${gradeHTML(p)}<span class="main"><span class="name">${esc(p.name)}${safetyHTML(p)}</span><span class="meta">${starsHTML(p.stars)} · ${p.height_ft ? `${p.height_ft} ft · ` : ""}${esc(b.name)}</span></span>${distCell(ploc(p))}</button></li>`;
      }).join("");
      if (!ps.length) html = `<li class="empty">No problems match. Try clearing filters.</li>`;
    } else {
      const bs = filteredBoulders();
      const lo = (x) => Math.min(...x.ps.map((p) => p.g ?? 0), 99);
      const cmp = {
        grade: (a, b) => lo(a) - lo(b) || b.ps.length - a.ps.length,
        stars: (a, b) => Math.max(0, ...b.ps.map((p) => p.stars ?? 0)) - Math.max(0, ...a.ps.map((p) => p.stars ?? 0)),
        name: (a, b) => a.b.name.localeCompare(b.b.name),
        near: (a, b) => distM(state.me, a.b) - distM(state.me, b.b),
      }[sort];
      bs.sort(cmp);
      $("#n-boulders").textContent = bs.length;
      $("#n-problems").textContent = filteredProblems().length;
      html = bs.map(({ b, ps }) => {
        const all = b.problems.map((id) => P[id]);
        const gs = all.map((p) => p.g).filter((g) => g != null);
        const range = gs.length ? (Math.min(...gs) === Math.max(...gs) ? all.find((p) => p.g === Math.min(...gs)).grade : `${all.find((p) => p.g === Math.min(...gs)).grade.split(" ")[0]}–${all.find((p) => p.g === Math.max(...gs)).grade.split(" ")[0]}`) : "";
        return `<li><button class="item" data-go="b/${b.id}"><span class="thumb">${boulderSVG(b, { mini: true })}</span><span class="main"><span class="name">${esc(b.name)}</span><span class="meta">${ps.length < all.length ? `${ps.length} of ` : ""}${all.length} problem${all.length === 1 ? "" : "s"} · ${esc(range)} · ${esc(b.sector)}</span></span>${distCell(b)}</button></li>`;
      }).join("");
      if (!bs.length) html = `<li class="empty">No boulders match.</li>`;
    }
    list.innerHTML = html;
    highlightMarkers();
  }

  function distCell(loc) {
    if (!state.me) return "";
    const d = distM(state.me, loc);
    return `<span class="dist" data-lat="${loc.lat}" data-lon="${loc.lon}"><b>${fmtDist(d)}</b>${compass(bearing(state.me, loc))}</span>`;
  }
  function updateListDistances() {
    if (!state.me) return;
    const cells = $$("#list .dist");
    if (!cells.length) { renderList(); return; }
    cells.forEach((c) => {
      const loc = { lat: +c.dataset.lat, lon: +c.dataset.lon };
      c.innerHTML = `<b>${fmtDist(distM(state.me, loc))}</b>${compass(bearing(state.me, loc))}`;
    });
  }

  function renderChips() {
    $("#grade-chips").innerHTML = BUCKETS.map((b, i) => `<button class="chip" style="--c:${b.c}" aria-pressed="${state.buckets.has(i)}" data-b="${i}"><span class="sw"></span>${b.label}</button>`).join("");
  }

  // ------------------------------------------------------------------ detail
  function renderDetail() {
    const b = B[state.sel];
    const el = $("#detail");
    if (!b) return;
    const L = layout(b);
    const ps = L.ps;
    const gs = ps.map((p) => p.g).filter((g) => g != null);
    const best = [...ps].sort((a, c) => (c.stars ?? 0) - (a.stars ?? 0))[0];
    const crumbs = b.path.length > 1 ? b.path.slice(0, -1).join(" › ") : b.sector;
    el.innerHTML = `
      <div class="dhead">
        <div class="dtop">
          <button class="back" data-act="back" aria-label="Back to list"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>List</button>
          <h2>${esc(b.name)}</h2>
        </div>
        <div class="dsub">${esc(crumbs)}${b.elev_ft ? ` · ${b.elev_ft.toLocaleString()} ft elev.` : ""}</div>
        <div class="where" id="where"></div>
      </div>
      <div class="dbody">
        <div class="art" id="art"><div class="scroll">${boulderSVG(b, { hl: state.selP })}</div>
          <div class="artcap"><span>${L.multi ? "Several blocks · " : ""}problems numbered left → right</span><span>${L.anyKnown ? "heights from Mountain Project" : "heights not listed — estimated"}</span></div>
        </div>
        <div class="facts">
          <span><b>${ps.length}</b> problem${ps.length === 1 ? "" : "s"}</span>
          ${gs.length ? `<span>${esc(ps.find((p) => p.g === Math.min(...gs)).grade.split(" ")[0])} – ${esc(ps.find((p) => p.g === Math.max(...gs)).grade.split(" ")[0])}</span>` : ""}
          <span>Tallest <b>${L.anyKnown ? "" : "~"}${Math.round(L.Hmax)} ft</b></span>
          ${best && best.stars ? `<span>Classic: <b>${esc(best.name)}</b></span>` : ""}
        </div>
        ${b.approach ? `<p class="approach"><b>Getting there:</b> ${esc(b.approach)}</p>` : ""}
        <ol class="plist">
          ${ps.map((p, i) => `
            <li data-pid="${p.id}" class="${p.id === state.selP ? "on" : ""}">
              <button class="prob" data-p="${p.id}">
                <span class="num" style="--c:${colorOf(p.g)}">${i + 1}</span>
                <span class="main">
                  <span class="name">${esc(p.name)}</span>${safetyHTML(p)}
                  <span class="meta"><br>${starsHTML(p.stars)}${p.votes ? ` <span style="color:var(--ink-3)">(${p.votes})</span>` : ""}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${p.font ? ` · Font ${esc(p.font)}` : ""}</span>
                  <span class="more">
                    ${p.where ? `<p><b>Where:</b> ${esc(p.where)}</p>` : ""}
                    ${p.fa ? `<p><b>FA:</b> ${esc(p.fa)}</p>` : ""}
                    <p><a href="${esc(p.url)}" target="_blank" rel="noopener">Beta, photos & comments on Mountain Project ↗</a></p>
                  </span>
                </span>
                ${gradeHTML(p)}
              </button>
            </li>`).join("")}
        </ol>
        <p class="approach"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)} on Mountain Project ↗</a> · <a href="https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=w" target="_blank" rel="noopener">Walk here (Apple)</a> · <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking" target="_blank" rel="noopener">Google</a></p>
      </div>`;
    updateWhere();
  }

  function updateWhere() {
    const w = $("#where");
    const b = B[state.sel];
    if (!w || !b) return;
    if (!state.me) {
      w.className = "where off";
      w.innerHTML = `<span>Turn on location to see how far this is from you.</span><button class="chip" data-act="locate" style="margin-left:auto">Locate me</button>`;
      return;
    }
    const tgt = state.selP && P[state.selP] ? ploc(P[state.selP]) : b;
    const d = distM(state.me, tgt), brg = bearing(state.me, tgt);
    w.className = "where";
    const here = d < 15;
    w.innerHTML = `<svg class="arrow" viewBox="0 0 30 30" data-brg="${brg}"><circle cx="15" cy="15" r="14" fill="#fff"/><path d="M15 4 22 23 15 19 8 23Z" fill="#1d6fd1"/></svg><span>${here ? "<b>You’re here</b> (within GPS accuracy)" : `<b>${fmtDist(d)}</b> ${compass(brg)} of you${state.heading == null ? "" : " · arrow points the way"}`}${state.me.acc > 25 ? ` <span style="color:var(--ink-3)">· GPS ±${fmtDist(state.me.acc)}</span>` : ""}</span>`;
    updateArrow();
  }
  function updateArrow() {
    const a = $("#where .arrow");
    if (!a) return;
    const brg = +a.dataset.brg;
    a.style.transform = `rotate(${state.heading == null ? brg : brg - state.heading}deg)`;
  }

  function scrollArtTo(pid) {
    const sc = $("#art .scroll");
    const badge = pid && sc && sc.querySelector(`.badge[data-p="${pid}"] circle`);
    if (!badge) return;
    const r = badge.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollBy({ left: r.left + r.width / 2 - (sr.left + sr.width / 2), behavior: "smooth" });
  }

  function selectProblem(pid, scroll) {
    state.selP = pid;
    $$("#detail .plist li").forEach((li) => li.classList.toggle("on", +li.dataset.pid === pid));
    const b = B[state.sel];
    $("#art .scroll").innerHTML = boulderSVG(b, { hl: pid });
    scrollArtTo(pid);
    if (scroll) {
      const li = $(`#detail .plist li[data-pid="${pid}"]`);
      li && li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    updateWhere();
  }

  // ------------------------------------------------------------------ routing (#b/123, #p/456)
  let inApp = false;
  function go(route) {
    inApp = true;
    if (location.hash.slice(1) === route) route_(); else location.hash = route;
  }
  function route_() {
    const h = location.hash.slice(1);
    const [kind, idStr] = h.split("/");
    const id = +idStr;
    if (kind === "p" && P[id]) {
      openBoulder(P[id].boulder, id);
    } else if (kind === "b" && B[id]) {
      openBoulder(id, null);
    } else {
      closeDetail();
    }
  }
  function openBoulder(bid, pid) {
    const changed = state.sel !== bid;
    state.sel = bid;
    state.selP = pid;
    $("#listview").hidden = true;
    $("#detail").hidden = false;
    renderDetail();
    if (changed) $("#detail").scrollTop = 0;
    if (pid) setTimeout(() => selectProblem(pid, true), 30);
    highlightMarkers();
    if (!isDesktop() && sheet.dataset.snap !== "full") setSnap("half");
    const b = B[bid];
    focus([b.lat, b.lon]);
  }
  function closeDetail() {
    state.sel = null;
    state.selP = null;
    $("#detail").hidden = true;
    $("#listview").hidden = false;
    highlightMarkers();
  }
  function back() {
    if (inApp && history.length > 1) history.back();
    else { history.replaceState(null, "", location.pathname + location.search); closeDetail(); }
  }

  // ------------------------------------------------------------------ bottom sheet
  const sheet = $("#sheet");
  const SNAPS = ["peek", "half", "full"];
  function setSnap(s) { sheet.dataset.snap = s; }
  function initSheet() {
    const handle = $("#handle");
    let startY = 0, startT = 0, dragging = false, moved = false, lastY = 0, lastT = 0, vel = 0;
    const curT = () => new DOMMatrix(getComputedStyle(sheet).transform).m42;
    handle.addEventListener("pointerdown", (e) => {
      if (isDesktop()) return;
      dragging = true; moved = false;
      startY = lastY = e.clientY; startT = curT(); lastT = performance.now();
      sheet.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const now = performance.now();
      vel = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY; lastT = now;
      const maxT = sheet.offsetHeight - 120;
      sheet.style.transform = `translateY(${clamp(startT + dy, 0, maxT)}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove("dragging");
      const t = curT();
      sheet.style.transform = "";
      if (!moved) { // tap cycles
        const i = SNAPS.indexOf(sheet.dataset.snap);
        setSnap(SNAPS[(i + 1) % 3]);
        return;
      }
      const h = sheet.offsetHeight;
      const pos = { peek: h - 178, half: h - innerHeight * 0.52, full: 0 };
      let best = "half", bd = Infinity;
      const proj = t + vel * 180;
      for (const [k, v] of Object.entries(pos)) if (Math.abs(proj - v) < bd) { bd = Math.abs(proj - v); best = k; }
      setSnap(best);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const i = SNAPS.indexOf(sheet.dataset.snap); setSnap(SNAPS[(i + 1) % 3]); }
    });
  }

  // ------------------------------------------------------------------ toast
  let toastT;
  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), ms);
  }

  // ------------------------------------------------------------------ wire up
  function bind() {
    $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); renderList(); $("#list").scrollTop = 0; });
    $("#q").addEventListener("focus", () => { if (!isDesktop()) setSnap("full"); });
    $$(".tabs button").forEach((btn) => btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === btn));
      renderList();
      $("#list").scrollTop = 0;
    }));
    $("#grade-chips").addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (!c) return;
      const i = +c.dataset.b;
      state.buckets.has(i) ? state.buckets.delete(i) : state.buckets.add(i);
      store.set("buckets", [...state.buckets]);
      renderChips();
      renderList();
    });
    $("#stars").value = String(state.minStars);
    $("#stars").addEventListener("change", (e) => { state.minStars = +e.target.value; store.set("minStars", state.minStars); renderList(); });
    $("#sort").value = state.sort;
    $("#sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      store.set("sort", state.sort);
      if (state.sort === "near" && !state.me) { startLocate(true); toast("Finding you…"); }
      renderList();
    });
    $("#list").addEventListener("click", (e) => {
      const it = e.target.closest("[data-go]");
      if (it) go(it.dataset.go);
    });
    $("#detail").addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act?.dataset.act === "back") return back();
      if (act?.dataset.act === "locate") return startLocate(true);
      if (e.target.closest("a")) return;
      const pb = e.target.closest("[data-p]");
      if (pb) {
        const pid = +pb.dataset.p;
        const isOpen = state.selP === pid;
        history.replaceState(null, "", isOpen ? `#b/${state.sel}` : `#p/${pid}`);
        selectProblem(isOpen ? null : pid, pb.classList.contains("badge"));
      }
    });
    $("#btn-locate").addEventListener("click", () => startLocate(true));
    $("#btn-layer").addEventListener("click", () => toggleSat());
    $("#btn-fit").addEventListener("click", () => fitAll());
    addEventListener("hashchange", route_);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && state.sel) back(); });
  }

  async function main() {
    const res = await fetch("data/buttermilks.json");
    D = await res.json();
    D.problems.forEach((p) => (P[p.id] = p));
    D.boulders.forEach((b) => (B[b.id] = b));
    // Only keep problems whose boulder is mapped.
    D.problems = D.problems.filter((p) => B[p.boulder]);
    $("#gen").textContent = new Date(D.generated + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
    $("#subtitle").textContent = `Bishop, CA · ${D.problems.length} problems · ${D.boulders.length} boulders`;
    renderChips();
    bind();
    initSheet();
    initMap();
    window.__bm = { map, state, D };
    renderList();
    route_();
    // Ask for location right away so distances show up.
    startLocate(false);
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }
  main().catch((err) => {
    console.error(err);
    toast("Couldn’t load the boulder data. Check your connection and reload.", 10000);
  });
})();
