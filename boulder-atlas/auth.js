// Google sign-in + saved climbs synced across devices (Firebase Auth + Cloud Firestore).
// Optional: if firebase-config.js doesn't define window.ATLAS_FIREBASE, the app runs signed-out and
// keeps saved climbs on this device only. Loaded as a module so a failed import (e.g. offline before
// the SDK was ever cached) never breaks the map.
const cfg = window.ATLAS_FIREBASE;
const V = "13.1.0";

if (cfg && window.Atlas) {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc, deleteField, serverTimestamp } = fsMod;

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  await window.Atlas.ready;
  let uid = null, unsub = null, firstSnap = true;

  window.AtlasAuth = {
    async signIn() {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          await signInWithRedirect(auth, provider);
        } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
          window.Atlas.toast(navigator.onLine ? "Couldn’t sign in. Please try again." : "Signing in needs a connection.");
          console.warn(e);
        }
      }
    },
    signOut: () => signOut(auth),
  };
  window.Atlas.setUser(null);
  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    uid = user ? user.uid : null;
    window.Atlas.setUser(user ? { name: user.displayName, email: user.email, photo: user.photoURL } : null);
    if (!user) return;
    firstSnap = true;
    const ref = doc(db, "users", user.uid);
    unsub = onSnapshot(ref, (snap) => {
      const remote = snap.data()?.saved || {};
      if (firstSnap) {
        // First sync on this device: keep the union, and upload anything saved while signed out.
        firstSnap = false;
        const local = window.Atlas.saved;
        const missing = Object.fromEntries(Object.entries(local).filter(([k]) => !(k in remote)));
        window.Atlas.replaceSaved({ ...local, ...remote });
        if (Object.keys(missing).length) setDoc(ref, { saved: missing, updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
        return;
      }
      window.Atlas.replaceSaved(remote);
    }, (err) => console.warn("sync", err));
  });

  // Each save/unsave on this device becomes a field update (queued while offline).
  window.Atlas.bus.addEventListener("saved", (e) => {
    if (!uid) return;
    const { pid, on } = e.detail;
    setDoc(doc(db, "users", uid), { saved: { [pid]: on ? Date.now() : deleteField() }, updatedAt: serverTimestamp() }, { merge: true }).catch(console.warn);
  });
}
