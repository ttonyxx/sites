/* Boulder Atlas — an offline-first map of bouldering areas. Plain JS + Leaflet. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("atlas:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("atlas:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
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
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

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
  const ICON = {
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    saved: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    dl: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    done: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`,
  };

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
  let REG = null;
  const P = {}, B = {}, A = {};
  const state = {
    tab: "problems",
    q: "",
    buckets: new Set(store.get("buckets", [])),
    minStars: store.get("minStars", 0),
    sort: store.get("sort", "grade"),
    area: store.get("area", "all"),
    sel: null,
    selP: null,
    me: null,
    heading: null,
    user: null,
  };
  // Saved climbs: problem id -> time saved. Synced to the account when signed in (auth.js).
  const saved = new Map(Object.entries(store.get("saved", {})).map(([k, v]) => [+k, v]));
  const downloaded = new Set(store.get("downloaded", []));
  const bus = new EventTarget();

  function setSaved(pid, on, { silent = false } = {}) {
    if (on) saved.set(pid, saved.get(pid) || Date.now());
    else saved.delete(pid);
    store.set("saved", Object.fromEntries(saved));
    if (!silent) bus.dispatchEvent(new CustomEvent("saved", { detail: { pid, on } }));
    refreshSavedUI();
  }
  function replaceSaved(map) {
    saved.clear();
    for (const [k, v] of Object.entries(map || {})) if (P[+k]) saved.set(+k, v);
    store.set("saved", Object.fromEntries(saved));
    refreshSavedUI();
  }
  function refreshSavedUI() {
    $("#n-saved").textContent = saved.size || "";
    if (state.tab === "saved") renderList();
    if (state.sel) $$("#detail [data-act=save]").forEach((b) => paintSave(b, +b.dataset.pid));
  }
  function paintSave(btn, pid) {
    const on = saved.has(pid);
    btn.classList.toggle("on", on);
    btn.innerHTML = `${on ? ICON.saved : ICON.save}<span>${on ? "Saved" : "Save"}</span>`;
    btn.setAttribute("aria-pressed", on);
  }
  function paintDl(btn, pid) {
    const on = downloaded.has(pid);
    btn.classList.toggle("on", on);
    btn.innerHTML = `${on ? ICON.done : ICON.dl}<span>${on ? "Downloaded" : "Download"}</span>`;
  }

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
    const multi = /boulders|rocks|blocks|area|twins|grains|camp|circuit/i.test(b.name) && ps.length >= 5;
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
          const prev = pts[pts.length - 1];
          pts.push([(prev[0] + px) / 2, Math.max(prev[1], hs[i]) * (0.9 + r() * 0.12)]);
        }
        pts.push([px, hs[i]]);
        lines.push({ i, x: px, h: hs[i], known: !!ps[i].height_ft, lean: (r() - 0.5) * s * 0.5 });
      });
      pts.push([x1 - pad * 0.3, H * (0.3 + r() * 0.25)], [x1, 0]);
      if (idx.length === 1) pts.splice(2, 0, [x0 + pad * 0.62, hs[idx[0]] * (0.82 + r() * 0.1)]);
      groups.push({ x0, x1, H, pts, lines });
      x = x1 + 4 + r() * 3;
    }
    const W = groups.length ? groups[groups.length - 1].x1 : 12;
    // Map footprint (meters) when there's no traced outline: problems wrap around a boulder, so its
    // length is roughly a third of the unrolled width, and never thinner than it is tall.
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

  // Side-view drawing (detail view) or thumbnail (list rows).
  function boulderSVG(b, { mini = false, hl = null } = {}) {
    const L = layout(b);
    const S = 10; // svg units per foot
    const r = rng(b.id * 7 + 3);
    const left = mini ? -1 : -9, right = L.W + (mini ? 1 : 4);
    const top = L.Hmax + (mini ? 1 : 4.5), bottom = mini ? 0.6 : 3.4;
    const vb = [left * S, -top * S, (right - left) * S, (top + bottom) * S];
    const fs = clamp(vb[2] / 32, 9, 40);
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
          const br = Math.min(fs * 0.78, Math.max(8, Math.max(3.4, g.H * 0.24) * S * 0.45));
          badges += `<g data-p="${p.id}" class="badge" opacity="${on ? 1 : 0.45}" style="cursor:pointer"><circle cx="${x0}" cy="${1.45 * S}" r="${br}" fill="${col}" stroke="#fff" stroke-width="2"/><text x="${x0}" y="${1.45 * S}" dy=".35em" text-anchor="middle" font-size="${br * 1.15}" font-weight="700" fill="#fff">${ln.i + 1}</text></g>`;
        }
      });
    });
    let ground = "", over = "";
    if (!mini) {
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
    const font = mini ? "" : ` font-family="Barlow, ui-sans-serif, system-ui, sans-serif"`;
    const size = mini ? "" : ` style="width:max(100%, ${Math.round((right - left) * 5)}px)"`;
    return `<svg viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" role="img" aria-label="Drawing of ${esc(b.name)}"${font}${size}><defs>${defs}</defs>${rocks}${tex}${ground}${lines}${over}${badges}</svg>`;
  }

  // Top-down footprint in real meters: a traced outline when we have one, otherwise a rounded
  // rock shape sized from the problems' heights. Drawn as a map polygon so it scales smoothly.
  function chaikin(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    return out;
  }
  const ringCache = new Map();
  function footprint(b) {
    if (ringCache.has(b.id)) return ringCache.get(b.id);
    let ring;
    if (b.outline && b.outline.length > 3) {
      ring = b.outline;
    } else {
      const r = rng(b.id * 13 + 1);
      const a = layout(b).footM / 2, c = a * 0.74, rot = r() * Math.PI;
      let pts = [];
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2 + (r() - 0.5) * 0.35, k = 0.8 + r() * 0.2;
        pts.push([Math.cos(t) * a * k, Math.sin(t) * c * k]);
      }
      pts = chaikin(chaikin(pts));
      const cosLat = Math.cos(rad(b.lat));
      ring = pts.map(([x, y]) => {
        const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot);
        return [b.lat + yr / 111320, b.lon + xr / (111320 * cosLat)];
      });
    }
    ringCache.set(b.id, ring);
    return ring;
  }

  // ------------------------------------------------------------------ map
  let map, satLayer;
  const polys = {}, dots = {}, labels = {}, areaMarkers = {}, pathLayers = [];
  let meMarker, meCircle;
  const mapEl = $("#map");
  const isDesktop = () => matchMedia("(min-width: 900px)").matches;
  const isSat = () => mapEl.classList.contains("sat");

  const POLY = {
    simple: { color: "#4a3a2a", weight: 1.2, fillColor: "#c9a77c", fillOpacity: 1, opacity: 1 },
    sat: { color: "#ffffff", weight: 1.8, fillColor: "#ffffff", fillOpacity: 0.08, opacity: 0.95 },
  };
  function polyStyle(id, dim) {
    const base = isSat() ? POLY.sat : POLY.simple;
    if (id === state.sel) return { ...base, color: isSat() ? "#ffd25a" : "#111", weight: 2.8, fillColor: "#ffd25a", fillOpacity: isSat() ? 0.25 : 1, opacity: 1 };
    if (dim) return { ...base, fillOpacity: base.fillOpacity * 0.3, opacity: 0.3 };
    return base;
  }
  const PATH = {
    hwy: [{ color: "#b9a68c", weight: 8 }, { color: "#fffdf8", weight: 5.5 }],
    road: [{ color: "#c8b79f", weight: 6 }, { color: "#fffdf8", weight: 3.8 }],
    track: [{ color: "#a07850", weight: 2.6, dashArray: "8 5", opacity: 0.9 }],
    trail: [{ color: "#7a6650", weight: 1.7, dashArray: "4 4", opacity: 0.85 }],
  };
  const PATH_SAT = {
    track: [{ color: "#fff1d6", weight: 2.4, dashArray: "8 5", opacity: 0.85 }],
    trail: [{ color: "#ffffff", weight: 1.8, dashArray: "4 4", opacity: 0.85 }],
  };

  function initMap() {
    map = L.map(mapEl, { zoomControl: false, maxZoom: 21, minZoom: 8, zoomSnap: 0.25, wheelPxPerZoomLevel: 90 });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Paths © <a href="https://www.openstreetmap.org/copyright">OSM</a> · Data: <a href="https://www.mountainproject.com">Mountain Project</a>');
    satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    });
    [["paths", 405], ["boulders", 420], ["dots", 610], ["labels", 620], ["areas", 630], ["me", 640]].forEach(([n, z]) => {
      map.createPane(n).style.zIndex = z;
    });
    map.getPane("labels").style.pointerEvents = "none";

    const order = { hwy: 0, road: 1, track: 2, trail: 3 };
    [...REG.paths].sort((a, b) => order[a.k] - order[b.k]).forEach((p) => {
      const styles = PATH[p.k] || PATH.trail;
      styles.forEach((st, i) => {
        const line = L.polyline(p.c, { ...st, pane: "paths", interactive: false, lineCap: "round", lineJoin: "round" }).addTo(map);
        pathLayers.push({ line, kind: p.k, i });
      });
    });

    const pick = (b) => () => go(`b/${b.id}`);
    REG.boulders.forEach((b) => {
      const ring = footprint(b);
      polys[b.id] = L.polygon(ring, { pane: "boulders", ...POLY.simple, bubblingMouseEvents: false }).on("click", pick(b)).addTo(map);
      dots[b.id] = L.marker([b.lat, b.lon], {
        pane: "dots", keyboard: false, title: b.name,
        icon: L.divIcon({ className: "bdot", iconSize: [12, 12] }),
      }).on("click", pick(b)).addTo(map);
      const south = Math.min(...ring.map((p) => p[0]));
      labels[b.id] = L.marker([south, b.lon], {
        pane: "labels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "blabel", iconSize: [0, 0], html: `<span>${esc(b.name)} <i>${b.problems.length}</i></span>` }),
      }).addTo(map);
    });
    REG.areas.forEach((a) => {
      areaMarkers[a.id] = L.marker([a.lat, a.lon], {
        pane: "areas", keyboard: false,
        icon: L.divIcon({ className: "alabel", iconSize: [0, 0], html: `<button type="button"><b>${esc(a.name)}</b><span>${a.problems.toLocaleString()}</span></button>` }),
      }).on("click", () => openArea(a.id)).addTo(map);
    });

    map.on("zoomend", onZoom);
    map.on("moveend", () => {
      declutterLabels();
      const c = map.getCenter();
      store.set("view", { lat: c.lat, lon: c.lng, z: map.getZoom(), region: REG.id });
    });
    if (store.get("sat", false)) toggleSat(true);
    // Start where the climber left off, else show the whole region. Wait until the map has a real
    // size (a tab opened in the background can start at 0×0, which would produce a bogus zoom).
    const initialView = () => {
      const v = store.get("view", null);
      if (v && v.region === REG.id && v.z >= 9) map.setView([v.lat, v.lon], v.z, { animate: false });
      else fitRegion(false);
      onZoom();
    };
    if (map.getSize().x > 50 && map.getSize().y > 50) initialView();
    else {
      map.setView([REG.areas[0].lat, REG.areas[0].lon], 11, { animate: false });
      const wait = () => { if (map.getSize().x > 50 && map.getSize().y > 50) { map.off("resize", wait); initialView(); } };
      map.on("resize", wait);
    }
    onZoom();
  }

  // Zoom-dependent layers are switched with classes (fades), never resized, so zooming stays smooth.
  function onZoom() {
    const z = map.getZoom();
    const cl = mapEl.classList;
    cl.toggle("z-far", z < 12.75);
    cl.toggle("z-areas", z < 14.75);
    cl.toggle("z-near", z >= 17.75);
    cl.toggle("z-labels", z >= 18.25);
    declutterAreas();
    declutterLabels();
  }
  // Boulder names: when two would overlap, keep the selected boulder's, then the one with more problems.
  function declutterLabels() {
    if (!mapEl.classList.contains("z-labels")) return;
    const view = map.getBounds().pad(0.25);
    const items = REG.boulders.filter((b) => view.contains([b.lat, b.lon]));
    items.sort((a, b) => (b.id === state.sel) - (a.id === state.sel) || b.problems.length - a.problems.length);
    const placed = [];
    for (const b of items) {
      const m = labels[b.id], el = m.getElement();
      const span = el?.firstElementChild;
      if (!span) continue;
      const p = map.latLngToContainerPoint(m.getLatLng());
      const w = span.offsetWidth, h = span.offsetHeight;
      const r = { l: p.x - w / 2 - 2, r: p.x + w / 2 + 2, t: p.y + 1, b: p.y + 3 + h };
      const hit = b.id !== state.sel && placed.some((q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t);
      el.classList.toggle("hide", hit);
      if (!hit) placed.push(r);
    }
  }
  // Neighbouring areas (Happy & Sad Boulders) would cover each other: nudge the smaller label
  // up or down until it's clear, or hide it if there's no room.
  function declutterAreas() {
    if (!mapEl.classList.contains("z-areas")) return;
    const placed = [];
    for (const a of [...REG.areas].sort((x, y) => y.problems - x.problems)) {
      const el = areaMarkers[a.id].getElement()?.firstElementChild;
      if (!el) continue;
      el.style.setProperty("--dy", "0px");
      el.style.visibility = "";
      const p = map.latLngToContainerPoint([a.lat, a.lon]);
      const w = el.offsetWidth || 120, h = el.offsetHeight || 26;
      let ok = false;
      for (const dy of [0, h + 4, -(h + 4), 2 * (h + 4), -2 * (h + 4)]) {
        const r = { l: p.x - w / 2 - 3, r: p.x + w / 2 + 3, t: p.y - h / 2 + dy - 2, b: p.y + h / 2 + dy + 2 };
        if (!placed.some((q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t)) {
          placed.push(r);
          el.style.setProperty("--dy", `${dy}px`);
          ok = true;
          break;
        }
      }
      if (!ok) el.style.visibility = "hidden";
    }
  }

  function boundsOf(bs) { return L.latLngBounds(bs.map((b) => [b.lat, b.lon])); }
  function fitRegion(animate = true) {
    map.fitBounds(boundsOf(REG.boulders), { paddingTopLeft: padTL(), paddingBottomRight: padBR(), animate, maxZoom: 16 });
  }
  function fitArea(aid, animate = true) {
    const bs = REG.boulders.filter((b) => b.area === aid);
    // Keep the area's main cluster in view (a few outlying boulders shouldn't zoom us way out).
    const mid = { lat: median(bs.map((b) => b.lat)), lon: median(bs.map((b) => b.lon)) };
    const core = bs.filter((b) => distM(mid, b) < 1500);
    map.fitBounds(boundsOf(core.length ? core : bs), { paddingTopLeft: padTL(), paddingBottomRight: padBR(), animate, maxZoom: 18.5 });
  }
  function padTL() { return isDesktop() ? [$("#sheet").offsetWidth + 40, 30] : [20, 80]; }
  function padBR() { return isDesktop() ? [70, 30] : [60, sheetCover() + 10]; }
  function sheetCover() { return Math.max(0, innerHeight - $("#sheet").getBoundingClientRect().top); }
  function focus(latlng, zoom) {
    const z = zoom ?? Math.max(map.getZoom(), 18.5);
    const px = map.project(latlng, z);
    if (isDesktop()) px.x -= ($("#sheet").offsetWidth + 12) / 2;
    else px.y += Math.min(innerHeight * 0.52, innerHeight * 0.6) / 2 - 20;
    map.flyTo(map.unproject(px, z), z, { duration: 0.6 });
  }

  function toggleSat(force) {
    const on = force ?? !map.hasLayer(satLayer);
    if (on && !navigator.onLine) { toast("Satellite view needs a connection. The trail map works offline."); return; }
    if (on) satLayer.addTo(map); else satLayer.remove();
    mapEl.classList.toggle("sat", on);
    mapEl.classList.toggle("simple", !on);
    $("#btn-layer").classList.toggle("on", on);
    store.set("sat", on);
    pathLayers.forEach(({ line, kind, i }) => {
      const st = (on && PATH_SAT[kind]) || PATH[kind] || PATH.trail;
      if (st[i]) line.setStyle(st[i]);
      if (on && kind !== "hwy" && kind !== "road" && !PATH_SAT[kind]?.[i]) line.setStyle({ opacity: 0 });
    });
    highlight();
  }

  function highlight() {
    if (!map) return;
    const vis = new Set(filteredBoulders().map((x) => x.b.id));
    for (const b of REG.boulders) {
      const dim = !vis.has(b.id), sel = b.id === state.sel;
      polys[b.id].setStyle(polyStyle(b.id, dim));
      if (sel) polys[b.id].bringToFront();
      for (const m of [dots[b.id], labels[b.id]]) {
        const el = m.getElement();
        if (!el) continue;
        el.classList.toggle("dim", dim);
        el.classList.toggle("sel", sel);
      }
      dots[b.id].setZIndexOffset(sel ? 1000 : 0);
    }
    for (const [aid, m] of Object.entries(areaMarkers)) m.getElement()?.classList.toggle("sel", aid === state.area);
    declutterLabels();
  }

  // ------------------------------------------------------------------ location
  let watchId = null, firstFix = true, lastListUpdate = 0;
  const regionBounds = () => boundsOf(REG.boulders).pad(0.25);

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
        interactive: false, keyboard: false, pane: "me",
      }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(acc);
    }
    const near = regionBounds().contains(ll);
    if (firstFix) {
      firstFix = false;
      if (near) {
        if (!state.sel) focus(ll, 17.5);
        if (store.get("sort", null) == null) { state.sort = "near"; $("#sort").value = "near"; }
      } else {
        const c = regionBounds().getCenter();
        toast(`You’re ${fmtDist(distM({ lat, lon }, { lat: c.lat, lon: c.lng }))} from ${REG.name}. Distances are straight-line.`, 5000);
      }
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
      toast("Still looking for GPS… step into open sky.", 4000);
    }
  }

  function nearestBoulder() {
    if (!state.me) return null;
    let best = null, bd = Infinity;
    for (const b of REG.boulders) {
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
    el.innerHTML = n.d > 3000 ? `You’re <b>${fmtDist(n.d)}</b> away` : `Nearest: <b>${esc(n.b.name)}</b> · ${fmtDist(n.d)} ${compass(bearing(state.me, n.b))}`;
  }

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
      addEventListener("deviceorientationabsolute", handler);
      addEventListener("deviceorientation", handler);
    };
    if (typeof DOE.requestPermission === "function") DOE.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
    else listen();
  }
  const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;

  // ------------------------------------------------------------------ filtering
  const tokens = () => state.q.toLowerCase().split(/\s+/).filter(Boolean);
  function textMatch(p, toks) {
    if (!toks.length) return true;
    const b = B[p.boulder];
    const hay = `${p.name} ${b.name} ${b.sector} ${A[b.area]?.name ?? ""} ${p.fa ?? ""}`.toLowerCase();
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
  function problemMatches(p, toks) {
    if (state.area !== "all" && B[p.boulder].area !== state.area) return false;
    if (state.buckets.size && !state.buckets.has(bucketOf(p.g))) return false;
    if (state.minStars && (p.stars ?? 0) < state.minStars) return false;
    return textMatch(p, toks);
  }
  function filteredProblems() {
    const toks = tokens();
    return REG.problems.filter((p) => problemMatches(p, toks));
  }
  function filteredBoulders() {
    const toks = tokens();
    const out = [];
    for (const b of REG.boulders) {
      if (state.area !== "all" && b.area !== state.area) continue;
      const ps = b.problems.map((id) => P[id]).filter((p) => problemMatches(p, toks));
      const nameHit = toks.length && toks.every((t) => `${b.name} ${b.sector}`.toLowerCase().includes(t));
      if (ps.length || (nameHit && !state.buckets.size && !state.minStars)) out.push({ b, ps });
    }
    return out;
  }
  const ploc = (p) => (p.lat ? { lat: p.lat, lon: p.lon } : B[p.boulder]);

  // ------------------------------------------------------------------ list rendering
  const problemSorts = () => ({
    grade: (a, b) => (a.g ?? 99) - (b.g ?? 99) || (b.stars ?? 0) - (a.stars ?? 0),
    stars: (a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.votes - a.votes,
    name: (a, b) => a.name.localeCompare(b.name),
    near: (a, b) => distM(state.me, ploc(a)) - distM(state.me, ploc(b)),
    recent: (a, b) => (saved.get(b.id) || 0) - (saved.get(a.id) || 0),
  });
  function problemRow(p) {
    const b = B[p.boulder];
    const nv = p.videos?.length || 0;
    const where = state.area === "all" ? `${esc(b.name)} · ${esc(A[b.area]?.name ?? "")}` : esc(b.name);
    return `<li><button class="item" data-go="p/${p.id}">${gradeHTML(p)}<span class="main"><span class="name">${esc(p.name)}${safetyHTML(p)}${saved.has(p.id) ? `<span class="mark" title="Saved">${ICON.saved}</span>` : ""}${downloaded.has(p.id) ? `<span class="mark dl" title="Downloaded">${ICON.done}</span>` : ""}</span><span class="meta">${starsHTML(p.stars)}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${nv ? ` · <span class="vids">${ICON.play}${nv}</span>` : ""} · ${where}</span></span>${distCell(ploc(p))}</button></li>`;
  }
  function renderList() {
    if (!REG) return;
    const list = $("#list");
    const sort = state.sort === "near" && !state.me ? "grade" : state.sort;
    let html = "";
    const nP = filteredProblems(), nB = filteredBoulders();
    $("#n-problems").textContent = nP.length.toLocaleString();
    $("#n-boulders").textContent = nB.length.toLocaleString();
    $("#n-saved").textContent = saved.size || "";
    $("#filters").hidden = state.tab === "saved";
    if (state.tab === "problems") {
      nP.sort(problemSorts()[sort]);
      html = nP.map(problemRow).join("") || `<li class="empty">No problems match. Try clearing filters.</li>`;
    } else if (state.tab === "boulders") {
      const lo = (x) => Math.min(...x.ps.map((p) => p.g ?? 0), 99);
      const cmp = {
        grade: (a, b) => lo(a) - lo(b) || b.ps.length - a.ps.length,
        stars: (a, b) => Math.max(0, ...b.ps.map((p) => p.stars ?? 0)) - Math.max(0, ...a.ps.map((p) => p.stars ?? 0)),
        name: (a, b) => a.b.name.localeCompare(b.b.name),
        near: (a, b) => distM(state.me, a.b) - distM(state.me, b.b),
      }[sort];
      nB.sort(cmp);
      html = nB.map(({ b, ps }) => {
        const all = b.problems.map((id) => P[id]);
        const gs = all.map((p) => p.g).filter((g) => g != null);
        const lo = all.find((p) => p.g === Math.min(...gs)), hi = all.find((p) => p.g === Math.max(...gs));
        const range = gs.length ? (lo === hi ? lo.grade : `${lo.grade.split(" ")[0]}–${hi.grade.split(" ")[0]}`) : "";
        return `<li><button class="item" data-go="b/${b.id}"><span class="thumb">${boulderSVG(b, { mini: true })}</span><span class="main"><span class="name">${esc(b.name)}</span><span class="meta">${ps.length < all.length ? `${ps.length} of ` : ""}${plural(all.length, "problem")} · ${esc(range)} · ${esc(state.area === "all" ? A[b.area]?.name : b.sector)}</span></span>${distCell(b)}</button></li>`;
      }).join("") || `<li class="empty">No boulders match.</li>`;
    } else {
      const toks = tokens();
      const ps = [...saved.keys()].map((id) => P[id]).filter((p) => p && textMatch(p, toks));
      ps.sort(problemSorts()[state.sort === "near" && state.me ? "near" : "recent"]);
      const nDl = ps.filter((p) => downloaded.has(p.id)).length;
      html = `<li class="savedhead">
          <div>${saved.size ? `<b>${plural(saved.size, "saved climb")}</b> · ${nDl === ps.length && ps.length ? "all downloaded for offline" : `${nDl} downloaded`}` : "<b>No saved climbs yet.</b> Tap <i>Save</i> on any problem to keep it here."}</div>
          ${ps.length && nDl < ps.length ? `<button class="pill" data-act="dl-saved">${ICON.dl}<span>Download all</span></button>` : ""}
          ${state.user ? `<div class="sync">Synced to ${esc(state.user.email || state.user.name)}</div>` : window.AtlasAuth ? `<div class="sync"><button class="link" data-act="signin">Sign in with Google</button> to keep saved climbs on every device.</div>` : ""}
        </li>` + ps.map(problemRow).join("");
    }
    list.innerHTML = html;
    highlight();
  }

  function distCell(loc) {
    if (!state.me) return "";
    return `<span class="dist" data-lat="${loc.lat}" data-lon="${loc.lon}"><b>${fmtDist(distM(state.me, loc))}</b>${compass(bearing(state.me, loc))}</span>`;
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
  function renderAreaSelect() {
    $("#area").innerHTML = `<option value="all">All of ${esc(REG.name)} (${REG.problems.length.toLocaleString()})</option>` +
      REG.areas.map((a) => `<option value="${a.id}">${esc(a.name)} (${a.problems.toLocaleString()})</option>`).join("");
    if (state.area !== "all" && !A[state.area]) state.area = "all";
    $("#area").value = state.area;
  }
  function openArea(aid) {
    state.area = aid;
    store.set("area", aid);
    $("#area").value = aid;
    if (state.sel) back();
    renderList();
    if (aid !== "all") fitArea(aid); else fitRegion();
  }

  // ------------------------------------------------------------------ detail
  function videoHTML(p) {
    const b = B[p.boulder];
    const q = encodeURIComponent(`${p.name} ${p.grade.split(" ")[0]} ${A[b.area]?.name ?? ""} ${REG.name} boulder`);
    const vids = (p.videos || []).map((v) => {
      const href = v.y ? `https://www.youtube.com/watch?v=${v.y}` : `https://vimeo.com/${v.v}`;
      const img = v.y ? `<img loading="lazy" src="https://i.ytimg.com/vi/${v.y}/mqdefault.jpg" alt="">` : `<span class="noimg">${ICON.play}</span>`;
      const who = [v.ch || v.by, v.yr].filter(Boolean).join(" · ");
      return `<a class="vid" href="${href}" target="_blank" rel="noopener">${img}<span class="vt">${esc(v.t || "Beta video")}</span><span class="vm">${esc(who)}</span></a>`;
    }).join("");
    return `<div class="betavids">
        <div class="bvh">${ICON.play}<b>Beta videos</b>${p.videos?.length ? ` <span>${p.videos.length} from climbers on Mountain Project</span>` : ""}</div>
        ${vids ? `<div class="vrow">${vids}</div>` : `<p class="none">No videos posted on Mountain Project yet.</p>`}
        <a class="ysearch" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Search YouTube for more beta ↗</a>
      </div>`;
  }

  function renderDetail() {
    const b = B[state.sel];
    const el = $("#detail");
    if (!b) return;
    const L = layout(b);
    const ps = L.ps;
    const gs = ps.map((p) => p.g).filter((g) => g != null);
    const best = [...ps].sort((a, c) => (c.stars ?? 0) - (a.stars ?? 0))[0];
    const crumbs = [A[b.area]?.name, ...b.path.slice(1, -1)].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(" › ");
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
          <div class="artcap"><span>${L.multi ? "Several blocks · " : ""}problems numbered left → right</span><span>${L.anyKnown ? "heights from Mountain Project" : "heights not listed, estimated"}</span></div>
        </div>
        <div class="facts">
          <span><b>${ps.length}</b> problem${ps.length === 1 ? "" : "s"}</span>
          ${gs.length ? `<span>${esc(ps.find((p) => p.g === Math.min(...gs)).grade.split(" ")[0])} – ${esc(ps.find((p) => p.g === Math.max(...gs)).grade.split(" ")[0])}</span>` : ""}
          <span>Tallest <b>${L.anyKnown ? "" : "~"}${Math.round(L.Hmax)} ft</b></span>
          ${best && best.stars ? `<span>Classic: <b>${esc(best.name)}</b></span>` : ""}
          <span>${b.outline ? "Outline traced from aerial imagery" : "Footprint estimated"}</span>
        </div>
        ${b.approach ? `<p class="approach"><b>Getting there:</b> ${esc(b.approach)}</p>` : ""}
        <ol class="plist">
          ${ps.map((p, i) => `
            <li data-pid="${p.id}" class="${p.id === state.selP ? "on" : ""}">
              <button class="prob" data-p="${p.id}">
                <span class="num" style="--c:${colorOf(p.g)}">${i + 1}</span>
                <span class="main">
                  <span class="name">${esc(p.name)}</span>${safetyHTML(p)}${saved.has(p.id) ? `<span class="mark">${ICON.saved}</span>` : ""}
                  <span class="meta">${starsHTML(p.stars)}${p.votes ? ` <span class="muted">(${p.votes})</span>` : ""}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${p.font ? ` · Font ${esc(p.font)}` : ""}${p.videos?.length ? ` · <span class="vids">${ICON.play}${p.videos.length}</span>` : ""}</span>
                </span>
                ${gradeHTML(p)}
              </button>
              <div class="more">
                <div class="acts">
                  <button class="pill" data-act="save" data-pid="${p.id}"></button>
                  <button class="pill" data-act="dl" data-pid="${p.id}"></button>
                  ${navigator.share ? `<button class="pill" data-act="share" data-pid="${p.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Share</span></button>` : ""}
                </div>
                ${p.where ? `<p><b>Where:</b> ${esc(p.where)}</p>` : ""}
                ${p.fa ? `<p><b>FA:</b> ${esc(p.fa)}</p>` : ""}
                ${videoHTML(p)}
                <p><a href="${esc(p.url)}" target="_blank" rel="noopener">Full beta, photos & comments on Mountain Project ↗</a></p>
              </div>
            </li>`).join("")}
        </ol>
        <p class="approach"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)} on Mountain Project ↗</a> · <a href="https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=w" target="_blank" rel="noopener">Walk here (Apple)</a> · <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking" target="_blank" rel="noopener">Google</a></p>
      </div>`;
    $$("#detail [data-act=save]").forEach((btn) => paintSave(btn, +btn.dataset.pid));
    $$("#detail [data-act=dl]").forEach((btn) => paintDl(btn, +btn.dataset.pid));
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
    w.innerHTML = `<svg class="arrow" viewBox="0 0 30 30" data-brg="${brg}"><circle cx="15" cy="15" r="14" fill="#fff"/><path d="M15 4 22 23 15 19 8 23Z" fill="#1d6fd1"/></svg><span>${d < 15 ? "<b>You’re here</b> (within GPS accuracy)" : `<b>${fmtDist(d)}</b> ${compass(brg)} of you${state.heading == null ? "" : " · arrow points the way"}`}${state.me.acc > 25 ? ` <span class="muted">· GPS ±${fmtDist(state.me.acc)}</span>` : ""}</span>`;
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
    $("#art .scroll").innerHTML = boulderSVG(B[state.sel], { hl: pid });
    scrollArtTo(pid);
    if (scroll) {
      const li = $(`#detail .plist li[data-pid="${pid}"]`);
      li && li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    updateWhere();
  }

  // ------------------------------------------------------------------ downloads (offline beta)
  // A downloaded climb keeps everything needed at the boulder with no signal: its facts, location
  // note, drawing and map position (all in the region file, which is always cached), plus its beta
  // video list with thumbnails. Videos themselves stream from YouTube/Vimeo, which don't allow
  // saving them outside their own apps.
  async function cacheRegion() {
    if (!("caches" in window)) return false;
    try {
      const c = await caches.open("atlas-data");
      if (!(await c.match(REG_FILE))) await c.add(REG_FILE);
      return true;
    } catch { return false; }
  }
  async function downloadProblems(ids) {
    if (!("caches" in window)) { toast("This browser can’t save climbs for offline use."); return; }
    const c = await caches.open("atlas-dl");
    let fails = 0;
    await cacheRegion();
    for (const id of ids) {
      const p = P[id];
      if (!p) continue;
      const urls = (p.videos || []).filter((v) => v.y).map((v) => `https://i.ytimg.com/vi/${v.y}/mqdefault.jpg`);
      await Promise.all(urls.map(async (u) => {
        if (await c.match(u)) return;
        try { await c.put(u, await fetch(u, { mode: "no-cors" })); } catch { fails++; }
      }));
      downloaded.add(id);
    }
    store.set("downloaded", [...downloaded]);
    persistStorage();
    if (fails && !navigator.onLine) toast("Saved the climb info. Video thumbnails will download next time you have signal.");
  }
  async function removeDownload(id) {
    downloaded.delete(id);
    store.set("downloaded", [...downloaded]);
    try {
      const c = await caches.open("atlas-dl");
      await Promise.all((P[id].videos || []).filter((v) => v.y).map((v) => c.delete(`https://i.ytimg.com/vi/${v.y}/mqdefault.jpg`)));
    } catch { /* ignore */ }
  }
  let persisted = null;
  async function persistStorage() {
    try { if (navigator.storage?.persist) persisted = await navigator.storage.persist(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ offline panel
  let installPrompt = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  async function renderOffline() {
    const el = $("#offline .body");
    const regionSaved = "caches" in window && !!(await caches.match(REG_FILE).catch(() => null));
    let usage = "";
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) usage = `${(est.usage / 1048576).toFixed(1)} MB used on this device`;
    } catch { /* ignore */ }
    try { if (navigator.storage?.persisted) persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
    const install = standalone()
      ? `<p class="ok">${ICON.done} Installed on this device.</p>`
      : installPrompt
        ? `<button class="pill solid" data-act="install">${ICON.dl}<span>Install app</span></button><p class="muted">Installs like an app: opens full screen and keeps your offline data.</p>`
        : isIOS()
          ? `<p><b>On iPhone:</b> tap <b>Share</b> <svg class="inl" viewBox="0 0 24 24"><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> then <b>Add to Home Screen</b>. Home Screen apps keep their offline data; Safari can clear it for sites you haven’t opened in a while.</p>`
          : `<p class="muted">In your browser menu, choose <b>Install</b> or <b>Add to Home Screen</b> to use it like an app.</p>`;
    el.innerHTML = `
      <div class="ostat ${regionSaved ? "ok" : ""}">${regionSaved ? ICON.done : ICON.dl}<div><b>${esc(REG.name)} ${regionSaved ? "is saved on this device" : "isn’t saved yet"}</b><span>${REG.problems.length.toLocaleString()} problems on ${REG.boulders.length.toLocaleString()} boulders across ${REG.areas.length} areas${usage ? ` · ${usage}` : ""}</span></div></div>
      ${regionSaved ? "" : `<button class="pill solid" data-act="save-region">${ICON.dl}<span>Save ${esc(REG.name)} for offline</span></button>`}
      <div class="ogrid">
        <div><b>Works with no signal</b><ul><li>Trail map &amp; every boulder</li><li>All problems, grades &amp; notes</li><li>Boulder drawings</li><li>Your GPS location (needs no data)</li><li>Saved &amp; downloaded climbs</li></ul></div>
        <div><b>Needs signal</b><ul><li>Satellite view</li><li>Playing beta videos</li><li>Syncing saved climbs</li></ul></div>
      </div>
      <p><b>${plural(downloaded.size, "climb")} downloaded</b> with beta video lists for offline.${persisted ? " Storage is protected from automatic cleanup." : ""}</p>
      <h4>Use it like an app</h4>
      ${install}
      <p class="muted">Open this page once with signal (Wi-Fi or cell). After that it opens and works at the boulders with no connection.</p>`;
  }
  function openOffline() {
    $("#offline").hidden = false;
    renderOffline();
    persistStorage();
  }

  // ------------------------------------------------------------------ routing (#b/123, #p/456)
  let inApp = false;
  function go(route) {
    inApp = true;
    if (location.hash.slice(1) === route) route_(); else location.hash = route;
  }
  function route_() {
    const [kind, idStr] = location.hash.slice(1).split("/");
    const id = +idStr;
    if (kind === "p" && P[id]) openBoulder(P[id].boulder, id);
    else if (kind === "b" && B[id]) openBoulder(id, null);
    else closeDetail();
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
    highlight();
    if (!isDesktop() && sheet.dataset.snap !== "full") setSnap("half");
    const b = B[bid];
    focus([b.lat, b.lon]);
  }
  function closeDetail() {
    state.sel = null;
    state.selP = null;
    $("#detail").hidden = true;
    $("#listview").hidden = false;
    highlight();
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
      sheet.style.transform = `translateY(${clamp(startT + dy, 0, sheet.offsetHeight - 120)}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove("dragging");
      const t = curT();
      sheet.style.transform = "";
      if (!moved) { setSnap(SNAPS[(SNAPS.indexOf(sheet.dataset.snap) + 1) % 3]); return; }
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
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSnap(SNAPS[(SNAPS.indexOf(sheet.dataset.snap) + 1) % 3]); }
    });
  }

  // ------------------------------------------------------------------ toast + online state
  let toastT;
  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), ms);
  }
  function onNet() {
    const off = !navigator.onLine;
    $("#netstatus").hidden = !off;
    if (off && map && map.hasLayer(satLayer)) { toggleSat(false); toast("No signal: switched to the trail map, which works offline."); }
  }

  // ------------------------------------------------------------------ account (filled in by auth.js)
  function setUser(u) {
    state.user = u;
    const btn = $("#btn-account");
    if (!window.AtlasAuth) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.classList.toggle("in", !!u);
    btn.innerHTML = u
      ? (u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="ini">${esc((u.name || u.email || "?")[0].toUpperCase())}</span>`)
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Sign in</span>`;
    btn.title = u ? `Signed in as ${u.email || u.name}` : "Sign in with Google";
    if (state.tab === "saved") renderList();
  }
  function accountMenu() {
    const m = $("#acctmenu");
    if (!state.user) { window.AtlasAuth?.signIn(); return; }
    m.hidden = !m.hidden;
    m.innerHTML = `<p><b>${esc(state.user.name || "")}</b><br><span class="muted">${esc(state.user.email || "")}</span></p><p class="muted">${plural(saved.size, "saved climb")}, synced across your devices.</p><button class="pill" data-act="signout">Sign out</button>`;
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
    $("#area").addEventListener("change", (e) => openArea(e.target.value));
    $("#list").addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      if (act?.dataset.act === "signin") return window.AtlasAuth?.signIn();
      if (act?.dataset.act === "dl-saved") {
        act.disabled = true;
        await downloadProblems([...saved.keys()]);
        toast(`Downloaded ${plural(saved.size, "saved climb")} for offline.`);
        return renderList();
      }
      const it = e.target.closest("[data-go]");
      if (it) go(it.dataset.go);
    });
    $("#detail").addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      const a = act?.dataset.act;
      if (a === "back") return back();
      if (a === "locate") return startLocate(true);
      if (a === "save") {
        const pid = +act.dataset.pid;
        setSaved(pid, !saved.has(pid));
        if (saved.has(pid) && !state.user && window.AtlasAuth && !store.get("hintedSignin", false)) {
          store.set("hintedSignin", true);
          toast("Saved on this device. Sign in with Google to keep saved climbs on all your devices.", 5000);
        }
        return;
      }
      if (a === "dl") {
        const pid = +act.dataset.pid;
        if (downloaded.has(pid)) { await removeDownload(pid); paintDl(act, pid); return; }
        act.classList.add("busy");
        await downloadProblems([pid]);
        act.classList.remove("busy");
        paintDl(act, pid);
        if (!saved.has(pid)) setSaved(pid, true);
        toast("Downloaded: this climb, its beta notes and video list work offline.");
        return;
      }
      if (a === "share") {
        const p = P[+act.dataset.pid];
        navigator.share?.({ title: `${p.name} (${p.grade})`, text: `${p.name} ${p.grade} · ${B[p.boulder].name}, ${A[B[p.boulder].area]?.name}`, url: `${location.origin}${location.pathname}#p/${p.id}` }).catch(() => {});
        return;
      }
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
    $("#btn-fit").addEventListener("click", () => (state.area !== "all" ? fitArea(state.area) : fitRegion()));
    $("#btn-offline").addEventListener("click", openOffline);
    $("#btn-account").addEventListener("click", accountMenu);
    $("#acctmenu").addEventListener("click", (e) => {
      if (e.target.closest("[data-act=signout]")) { window.AtlasAuth?.signOut(); $("#acctmenu").hidden = true; }
    });
    $("#offline").addEventListener("click", async (e) => {
      const a = e.target.closest("[data-act]")?.dataset.act;
      if (e.target.id === "offline" || a === "close") { $("#offline").hidden = true; return; }
      if (a === "install" && installPrompt) { installPrompt.prompt(); installPrompt = null; setTimeout(renderOffline, 1500); }
      if (a === "save-region") { await cacheRegion(); persistStorage(); renderOffline(); }
    });
    addEventListener("hashchange", route_);
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#offline").hidden) $("#offline").hidden = true;
        else if (state.sel) back();
      }
    });
    addEventListener("online", onNet);
    addEventListener("offline", onNet);
  }

  let REG_FILE = "";
  async function main() {
    const idx = await (await fetch("data/regions.json")).json();
    const region = idx.regions.find((r) => r.id === store.get("region", idx.regions[0].id)) || idx.regions[0];
    REG_FILE = `data/${region.file}`;
    REG = await (await fetch(REG_FILE)).json();
    REG.problems.forEach((p) => (P[p.id] = p));
    REG.boulders.forEach((b) => (B[b.id] = b));
    REG.areas.forEach((a) => (A[a.id] = a));
    REG.problems = REG.problems.filter((p) => B[p.boulder]);
    for (const id of [...saved.keys()]) if (!P[id]) saved.delete(id);
    $("#gen").textContent = new Date(REG.generated + "T12:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
    $("#subtitle").textContent = `${REG.name}, ${REG.place.split(",")[0]} · ${REG.problems.length.toLocaleString()} problems`;
    document.title = `Boulder Atlas · ${REG.name}`;
    renderChips();
    renderAreaSelect();
    bind();
    initSheet();
    initMap();
    window.__atlas = { map, state, REG };
    renderList();
    route_();
    onNet();
    startLocate(false);
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").then(() => cacheRegion()).catch(() => {});
    }
  }

  // Public hooks for auth.js (Google sign-in + synced saved climbs).
  window.Atlas = {
    bus,
    get saved() { return Object.fromEntries(saved); },
    replaceSaved,
    setUser,
    toast,
    ready: null,
  };
  window.Atlas.ready = main().catch((err) => {
    console.error(err);
    toast("Couldn’t load the boulder data. Check your connection and reload.", 10000);
  });
})();
