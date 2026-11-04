// Firebase web config for Google sign-in + synced saved climbs (project "tonyxin", tonyxin-8bae2).
// This is public by design: what each signed-in person can read or write is enforced by the
// Firestore rules in firestore.rules (published in the Firebase console).
window.ATLAS_FIREBASE = {
  apiKey: "AIzaSyDFygf5DGvxVenyAQ3itGFsowMmYMVxHT8",
  authDomain: "tonyxin-8bae2.firebaseapp.com",
  projectId: "tonyxin-8bae2",
  storageBucket: "tonyxin-8bae2.firebasestorage.app",
  messagingSenderId: "1060771553706",
  appId: "1:1060771553706:web:13792a7fad2e01c28e8bd3",
  // OAuth client "Boulder Atlas web" (Google Cloud → Google Auth Platform → Clients). Sign in with
  // Google returns an ID token for this client, and Firebase accepts it because the client ID is on
  // the Google provider's safelist (Firebase → Authentication → Google → Safelist client IDs).
  googleClientId: "1060771553706-92hlkj11mm4v9n3ps5u6m20h1h6vrjab.apps.googleusercontent.com",
};
