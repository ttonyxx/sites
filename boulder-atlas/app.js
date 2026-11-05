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

  // iPhone home-screen apps (translucent status bar) draw under the clock, but iOS sizes the viewport
  // one status bar shorter than the screen and clips fixed-position layers to it, leaving an empty
  // band at the bottom. iOS still paints the page itself to the real bottom, so in that mode the page
  // is sized to the full screen (100vh) and the map, sheet and dialogs are laid out inside it (see
  // html.ios-gap in style.css). iOS settles the viewport a moment after launch, so this re-checks on
  // resize and shortly after load. Once on it stays on: with the page full height, iOS reports the
  // full viewport, and switching back would bring the band back.
  function checkIosGap() {
    const root = document.documentElement;
    if (root.classList.contains("ios-gap")) return;
    const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    if (!standalone) return;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const safeTop = probe.offsetHeight;
    probe.remove();
    const full = innerHeight >= innerWidth ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const gap = safeTop > 0 ? Math.round(full - innerHeight) : 0;
    if (gap > 0 && gap < 120) {
      root.classList.add("ios-gap");
      if (window.__atlas?.map) setTimeout(() => window.__atlas.map.invalidateSize(), 50);
    }
  }
  checkIosGap();
  addEventListener("resize", checkIosGap);
  addEventListener("load", () => setTimeout(checkIosGap, 60));
  setTimeout(checkIosGap, 500);
  setTimeout(checkIosGap, 1500);
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
  const votesHTML = (n) => (n ? `<span class="votes" title="${n.toLocaleString()} rating${n === 1 ? "" : "s"} on Mountain Project">(${n.toLocaleString()})</span>` : "");
  // A boulder's rating: its problems' stars averaged by how many people rated each, plus the total.
  const ratingCache = new Map();
  function boulderRating(b) {
    if (ratingCache.has(b.id)) return ratingCache.get(b.id);
    let votes = 0, sum = 0;
    for (const id of b.problems) {
      const p = P[id];
      if (p && p.votes && p.stars != null) { votes += p.votes; sum += p.stars * p.votes; }
    }
    const r = { votes, stars: votes ? sum / votes : null };
    ratingCache.set(b.id, r);
    return r;
  }
  const ICON = {
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    saved: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
    dl: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    done: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`,
    list: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="4.5" cy="6" r="1.6" fill="currentColor"/><circle cx="4.5" cy="12" r="1.6" fill="currentColor"/><circle cx="4.5" cy="18" r="1.6" fill="currentColor"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    map: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
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
    listView: null, // { id } for one of your lists, or { shared: { name, pids } } for a shared link
    listBoulders: null, // boulders of the open list (the map dims everything else)
  };
  // Saved climbs: problem id -> time saved. Synced to the account when signed in (auth.js).
  const saved = new Map(Object.entries(store.get("saved", {})).map(([k, v]) => [+k, v]));
  const downloaded = new Set(store.get("downloaded", []));
  const bus = new EventTarget();

  // Lists. "Saved" (the `saved` map above) is the default list; these are your own.
  // id -> { name, items: {problemId: addedAt}, updated }
  const LIST_SAVED = "saved";
  const lists = new Map(Object.entries(store.get("lists", {})).filter(([, v]) => v && v.name));
  const persistLists = () => store.set("lists", Object.fromEntries(lists));
  const listName = (id) => (id === LIST_SAVED ? "Saved" : lists.get(id)?.name ?? "List");
  function listPids(id) {
    const ids = id === LIST_SAVED ? [...saved.keys()] : Object.keys(lists.get(id)?.items || {}).map(Number);
    return ids.filter((p) => P[p]);
  }
  const inList = (id, pid) => (id === LIST_SAVED ? saved.has(pid) : !!lists.get(id)?.items?.[pid]);
  const emitList = (id) => bus.dispatchEvent(new CustomEvent("lists", { detail: { id, data: lists.get(id) || null } }));
  function createList(name, pids = []) {
    const id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = Date.now();
    lists.set(id, { name: name.trim().slice(0, 60) || "My list", items: Object.fromEntries(pids.map((p) => [p, now])), updated: now });
    persistLists();
    emitList(id);
    refreshSavedUI();
    refreshMarks();
    return id;
  }
  function setInList(id, pid, on) {
    if (id === LIST_SAVED) return setSaved(pid, on);
    const l = lists.get(id);
    if (!l) return;
    if (on) l.items[pid] = l.items[pid] || Date.now();
    else delete l.items[pid];
    l.updated = Date.now();
    persistLists();
    emitList(id);
    refreshSavedUI();
    refreshMarks(pid);
  }
  function renameList(id, name) {
    const l = lists.get(id);
    if (!l || !name.trim()) return;
    l.name = name.trim().slice(0, 60);
    l.updated = Date.now();
    persistLists();
    emitList(id);
    refreshSavedUI();
  }
  function deleteList(id) {
    lists.delete(id);
    persistLists();
    emitList(id);
    refreshSavedUI();
    refreshMarks();
  }
  // Marks shown next to a climb's name: in Saved (gold), in your lists (blue), downloaded (green).
  const listsWith = (pid) => [...lists.keys()].filter((id) => lists.get(id).items?.[pid]);
  function marksHTML(pid) {
    const ls = listsWith(pid);
    let h = "";
    if (saved.has(pid)) h += `<span class="mark saved" title="In Saved">${ICON.saved}</span>`;
    if (ls.length) h += `<span class="mark inlist" title="In ${esc(ls.map(listName).join(", "))}">${ICON.list}${ls.length > 1 ? `<b>${ls.length}</b>` : ""}</span>`;
    if (downloaded.has(pid)) h += `<span class="mark dl" title="Downloaded">${ICON.done}</span>`;
    return h;
  }
  const keptClass = (pid) => (saved.has(pid) ? "kept-saved" : listsWith(pid).length ? "kept-list" : "");
  // Update marks already on screen (rows and the open boulder) without re-rendering the list.
  function refreshMarks(pid) {
    $$(pid == null ? "[data-marks]" : `[data-marks="${pid}"]`).forEach((el) => {
      const id = +el.dataset.marks;
      el.innerHTML = marksHTML(id);
      const li = el.closest("li");
      if (li) {
        li.classList.toggle("kept-saved", keptClass(id) === "kept-saved");
        li.classList.toggle("kept-list", keptClass(id) === "kept-list");
      }
    });
  }
  function replaceLists(map) {
    lists.clear();
    for (const [k, v] of Object.entries(map || {})) if (v && v.name) lists.set(k, { name: v.name, items: v.items || {}, updated: v.updated || 0 });
    persistLists();
    refreshSavedUI();
    refreshMarks();
  }

  function setSaved(pid, on, { silent = false } = {}) {
    if (on) saved.set(pid, saved.get(pid) || Date.now());
    else saved.delete(pid);
    store.set("saved", Object.fromEntries(saved));
    if (!silent) bus.dispatchEvent(new CustomEvent("saved", { detail: { pid, on } }));
    refreshSavedUI();
    refreshMarks(pid);
  }
  function replaceSaved(map) {
    saved.clear();
    for (const [k, v] of Object.entries(map || {})) if (P[+k]) saved.set(+k, v);
    store.set("saved", Object.fromEntries(saved));
    refreshSavedUI();
    refreshMarks();
  }
  function refreshSavedUI() {
    $("#n-lists").textContent = lists.size + 1;
    if (state.listView) renderListPane();
    else if (state.tab === "lists") renderList();
    if (state.sel) {
      $$("#detail [data-act=save]").forEach((b) => paintSave(b, +b.dataset.pid));
      $$("#detail [data-act=addlist]").forEach((b) => paintAddList(b, +b.dataset.pid));
    }
    $$("#detail .inpick:not([hidden])").forEach((el) => { if (!el.contains(document.activeElement)) renderInlinePicker(el); });
  }
  function paintAddList(btn, pid) {
    const n = [...lists.keys()].filter((id) => inList(id, pid)).length;
    btn.classList.toggle("on", n > 0);
    btn.innerHTML = `${ICON.list}<span>${n ? `In ${plural(n, "list")}` : "Add to list"}</span>`;
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
        for (let k = 0; k < Math.min(14, Math.round(w / 6) + 1); k++) {
          const sx = g.x0 + r() * w, sy = g.H * (0.5 + r() * 0.5);
          t += `<path d="M${sx * S},${-sy * S} q${(r() - 0.5) * 20},${g.H * S * 0.25} ${(r() - 0.5) * 30},${g.H * S * (0.3 + r() * 0.4)}" stroke="#7d5f40" stroke-opacity=".22" stroke-width="${6 + r() * 10}" fill="none" stroke-linecap="round"/>`;
        }
        for (let k = 0; k < Math.min(160, w * g.H * 0.35); k++) {
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
  let map, satLayer, pathRenderer, boulderRenderer;
  const polys = {}, dots = {}, labels = {}, areaMarkers = {}, pathLayers = [];
  // Performance: paths and boulder shapes are drawn on canvas (cheap to pan and zoom on phones), and
  // the HTML markers (dots, names) only exist for boulders near the screen (see syncMarkers).
  const shown = { dots: new Set(), labels: new Set() };
  const polyKey = {};
  let visSet = null;
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
    map = L.map(mapEl, { zoomControl: false, maxZoom: 21, minZoom: 8, zoomSnap: 0.25, wheelPxPerZoomLevel: 90, doubleClickZoom: true });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Paths © <a href="https://www.openstreetmap.org/copyright">OSM</a> · Data: <a href="https://www.mountainproject.com">Mountain Project</a>');
    satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    });
    [["paths", 405], ["boulders", 420], ["dots", 610], ["labels", 620], ["areas", 630], ["pins", 635], ["me", 640]].forEach(([n, z]) => {
      map.createPane(n).style.zIndex = z;
    });
    map.getPane("labels").style.pointerEvents = "none";
    pathRenderer = L.canvas({ pane: "paths", padding: 0.3 });
    boulderRenderer = L.canvas({ pane: "boulders", padding: 0.3, tolerance: 6 });

    const order = { hwy: 0, road: 1, track: 2, trail: 3 };
    [...REG.paths].sort((a, b) => order[a.k] - order[b.k]).forEach((p) => {
      const styles = PATH[p.k] || PATH.trail;
      styles.forEach((st, i) => {
        const line = L.polyline(p.c, { ...st, pane: "paths", renderer: pathRenderer, interactive: false, lineCap: "round", lineJoin: "round", smoothFactor: 1.5 }).addTo(map);
        pathLayers.push({ line, kind: p.k, i });
      });
    });

    REG.boulders.forEach((b) => {
      polys[b.id] = L.polygon(footprint(b), { pane: "boulders", renderer: boulderRenderer, ...POLY.simple, bubblingMouseEvents: false })
        .on("click", () => go(`b/${b.id}`)).addTo(map);
    });
    REG.areas.forEach((a) => {
      areaMarkers[a.id] = L.marker([a.lat, a.lon], {
        pane: "areas", keyboard: false,
        icon: L.divIcon({ className: "alabel", iconSize: [0, 0], html: `<button type="button"><b>${esc(a.name)}</b><span>${a.problems.toLocaleString()}</span></button>` }),
      }).on("click", () => openArea(a.id)).addTo(map);
    });

    map.on("zoomend", onZoom);
    map.on("moveend", () => {
      syncMarkers();
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
    syncMarkers();
  }

  // Dots (zoomed out) and names (zoomed in) are HTML, so only boulders near the screen get them.
  function dotFor(b) {
    return dots[b.id] || (dots[b.id] = L.marker([b.lat, b.lon], {
      pane: "dots", keyboard: false, title: b.name,
      icon: L.divIcon({ className: "bdot", iconSize: [12, 12] }),
    }).on("click", () => go(`b/${b.id}`)));
  }
  function labelFor(b) {
    if (labels[b.id]) return labels[b.id];
    const south = Math.min(...footprint(b).map((p) => p[0]));
    return (labels[b.id] = L.marker([south, b.lon], {
      pane: "labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "blabel", iconSize: [0, 0], html: `<span>${esc(b.name)} <i>${b.problems.length}</i></span>` }),
    }));
  }
  function paintMarker(m, b) {
    const el = m.getElement();
    if (!el) return;
    el.classList.toggle("dim", !!visSet && !visSet.has(b.id));
    el.classList.toggle("sel", b.id === state.sel);
  }
  function setShown(kind, b, on) {
    const set = shown[kind];
    if (on) {
      const m = kind === "dots" ? dotFor(b) : labelFor(b);
      if (!set.has(b.id)) { m.addTo(map); set.add(b.id); }
      paintMarker(m, b);
      const sel = b.id === state.sel;
      if (kind === "dots" && m._atlasSel !== sel) { m.setZIndexOffset(sel ? 1000 : 0); m._atlasSel = sel; }
    } else if (set.has(b.id)) {
      (kind === "dots" ? dots : labels)[b.id].remove();
      set.delete(b.id);
    }
  }
  function syncMarkers() {
    if (!map || !REG || !map._loaded) return; // nothing to place until the map has a view
    const z = map.getZoom();
    const view = map.getBounds().pad(0.4);
    const dotsOn = z >= 12.75 && z < 17.75, labelsOn = z >= 18.25;
    for (const b of REG.boulders) {
      const near = (dotsOn || labelsOn) && view.contains([b.lat, b.lon]);
      const sel = b.id === state.sel;
      setShown("dots", b, (dotsOn && near) || (sel && z < 17.75));
      setShown("labels", b, (labelsOn && near) || (sel && z >= 14.75));
    }
    declutterLabels();
  }
  // Boulder names: when two would overlap, keep the selected boulder's, then the one with more problems.
  function declutterLabels() {
    if (!shown.labels.size) return;
    const items = [...shown.labels].map((id) => B[id]);
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
  function padTL() { return isDesktop() ? [$("#sheet").offsetWidth + 40, 30] : [20, ($(".brand")?.getBoundingClientRect().bottom ?? 70) + 14]; }
  function padBR() { return isDesktop() ? [70, 30] : [60, sheetCover() + 10]; }
  function sheetCover() {
    const snap = $("#sheet").dataset.snap;
    if (snap === "full") return innerHeight;
    if (snap === "half") return innerHeight * 0.52; // the snap it is heading to, even mid-animation
    return Math.max(0, innerHeight - $("#sheet").getBoundingClientRect().top);
  }
  function focus(latlng, zoom) {
    const z = zoom ?? Math.max(map.getZoom(), 18.5);
    const px = map.project(latlng, z);
    if (isDesktop()) px.x -= ($("#sheet").offsetWidth + 12) / 2;
    else px.y += Math.min(innerHeight * 0.52, innerHeight * 0.6) / 2 - 20;
    const target = map.unproject(px, z);
    const dz = Math.abs(z - map.getZoom());
    // Short hops glide (pan, or one smooth zoom); only long trips use the fly-over arc.
    if (dz < 0.01 && map.getBounds().pad(0.5).contains(latlng)) map.panTo(target, { animate: true, duration: 0.45, easeLinearity: 0.25 });
    else if (dz <= 2 && map.getBounds().contains(latlng)) map.setView(target, z, { animate: true });
    else map.flyTo(target, z, { duration: 0.6 });
  }
  // Is this spot clearly visible: on the map, below the header card and above the sheet?
  function inMapView(ll) {
    const p = map.latLngToContainerPoint(ll), size = map.getSize();
    if (isDesktop()) return p.x > $("#sheet").getBoundingClientRect().right + 20 && p.x < size.x - 70 && p.y > 40 && p.y < size.y - 30;
    const top = ($(".brand")?.getBoundingClientRect().bottom ?? 70) + 46; // + room for a numbered pin
    return p.x > 24 && p.x < size.x - 24 && p.y > top && p.y < size.y - sheetCover() - 24;
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

  // Only restyle shapes whose state changed (dimmed / selected / satellite), then refresh markers.
  function highlight() {
    if (!map) return;
    visSet = state.listBoulders || new Set(filteredBoulders().map((x) => x.b.id));
    const sat = isSat();
    for (const b of REG.boulders) {
      const dim = !visSet.has(b.id), sel = b.id === state.sel;
      const key = (dim ? 1 : 0) | (sel ? 2 : 0) | (sat ? 4 : 0);
      if (polyKey[b.id] !== key) {
        polys[b.id].setStyle(polyStyle(b.id, dim));
        if (sel) polys[b.id].bringToFront();
        polyKey[b.id] = key;
      }
    }
    syncMarkers();
    for (const [aid, m] of Object.entries(areaMarkers)) m.getElement()?.classList.toggle("sel", aid === state.area);
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
      meCircle = L.circle(ll, { radius: acc, color: "#1d6fd1", weight: 1, fillOpacity: 0.1, interactive: false, pane: "paths", renderer: pathRenderer }).addTo(map);
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
      if (state.sort === "near" && $("#list").scrollTop < 40 && !state.sel && !state.listView) renderList();
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
    votes: (a, b) => (b.votes || 0) - (a.votes || 0) || (b.stars ?? 0) - (a.stars ?? 0),
    name: (a, b) => a.name.localeCompare(b.name),
    near: (a, b) => distM(state.me, ploc(a)) - distM(state.me, ploc(b)),
    recent: (a, b) => (saved.get(b.id) || 0) - (saved.get(a.id) || 0),
  });
  function problemRow(p) {
    const b = B[p.boulder];
    const nv = p.videos?.length || 0;
    const where = state.area === "all" ? `${esc(b.name)} · ${esc(A[b.area]?.name ?? "")}` : esc(b.name);
    return `<li class="${keptClass(p.id)}"><button class="item" data-go="p/${p.id}">${gradeHTML(p)}<span class="main"><span class="name">${esc(p.name)}${safetyHTML(p)}<span class="marks" data-marks="${p.id}">${marksHTML(p.id)}</span></span><span class="meta">${starsHTML(p.stars)}${votesHTML(p.votes)}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${nv ? ` · <span class="vids">${ICON.play}${nv}</span>` : ""} · ${where}</span></span>${distCell(ploc(p))}</button></li>`;
  }
  function renderList() {
    if (!REG) return;
    const list = $("#list");
    const sort = state.sort === "near" && !state.me ? "grade" : state.sort;
    let html = "";
    const nP = filteredProblems(), nB = filteredBoulders();
    $("#n-problems").textContent = nP.length.toLocaleString();
    $("#n-boulders").textContent = nB.length.toLocaleString();
    $("#n-lists").textContent = lists.size + 1;
    $("#filters").hidden = state.tab === "lists";
    if (state.tab === "problems") {
      nP.sort(problemSorts()[sort]);
      if (!nP.length) list.innerHTML = `<li class="empty">No problems match. Try clearing filters.</li>`;
      else pageRows(nP, problemRow);
      highlight();
      return;
    } else if (state.tab === "boulders") {
      const lo = (x) => Math.min(...x.ps.map((p) => p.g ?? 0), 99);
      const cmp = {
        grade: (a, b) => lo(a) - lo(b) || b.ps.length - a.ps.length,
        stars: (a, b) => Math.max(0, ...b.ps.map((p) => p.stars ?? 0)) - Math.max(0, ...a.ps.map((p) => p.stars ?? 0)) || boulderRating(b.b).votes - boulderRating(a.b).votes,
        votes: (a, b) => boulderRating(b.b).votes - boulderRating(a.b).votes,
        name: (a, b) => a.b.name.localeCompare(b.b.name),
        near: (a, b) => distM(state.me, a.b) - distM(state.me, b.b),
      }[sort];
      nB.sort(cmp);
      if (!nB.length) list.innerHTML = `<li class="empty">No boulders match.</li>`;
      else pageRows(nB, boulderRow);
      highlight();
      return;
    } else {
      const ids = [LIST_SAVED, ...[...lists.keys()].sort((a, b) => (lists.get(b).updated || 0) - (lists.get(a).updated || 0))];
      html = `<li class="lhead"><div><b>Your lists</b><span class="muted">Open a list to see its boulders on the map.</span></div><button class="pill" data-act="new-list">${ICON.plus}<span>New list</span></button></li>` +
        ids.map((id) => {
          const pids = listPids(id);
          const areas = [...new Set(pids.map((p) => A[B[P[p].boulder].area]?.name).filter(Boolean))];
          const nB = new Set(pids.map((p) => P[p].boulder)).size;
          const allDl = pids.length && pids.every((p) => downloaded.has(p));
          const meta = pids.length
            ? `${plural(pids.length, "climb")} on ${plural(nB, "boulder")}${areas.length ? ` · ${esc(areas.slice(0, 2).join(", "))}${areas.length > 2 ? "…" : ""}` : ""}`
            : id === LIST_SAVED ? "Tap Save on any problem to add it here" : "Empty: add climbs from any problem";
          return `<li><button class="item" data-go="list/${id}"><span class="licon${id === LIST_SAVED ? " saved" : ""}">${id === LIST_SAVED ? ICON.saved : ICON.list}</span><span class="main"><span class="name">${esc(listName(id))}${allDl ? `<span class="mark dl" title="Downloaded">${ICON.done}</span>` : ""}</span><span class="meta">${meta}</span></span><span class="chev" aria-hidden="true">›</span></button></li>`;
        }).join("") +
        `<li class="savedhead"><div class="sync">${state.user ? `Your lists sync to ${esc(state.user.email || state.user.name)}.` : window.AtlasAuth ? `<button class="link" data-act="signin">Sign in with Google</button> to keep your lists on every device.` : "Lists are kept on this device."} Sharing a list creates a link anyone can open, no account needed.</div></li>`;
    }
    pageFn = null;
    list.innerHTML = html;
    highlight();
  }

  function boulderRow({ b, ps }) {
    const all = b.problems.map((id) => P[id]);
    const gs = all.map((p) => p.g).filter((g) => g != null);
    const lo = all.find((p) => p.g === Math.min(...gs)), hi = all.find((p) => p.g === Math.max(...gs));
    const range = gs.length ? (lo === hi ? lo.grade : `${lo.grade.split(" ")[0]}–${hi.grade.split(" ")[0]}`) : "";
    const r = boulderRating(b);
    return `<li><button class="item" data-go="b/${b.id}"><span class="thumb">${boulderSVG(b, { mini: true })}</span><span class="main"><span class="name">${esc(b.name)}</span><span class="meta">${r.votes ? `${starsHTML(r.stars)}${votesHTML(r.votes)} · ` : ""}${ps.length < all.length ? `${ps.length} of ` : ""}${plural(all.length, "problem")} · ${esc(range)} · ${esc(state.area === "all" ? A[b.area]?.name : b.sector)}</span></span>${distCell(b)}</button></li>`;
  }

  // Long lists render 60 rows at a time; more are added as you scroll near the end.
  const PAGE = 60;
  let pageItems = [], pageFn = null, pageShown = 0;
  function pageRows(items, fn) {
    pageItems = items;
    pageFn = fn;
    pageShown = 0;
    $("#list").innerHTML = "";
    morePageRows();
  }
  function morePageRows() {
    if (!pageFn || pageShown >= pageItems.length) return;
    const next = pageItems.slice(pageShown, pageShown + PAGE);
    pageShown += next.length;
    $("#list").insertAdjacentHTML("beforeend", next.map(pageFn).join(""));
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
        ${p.videos?.length ? `<p class="vnote">Videos play from YouTube, so they need signal. To keep one for offline, open it in the YouTube app and tap <b>Download</b> (YouTube Premium).</p>` : ""}
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
          ${boulderRating(b).votes ? `<span>${starsHTML(boulderRating(b).stars)} <b>${boulderRating(b).votes.toLocaleString()}</b> rating${boulderRating(b).votes === 1 ? "" : "s"}</span>` : ""}
          ${gs.length ? `<span>${esc(ps.find((p) => p.g === Math.min(...gs)).grade.split(" ")[0])} – ${esc(ps.find((p) => p.g === Math.max(...gs)).grade.split(" ")[0])}</span>` : ""}
          <span>Tallest <b>${L.anyKnown ? "" : "~"}${Math.round(L.Hmax)} ft</b></span>
          ${best && best.stars ? `<span>Classic: <b>${esc(best.name)}</b></span>` : ""}
          <span>${b.outline ? "Outline traced from aerial imagery" : "Footprint estimated"}</span>
        </div>
        ${b.approach ? `<p class="approach"><b>Getting there:</b> ${esc(b.approach)}</p>` : ""}
        <ol class="plist">
          ${ps.map((p, i) => `
            <li data-pid="${p.id}" class="${p.id === state.selP ? "on" : ""} ${keptClass(p.id)}">
              <button class="prob" data-p="${p.id}">
                <span class="num" style="--c:${colorOf(p.g)}">${i + 1}</span>
                <span class="main">
                  <span class="name">${esc(p.name)}</span>${safetyHTML(p)}<span class="marks" data-marks="${p.id}">${marksHTML(p.id)}</span>
                  <span class="meta">${starsHTML(p.stars)}${votesHTML(p.votes)}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${p.font ? ` · Font ${esc(p.font)}` : ""}${p.videos?.length ? ` · <span class="vids">${ICON.play}${p.videos.length}</span>` : ""}</span>
                </span>
                ${gradeHTML(p)}
              </button>
              <div class="more"><div class="more-in">
                <div class="acts">
                  <button class="pill" data-act="save" data-pid="${p.id}"></button>
                  <button class="pill" data-act="addlist" data-pid="${p.id}"></button>
                  <button class="pill" data-act="dl" data-pid="${p.id}"></button>
                  ${navigator.share ? `<button class="pill" data-act="share" data-pid="${p.id}">${ICON.share}<span>Share</span></button>` : ""}
                </div>
                <div class="inpick" data-pid="${p.id}" hidden></div>
                ${p.where ? `<p><b>Where:</b> ${esc(p.where)}</p>` : ""}
                ${p.fa ? `<p><b>FA:</b> ${esc(p.fa)}</p>` : ""}
                ${videoHTML(p)}
                <p><a href="${esc(p.url)}" target="_blank" rel="noopener">Full beta, photos & comments on Mountain Project ↗</a></p>
              </div></div>
            </li>`).join("")}
        </ol>
        <p class="approach"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)} on Mountain Project ↗</a> · <a href="https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=w" target="_blank" rel="noopener">Walk here (Apple)</a> · <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking" target="_blank" rel="noopener">Google</a></p>
      </div>`;
    $$("#detail [data-act=save]").forEach((btn) => paintSave(btn, +btn.dataset.pid));
    $$("#detail [data-act=dl]").forEach((btn) => paintDl(btn, +btn.dataset.pid));
    $$("#detail [data-act=addlist]").forEach((btn) => paintAddList(btn, +btn.dataset.pid));
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
      if (li) scrollRowIntoView(li, scroll !== "jump");
    }
    updateWhere();
  }
  // Put a climb's row just under the boulder's sticky header. (scrollIntoView tucks a tall,
  // expanded row behind the header on iPhone.) Rows already comfortably in view stay put.
  function scrollRowIntoView(li, smooth) {
    const sc = $("#detail");
    const headH = sc.querySelector(".dhead")?.offsetHeight ?? 0;
    const top = li.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    if (top >= headH && top + 140 <= sc.clientHeight) return;
    const y = Math.max(0, sc.scrollTop + top - headH - 6);
    if (smooth) sc.scrollTo({ top: y, behavior: "smooth" });
    else sc.scrollTop = y;
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
    refreshMarks();
    persistStorage();
    if (fails && !navigator.onLine) toast("Saved the climb info. Video thumbnails will download next time you have signal.");
  }
  async function removeDownload(id) {
    downloaded.delete(id);
    store.set("downloaded", [...downloaded]);
    refreshMarks(id);
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

  // ------------------------------------------------------------------ list view: a list on the map
  // Climbs are grouped by boulder; boulders are ordered area by area as a nearest-neighbour walk, so
  // the numbered pins read like a circuit.
  let pinLayer = null;
  const currentListPids = () => (state.listView?.shared ? state.listView.shared.pids.filter((p) => P[p]) : listPids(state.listView?.id));
  function listOrder(pids) {
    const byB = new Map();
    for (const pid of pids) {
      const p = P[pid];
      if (!p) continue;
      if (!byB.has(p.boulder)) byB.set(p.boulder, []);
      byB.get(p.boulder).push(p);
    }
    const areaRank = Object.fromEntries(REG.areas.map((a, i) => [a.id, i]));
    const groups = new Map();
    for (const bid of byB.keys()) {
      const b = B[bid];
      if (!groups.has(b.area)) groups.set(b.area, []);
      groups.get(b.area).push(b);
    }
    const out = [];
    for (const aid of [...groups.keys()].sort((x, y) => areaRank[x] - areaRank[y])) {
      let rest = groups.get(aid);
      let cur = state.me ? rest.reduce((m, b) => (distM(state.me, b) < distM(state.me, m) ? b : m)) : rest.reduce((m, b) => (b.lat > m.lat ? b : m));
      while (rest.length) {
        out.push(cur);
        const from = cur;
        rest = rest.filter((b) => b !== from);
        if (!rest.length) break;
        cur = rest.reduce((m, b) => (distM(from, b) < distM(from, m) ? b : m));
      }
    }
    return out.map((b) => ({ b, ps: byB.get(b.id).sort((x, y) => x.order - y.order) }));
  }
  function drawListPins(groups) {
    if (pinLayer) pinLayer.remove();
    pinLayer = L.layerGroup();
    groups.forEach((g, i) => {
      L.marker([g.b.lat, g.b.lon], {
        pane: "pins", keyboard: false, title: g.b.name,
        icon: L.divIcon({ className: "lpin", iconSize: [0, 0], html: `<button type="button" aria-label="${i + 1}. ${esc(g.b.name)}"><b>${i + 1}</b>${g.ps.length > 1 ? `<i>×${g.ps.length}</i>` : ""}</button>` }),
      }).on("click", () => go(g.ps.length === 1 ? `p/${g.ps[0].id}` : `b/${g.b.id}`)).addTo(pinLayer);
    });
    pinLayer.addTo(map);
    mapEl.classList.add("listmode");
    state.listBoulders = new Set(groups.map((g) => g.b.id));
    highlight();
  }
  function fitList(groups) {
    if (!groups.length) return;
    const tl = padTL();
    map.fitBounds(L.latLngBounds(groups.map((g) => [g.b.lat, g.b.lon])), { paddingTopLeft: [tl[0] + 10, tl[1] + 40], paddingBottomRight: padBR(), maxZoom: 18.5 });
  }
  function clearListMode() {
    if (!$("#listpane").hidden) animatePane($("#listview"), "back");
    if (pinLayer) { pinLayer.remove(); pinLayer = null; }
    mapEl.classList.remove("listmode");
    state.listView = null;
    state.listBoulders = null;
    $("#listpane").hidden = true;
  }
  function renderListPane() {
    const v = state.listView;
    if (!v) return;
    const shared = !!v.shared;
    const own = !shared && v.id !== LIST_SAVED;
    const name = shared ? v.shared.name : listName(v.id);
    const pids = currentListPids();
    const groups = listOrder(pids);
    const nDl = pids.filter((p) => downloaded.has(p)).length;
    const areas = [...new Set(groups.map((g) => A[g.b.area]?.name).filter(Boolean))];
    $("#listpane").innerHTML = `
      <div class="dhead">
        <div class="dtop">
          <button class="back" data-act="lists-back" aria-label="Back to lists"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Lists</button>
          <h2>${esc(name)}</h2>
        </div>
        <div class="dsub">${shared ? "Shared with you · " : ""}${plural(pids.length, "climb")} on ${plural(groups.length, "boulder")}${areas.length ? ` · ${esc(areas.join(", "))}` : ""}</div>
        <div class="acts lacts">
          ${shared ? `<button class="pill solid" data-act="keep-shared">${ICON.plus}<span>Save to my lists</span></button>` : ""}
          ${groups.length ? `<button class="pill" data-act="map-list">${ICON.map}<span>Fit map</span></button>` : ""}
          ${pids.length ? `<button class="pill" data-act="share-list">${ICON.share}<span>Share</span></button>` : ""}
          ${pids.length ? `<button class="pill${nDl === pids.length ? " on dlall" : ""}" data-act="dl-list">${nDl === pids.length ? ICON.done : ICON.dl}<span>${nDl === pids.length ? "Downloaded" : "Download all"}</span></button>` : ""}
          ${own ? `<button class="pill" data-act="rename-list">Rename</button><button class="pill danger" data-act="delete-list">Delete</button>` : ""}
        </div>
      </div>
      <ol class="llist">
        ${groups.map((g, i) => `
          <li class="lb">
            <button class="lbh" data-go="b/${g.b.id}"><span class="pinno">${i + 1}</span><span class="main"><span class="name">${esc(g.b.name)}</span><span class="meta">${esc(A[g.b.area]?.name ?? "")}${g.b.sector && g.b.sector !== A[g.b.area]?.name ? ` · ${esc(g.b.sector)}` : ""}</span></span>${distCell(g.b)}</button>
            <ul>${g.ps.map((p) => `<li><button class="lp" data-go="p/${p.id}">${gradeHTML(p)}<span class="main"><span class="name">${esc(p.name)}${safetyHTML(p)}${downloaded.has(p.id) ? `<span class="mark dl" title="Downloaded">${ICON.done}</span>` : ""}</span><span class="meta">${starsHTML(p.stars)}${votesHTML(p.votes)}${p.height_ft ? ` · ${p.height_ft} ft` : ""}${p.videos?.length ? ` · <span class="vids">${ICON.play}${p.videos.length}</span>` : ""}</span></span></button>${shared ? "" : `<button class="rm" data-act="rm-from-list" data-pid="${p.id}" aria-label="Remove ${esc(p.name)} from this list">×</button>`}</li>`).join("")}</ul>
          </li>`).join("") || `<li class="empty">${v.id === LIST_SAVED ? "Nothing saved yet. Open any problem and tap <b>Save</b>." : "This list is empty. Open any problem and tap <b>Add to list</b>."}</li>`}
      </ol>`;
    drawListPins(groups);
    return groups;
  }
  function openList(view) {
    const fromDetail = !$("#detail").hidden;
    state.listView = view;
    state.sel = null;
    state.selP = null;
    $("#detail").hidden = true;
    $("#listview").hidden = true;
    $("#listpane").hidden = false;
    animatePane($("#listpane"), fromDetail ? "back" : "fwd");
    $("#listpane").scrollTop = 0;
    const groups = renderListPane();
    if (!isDesktop() && sheet.dataset.snap !== "full") setSnap("half");
    if (!fromDetail || !groups.every((g) => inMapView([g.b.lat, g.b.lon]))) requestAnimationFrame(() => fitList(groups));
  }
  function syncTabs() {
    $$(".tabs button").forEach((x, i) => {
      const on = x.dataset.tab === state.tab;
      x.setAttribute("aria-selected", on);
      if (on) $(".tabs").style.setProperty("--tab-i", i);
    });
  }
  // Slide a pane in: "fwd" from the right (opening), "back" from the left (returning), "swap" fade.
  function animatePane(el, dir) {
    el.classList.remove("enter-fwd", "enter-back", "enter-swap");
    void el.offsetWidth; // restart the animation
    el.classList.add(`enter-${dir}`);
  }
  function listsBack() {
    state.tab = "lists";
    syncTabs();
    history.replaceState(null, "", location.pathname + location.search);
    clearListMode();
    closeDetail();
    renderList();
  }

  // Sharing: the list travels inside the link (name + problem ids), so it needs no server or account.
  const b64u = {
    enc: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))),
  };
  const shareLink = (name, pids) => `${location.origin}${location.pathname}#share/${b64u.enc(name)}/${pids.map((p) => p.toString(36)).join(".")}`;
  function openShared(nameEnc, idsEnc) {
    let name = "Shared list";
    try { name = b64u.dec(nameEnc).slice(0, 60) || name; } catch { /* keep the default name */ }
    const pids = [...new Set(idsEnc.split(".").map((x) => parseInt(x, 36)))].filter((p) => P[p]);
    openList({ shared: { name, pids } });
  }
  async function shareList(name, pids) {
    const url = shareLink(name, pids);
    if (navigator.share) {
      try { await navigator.share({ title: `${name} · Boulder Atlas`, text: `${name}: ${plural(pids.length, "climb")} in ${REG.name}`, url }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied. Anyone can open this list with it, no account needed."); }
    catch { prompt("Copy this link to share the list:", url); }
  }

  // Picker: add a climb to lists, or name a new list.
  let pickerPid = null, pickerMode = null; // "add" | "new" | "rename"
  function openPicker(mode, pid = null) {
    pickerMode = mode;
    pickerPid = pid;
    $("#picker").hidden = false;
    renderPicker();
    if (mode !== "add") setTimeout(() => $("#picker input[type=text]")?.focus(), 60);
  }
  // Add to list: a small panel that opens right under the climb's buttons (tap again to close).
  function renderInlinePicker(el) {
    const pid = +el.dataset.pid;
    const ids = [LIST_SAVED, ...[...lists.keys()].sort((a, b) => listName(a).localeCompare(listName(b)))];
    el.innerHTML = `<ul class="pick">${ids.map((id) => `<li><label><input type="checkbox" data-list="${id}" ${inList(id, pid) ? "checked" : ""}><span>${id === LIST_SAVED ? ICON.saved : ICON.list}${esc(listName(id))}</span><span class="muted">${listPids(id).length}</span></label></li>`).join("")}</ul>
      <form class="newl"><input type="text" maxlength="60" placeholder="New list, e.g. Projects" autocomplete="off" enterkeyhint="done"><button class="pill solid" type="submit">${ICON.plus}<span>Create</span></button></form>`;
  }
  function toggleInlinePicker(pid) {
    const el = $(`#detail .inpick[data-pid="${pid}"]`);
    if (!el) return;
    const open = el.hidden;
    $$("#detail .inpick").forEach((x) => { x.hidden = true; x.innerHTML = ""; });
    $$("#detail [data-act=addlist]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (open) {
      renderInlinePicker(el);
      el.hidden = false;
      $(`#detail [data-act=addlist][data-pid="${pid}"]`)?.setAttribute("aria-expanded", "true");
    }
  }
  function renderPicker() {
    const body = $("#picker .body");
    {
      const rename = pickerMode === "rename";
      $("#picker h3").textContent = rename ? "Rename list" : "New list";
      body.innerHTML = `<form class="newl" data-act="${rename ? "rename" : "create"}"><input type="text" maxlength="60" value="${esc(rename ? listName(state.listView?.id) : "")}" placeholder="List name, e.g. Tick list" autocomplete="off" enterkeyhint="done"><button class="pill solid" type="submit">${rename ? "Rename" : `${ICON.plus}<span>Create</span>`}</button></form>`;
    }
  }

  // ------------------------------------------------------------------ routing (#b/123, #p/456)
  let inApp = false;
  function go(route) {
    inApp = true;
    const cur = location.hash.slice(1);
    if (cur === route) return route_();
    // Hopping from one boulder or climb to another replaces the history entry, so Back (and the
    // "List" button) returns to the list you came from, not to the previous boulder.
    if (/^[pb]\//.test(route) && /^[pb]\//.test(cur)) {
      history.replaceState(null, "", `#${route}`);
      route_();
    } else location.hash = route;
  }
  function route_() {
    const parts = location.hash.slice(1).split("/");
    const [kind, idStr] = parts;
    const id = +idStr;
    if (kind === "p" && P[id]) openBoulder(P[id].boulder, id);
    else if (kind === "b" && B[id]) openBoulder(id, null);
    else if (kind === "list" && (idStr === LIST_SAVED || lists.has(idStr))) openList({ id: idStr });
    else if (kind === "share" && parts.length >= 3) openShared(parts[1], parts[2]);
    else {
      if (state.listView) clearListMode();
      closeDetail();
    }
  }
  function openBoulder(bid, pid) {
    const changed = state.sel !== bid;
    const wasOpen = !$("#detail").hidden;
    state.sel = bid;
    state.selP = pid;
    $("#listview").hidden = true;
    $("#listpane").hidden = true;
    $("#detail").hidden = false;
    renderDetail();
    if (!wasOpen) animatePane($("#detail"), "fwd");
    else if (changed) animatePane($("#detail"), "swap");
    if (changed) $("#detail").scrollTop = 0;
    if (pid) selectProblem(pid, changed || !wasOpen ? "jump" : "smooth");
    highlight();
    if (!isDesktop() && sheet.dataset.snap !== "full") setSnap("half");
    const b = B[bid];
    // In a list the map keeps its zoom so the other numbered pins stay around; it only moves when
    // the boulder would be hidden (or you're zoomed far out).
    if (state.listView) {
      if (map.getZoom() < 16.5 || !inMapView([b.lat, b.lon])) focus([b.lat, b.lon], Math.max(map.getZoom(), 17));
    } else focus([b.lat, b.lon]);
  }
  function closeDetail() {
    const wasOpen = !$("#detail").hidden || !$("#listpane").hidden;
    state.sel = null;
    state.selP = null;
    $("#detail").hidden = true;
    $("#listview").hidden = false;
    if (wasOpen) animatePane($("#listview"), "back");
    highlight();
  }
  function back() {
    if (inApp && history.length > 1) history.back();
    else { history.replaceState(null, "", location.pathname + location.search); closeDetail(); }
  }

  // ------------------------------------------------------------------ bottom sheet
  const sheet = $("#sheet");
  const SNAPS = ["peek", "half", "full"];
  // "hidden" = minimized: drag the sheet down past the peek and only its handle stays on screen;
  // drag the handle back up (or tap it) to bring the list back.
  function setSnap(s) {
    sheet.dataset.snap = s;
    document.body.classList.toggle("sheet-hidden", s === "hidden");
    if (s === "hidden") $("#q").blur();
  }
  function initSheet() {
    const handle = $("#handle");
    const d = { on: false, moved: false, startY: 0, startT: 0, lastY: 0, lastT: 0, vel: 0 };
    // How much of the minimized sheet stays visible: the handle plus the home-indicator area.
    const miniPx = () => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden";
      document.body.appendChild(probe);
      const sb = probe.offsetHeight;
      probe.remove();
      return 26 + sb;
    };
    const curT = () => new DOMMatrix(getComputedStyle(sheet).transform).m42;
    const cycle = () => setSnap(sheet.dataset.snap === "hidden" ? "peek" : SNAPS[(SNAPS.indexOf(sheet.dataset.snap) + 1) % 3]);

    // One drag engine for the handle and the sheet's content.
    function begin(y) {
      Object.assign(d, { on: true, moved: false, startY: y, lastY: y, startT: curT(), lastT: performance.now(), vel: 0, max: sheet.offsetHeight - miniPx() });
      sheet.classList.add("dragging");
    }
    function move(y) {
      const dy = y - d.startY;
      if (Math.abs(dy) > 4) d.moved = true;
      const now = performance.now();
      d.vel = 0.7 * d.vel + 0.3 * ((y - d.lastY) / Math.max(1, now - d.lastT));
      d.lastY = y;
      d.lastT = now;
      sheet.style.transform = `translateY(${clamp(d.startT + dy, 0, d.max)}px)`;
    }
    function finish(tapCycles) {
      if (!d.on) return;
      d.on = false;
      sheet.classList.remove("dragging");
      const t = curT();
      sheet.style.transform = "";
      if (!d.moved) { if (tapCycles) cycle(); return; }
      const h = sheet.offsetHeight;
      const peekPx = parseFloat(getComputedStyle(sheet).getPropertyValue("--peek")) || 178;
      const pos = { hidden: h - miniPx(), peek: h - peekPx, half: h - innerHeight * 0.52, full: 0 };
      const v = performance.now() - d.lastT > 120 ? 0 : d.vel; // the finger paused before lifting
      const proj = t + v * 200; // a flick carries the sheet further
      const nearest = (list) => list.reduce((m, e) => (Math.abs(e[1] - proj) < Math.abs(m[1] - proj) ? e : m));
      const stops = Object.entries(pos).sort((a, b) => a[1] - b[1]);
      let best = nearest(stops);
      if (Math.abs(v) > 0.25) {
        // A deliberate swipe always goes on to a stop in that direction (pull down past the peek
        // and the sheet minimizes), skipping further on a strong flick.
        const ahead = v > 0 ? stops.filter(([, p]) => p > t + 8) : stops.filter(([, p]) => p < t - 8);
        if (ahead.length) best = nearest(ahead);
      }
      setSnap(best[0]);
    }

    // Handle: drag, or tap to cycle.
    handle.addEventListener("pointerdown", (e) => {
      if (isDesktop()) return;
      begin(e.clientY);
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => { if (d.on) move(e.clientY); });
    handle.addEventListener("pointerup", () => finish(true));
    handle.addEventListener("pointercancel", () => finish(false));
    handle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(); }
    });

    // Content: pulling down while scrolled to the top moves the sheet down (all the way to
    // minimized); swiping up on a sheet that isn't fully open opens it first. Sideways swipes
    // (grade chips, drawings, video rows) are left alone.
    let g = null;
    sheet.addEventListener("touchstart", (e) => {
      if (isDesktop() || e.touches.length !== 1 || e.target.closest("#handle") || d.on) { g = null; return; }
      const tt = e.touches[0];
      g = { x: tt.clientX, y: tt.clientY, scroller: e.target.closest("#list, #detail, #listpane"), decided: false, mine: false };
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (!g) return;
      const tt = e.touches[0];
      const dx = tt.clientX - g.x, dy = tt.clientY - g.y;
      if (!g.decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        g.decided = true;
        if (Math.abs(dx) > Math.abs(dy)) return;
        const atTop = !g.scroller || g.scroller.scrollTop <= 0;
        if ((dy > 0 && atTop) || (dy < 0 && sheet.dataset.snap !== "full")) {
          g.mine = true;
          if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
          begin(tt.clientY);
        }
      }
      if (g.mine && e.cancelable) { e.preventDefault(); move(tt.clientY); }
    }, { passive: false });
    const touchEnd = () => { if (g && g.mine) finish(false); g = null; };
    sheet.addEventListener("touchend", touchEnd);
    sheet.addEventListener("touchcancel", touchEnd);
  }

  // ------------------------------------------------------------------ toast + online state
  let toastT;
  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("leaving");
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      t.classList.add("leaving");
      toastT = setTimeout(() => { t.hidden = true; t.classList.remove("leaving"); }, 200);
    }, ms);
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
    if (u && !$("#acctmenu").hidden && $("#gbtn")) $("#acctmenu").hidden = true;
    if (state.tab === "lists" && !state.listView) renderList();
  }
  function accountMenu(forceOpen) {
    const m = $("#acctmenu");
    m.hidden = forceOpen ? false : !m.hidden;
    if (m.hidden) return;
    if (!state.user) {
      m.innerHTML = `<p><b>Sign in to sync your lists</b><br><span class="muted">Saved climbs and your lists follow you to every device. Downloads stay on each device.</span></p><div class="gbtn" id="gbtn"></div>`;
      window.AtlasAuth?.signIn($("#gbtn"));
      return;
    }
    m.innerHTML = `<p><b>${esc(state.user.name || "")}</b><br><span class="muted">${esc(state.user.email || "")}</span></p><p class="muted">${plural(saved.size, "saved climb")} and ${plural(lists.size, "list")}, synced across your devices.</p><button class="pill" data-act="signout">Sign out</button>`;
  }

  // ------------------------------------------------------------------ wire up
  function bind() {
    let qTimer;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderList(); $("#list").scrollTop = 0; }, 140);
    });
    $("#list").addEventListener("scroll", () => {
      const l = $("#list");
      if (l.scrollTop + l.clientHeight > l.scrollHeight - 600) morePageRows();
    }, { passive: true });
    $("#q").addEventListener("focus", () => { if (!isDesktop()) setSnap("full"); });
    $$(".tabs button").forEach((btn) => btn.addEventListener("click", () => {
      if (state.tab === btn.dataset.tab) return;
      state.tab = btn.dataset.tab;
      syncTabs();
      renderList();
      $("#list").scrollTop = 0;
      animatePane($("#list"), "swap");
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
      if (act?.dataset.act === "signin") return accountMenu(true);
      if (act?.dataset.act === "new-list") return openPicker("new");
      const it = e.target.closest("[data-go]");
      if (it) go(it.dataset.go);
    });
    $("#detail").addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      const a = act?.dataset.act;
      if (a === "back") return back();
      if (a === "locate") return startLocate(true);
      if (a === "addlist") return toggleInlinePicker(+act.dataset.pid);
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
    $("#listpane").addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]");
      const a = act?.dataset.act;
      const v = state.listView;
      if (!v) return;
      const pids = currentListPids();
      if (a === "lists-back") return listsBack();
      if (a === "map-list") return fitList(listOrder(pids));
      if (a === "share-list") return shareList(v.shared ? v.shared.name : listName(v.id), listOrder(pids).flatMap((g) => g.ps.map((p) => p.id)));
      if (a === "dl-list") {
        act.classList.add("busy");
        await downloadProblems(pids);
        toast(`Downloaded ${plural(pids.length, "climb")} for offline use.`);
        return renderListPane();
      }
      if (a === "rename-list") return openPicker("rename");
      if (a === "delete-list") {
        if (confirm(`Delete “${listName(v.id)}”? The climbs stay in Boulder Atlas.`)) { deleteList(v.id); listsBack(); }
        return;
      }
      if (a === "rm-from-list") return setInList(v.id, +act.dataset.pid, false);
      if (a === "keep-shared") {
        const id = createList(v.shared.name, pids);
        toast(`Saved “${v.shared.name}” to your lists.`);
        history.replaceState(null, "", `#list/${id}`);
        return openList({ id });
      }
      const it = e.target.closest("[data-go]");
      if (it) go(it.dataset.go);
    });
    $("#detail").addEventListener("change", (e) => {
      const cb = e.target.closest(".inpick input[data-list]");
      if (cb) setInList(cb.dataset.list, +cb.closest(".inpick").dataset.pid, cb.checked);
    });
    $("#detail").addEventListener("submit", (e) => {
      const panel = e.target.closest(".inpick");
      if (!panel) return;
      e.preventDefault();
      const input = panel.querySelector("input[type=text]");
      const name = input.value.trim();
      if (!name) return;
      input.blur();
      createList(name, [+panel.dataset.pid]);
      renderInlinePicker(panel);
      toast(`Added to “${name}”.`);
    });
    $("#picker").addEventListener("click", (e) => {
      if (e.target.id === "picker" || e.target.closest("[data-act=close]")) $("#picker").hidden = true;
    });
    $("#picker").addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-list]");
      if (cb && pickerPid) setInList(cb.dataset.list, pickerPid, cb.checked);
    });
    $("#picker").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target.closest("form");
      const name = form.querySelector("input[type=text]").value.trim();
      if (!name) return;
      if (form.dataset.act === "rename") {
        renameList(state.listView.id, name);
        $("#picker").hidden = true;
      } else if (pickerMode === "add") {
        createList(name, [pickerPid]);
        toast(`Added to “${name}”.`);
      } else {
        const id = createList(name);
        $("#picker").hidden = true;
        go(`list/${id}`);
        toast("List created. Open any problem and tap Add to list.");
      }
    });
    $("#btn-locate").addEventListener("click", () => startLocate(true));
    $("#btn-layer").addEventListener("click", () => toggleSat());
    $("#btn-fit").addEventListener("click", () => (state.area !== "all" ? fitArea(state.area) : fitRegion()));
    $("#btn-offline").addEventListener("click", openOffline);
    $("#btn-account").addEventListener("click", () => accountMenu());
    // Tapping anywhere outside the account menu closes it.
    document.addEventListener("pointerdown", (e) => {
      const m = $("#acctmenu");
      if (!m.hidden && !e.target.closest("#acctmenu, #btn-account")) m.hidden = true;
    });
    // iPhone: don't let a pinch on the page chrome (outside the map) zoom the whole page.
    document.addEventListener("gesturestart", (e) => { if (!e.target.closest?.("#map")) e.preventDefault(); });
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
        if (!$("#picker").hidden) $("#picker").hidden = true;
        else if (!$("#offline").hidden) $("#offline").hidden = true;
        else if (state.sel) back();
        else if (state.listView) listsBack();
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
    $("#subtitle").textContent = `${REG.name} · ${REG.problems.length.toLocaleString()} problems`;
    document.title = `Boulder Atlas · ${REG.name}`;
    renderChips();
    renderAreaSelect();
    bind();
    syncTabs();
    initSheet();
    initMap();
    window.__atlas = { map, state, REG };
    renderList();
    route_();
    onNet();
    startLocate(false);
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").then(() => cacheRegion()).catch(() => {});
      // The app opens from the saved copy; if the background check finds a newer version right after
      // launch, switch to it (at most once a minute, so a flaky server can't cause a reload loop).
      let told = false;
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.type !== "atlas-updated") return;
        let last = 0;
        try { last = +sessionStorage.getItem("atlas:reloaded") || 0; } catch { /* ignore */ }
        if (performance.now() < 8000 && !state.sel && !state.listView && Date.now() - last > 60000) {
          try { sessionStorage.setItem("atlas:reloaded", String(Date.now())); } catch { /* ignore */ }
          location.reload();
        } else if (!told) {
          told = true;
          toast("Boulder Atlas updated. It will use the new version next time you open it.", 4000);
        }
      });
    }
  }

  // Public hooks for auth.js (Google sign-in + synced saved climbs).
  window.Atlas = {
    bus,
    get saved() { return Object.fromEntries(saved); },
    get lists() { return Object.fromEntries(lists); },
    replaceSaved,
    replaceLists,
    setUser,
    toast,
    ready: null,
  };
  window.Atlas.ready = main().catch((err) => {
    console.error(err);
    toast("Couldn’t load the boulder data. Check your connection and reload.", 10000);
  });
})();
