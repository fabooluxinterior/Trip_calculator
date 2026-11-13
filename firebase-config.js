// Live sync settings. Leave this as null to keep the app local-only
// (data stays in each browser's localStorage).
//
// To turn on live sync, replace null with your Firebase web app config
// (Firebase console → Project settings → Your apps → Web app → Config)
// and add your own user ID as ownerUid. See README → "Live sync with Firebase".
//
// These values are not secret: the database rules are what protect the data.

window.TRIP_FIREBASE = null;

/* Example:
window.TRIP_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "your-project",
  appId: "1:1234567890:web:abc123",
  ownerUid: "PASTE_YOUR_UID_HERE"
};
*/
