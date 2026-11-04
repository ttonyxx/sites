// Google sign-in + saved climbs synced across devices (Firebase Auth + Cloud Firestore).
// Optional: if firebase-config.js doesn't define window.ATLAS_FIREBASE, the app runs signed-out and
// keeps saved climbs on this device only. Loaded as a module so a failed import (e.g. offline before
// the SDK was ever cached) never breaks the map.
//
// Sign-in uses Google's own "Sign in with Google" button (Google Identity Services). It returns an
// ID token, which Firebase turns into a session with signInWithCredential.
const cfg = window.ATLAS_FIREBASE;
const V = "13.1.0";

if (cfg && cfg.googleClientId && window.Atlas) {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithCredential, onAuthStateChanged, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc, updateDoc, deleteField, serverTimestamp } = fsMod;

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

  await window.Atlas.ready;
  let uid = null, unsub = null, firstSnap = true, gis = null;

  function loadGis() {
    if (gis) return gis;
    gis = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gis = null; reject(new Error("gis")); };
      document.head.appendChild(s);
    }).then(() => {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async ({ credential }) => {
          try {
            await signInWithCredential(auth, GoogleAuthProvider.credential(credential));
          } catch (e) {
            console.warn(e);
            window.Atlas.toast("Couldn’t finish signing in. Please try again.");
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        itp_support: true,
        use_fedcm_for_button: true,
        context: "signin",
      });
    });
    return gis;
  }

  window.AtlasAuth = {
    // Renders Google's sign-in button into `el` (the account menu).
    async signIn(el) {
      if (!navigator.onLine) { window.Atlas.toast("Signing in needs a connection."); return; }
      try { await loadGis(); } catch { window.Atlas.toast("Couldn’t reach Google. Try again with signal."); return; }
      if (el) {
        el.innerHTML = "";
        google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", logo_alignment: "left", width: 250 });
      }
    },
    async signOut() {
      await signOut(auth);
      try { google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
    },
  };
  window.Atlas.setUser(null);

  onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    uid = user ? user.uid : null;
    window.Atlas.setUser(user ? { name: user.displayName, email: user.email, photo: user.photoURL } : null);
    if (!user) return;
    firstSnap = true;
    const ref = doc(db, "users", user.uid);
    unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() || {};
      const remoteSaved = data.saved || {};
      const remoteLists = data.lists || {};
      if (firstSnap) {
        // First sync on this device: keep the union of both sides, then upload what only this device had.
        firstSnap = false;
        const localSaved = window.Atlas.saved;
        const missing = Object.fromEntries(Object.entries(localSaved).filter(([k]) => !(k in remoteSaved)));
        window.Atlas.replaceSaved({ ...localSaved, ...remoteSaved });
        const merged = { ...remoteLists };
        const upload = {};
        for (const [id, l] of Object.entries(window.Atlas.lists)) {
          const r = remoteLists[id];
          if (!r) { merged[id] = l; upload[id] = l; continue; }
          const items = { ...r.items, ...l.items };
          if (Object.keys(items).length !== Object.keys(r.items || {}).length || (l.updated || 0) > (r.updated || 0)) {
            merged[id] = { name: (l.updated || 0) > (r.updated || 0) ? l.name : r.name, items, updated: Math.max(l.updated || 0, r.updated || 0) };
            upload[id] = merged[id];
          }
        }
        window.Atlas.replaceLists(merged);
        if (Object.keys(missing).length || Object.keys(upload).length) {
          setDoc(ref, { ...(Object.keys(missing).length ? { saved: missing } : {}), ...(Object.keys(upload).length ? { lists: upload } : {}), updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
        }
        return;
      }
      window.Atlas.replaceSaved(remoteSaved);
      window.Atlas.replaceLists(remoteLists);
    }, (err) => console.warn("sync", err));
  });

  // Each change on this device becomes a field update (queued while offline).
  window.Atlas.bus.addEventListener("saved", (e) => {
    if (!uid) return;
    const { pid, on } = e.detail;
    setDoc(doc(db, "users", uid), { saved: { [pid]: on ? Date.now() : deleteField() }, updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
  });
  // A list is written whole (lists.<id>), so removed climbs and renames replace the old copy.
  window.Atlas.bus.addEventListener("lists", async (e) => {
    if (!uid) return;
    const { id, data } = e.detail;
    const ref = doc(db, "users", uid);
    try {
      await updateDoc(ref, { [`lists.${id}`]: data ?? deleteField(), updatedAt: serverTimestamp() });
    } catch (err) {
      if (err.code === "not-found" && data) setDoc(ref, { lists: { [id]: data }, updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
      else console.warn(err);
    }
  });
}
