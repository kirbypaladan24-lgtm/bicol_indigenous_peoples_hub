import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDocsFromServer,
  getDoc,
  getDocFromServer,
  getCountFromServer,
  onSnapshot,
  updateDoc,
  increment,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// CRITICAL: Verify this matches your Firebase Console project exactly
export const firebaseConfig = {
  apiKey: "AIzaSyBLkTO_wiaEe-Oe-u6sUUy2C7S-0g56jJc",
  authDomain: "atm-banking-system.firebaseapp.com",
  databaseURL: "https://atm-banking-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "atm-banking-system",
  storageBucket: "atm-banking-system.firebasestorage.app",
  messagingSenderId: "386957892456",
  appId: "1:386957892456:web:6be8ef914b5708344f54dd",
  measurementId: "G-XDYGMNWSMC",
};

const ADMIN_UID = "6bs7TaQnJBZDGiyhR1eoDMLncsb2";
const ADMIN_EMAIL = "admin@ip-bicol.com";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// CRITICAL FIX: Detect and prevent emulator mode on production
const isLocalhost = typeof location !== 'undefined' && 
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

// Only enable emulator if explicitly requested via URL param AND on localhost
const urlParams = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const emulatorExplicitlyEnabled = urlParams.get('emulator') === 'true';
const useEmulator = isLocalhost && emulatorExplicitlyEnabled;

// Initialize Firestore with production-safe settings
let db;

if (useEmulator) {
  console.warn('⚠️ FIRESTORE EMULATOR MODE ACTIVE');
  console.warn('   Data will NOT sync to production!');
  console.warn('   Host:', location.hostname);
  db = getFirestore(app);
  connectFirestoreEmulator(db, 'localhost', 8080);
} else {
  console.log('✅ Firestore Production Mode');
  console.log('   Project:', firebaseConfig.projectId);
  console.log('   Host:', typeof location !== 'undefined' ? location.hostname : 'server');
  
  // Production: Use initializeFirestore with offline persistence
  // This ensures data syncs to cloud even with intermittent connectivity
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
}

export { db };

export const observeAuth = (cb) => onAuthStateChanged(auth, cb);

export async function loginWithEmail(email, password) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    return user;
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(
        doc(db, "users", user.uid),
        {
          email,
          username: email.split("@")[0],
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      await bumpUserCount();
      return user;
    }
    throw err;
  }
}

export async function logout() {
  await signOut(auth);
}

export async function ensureAnonAuth() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const { user } = await signInAnonymously(auth);
    return user;
  } catch (e) {
    // ignore if anonymous auth is disabled
    return null;
  }
}

export async function createAccount(email, password) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  return user;
}

export async function changePassword({ currentPassword, newPassword }) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error("No authenticated user.");
  if (!currentPassword || !newPassword) throw new Error("Missing password fields.");
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

export async function createAccountWithProfile({ email, password, username, phone, birthdate }) {
  // 1. Create auth user (always in cloud)
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  
  // 2. Create Firestore document with immediate server confirmation
  const userRef = doc(db, "users", user.uid);
  const userData = {
    username,
    phone,
    birthdate,
    email,
    uid: user.uid,
    createdAt: serverTimestamp(),
  };
  
  try {
    // Write to Firestore
    await setDoc(userRef, userData, { merge: true });
    
    // CRITICAL: Verify write by reading from SERVER (not cache)
    const verifySnap = await getDocFromServer(userRef);
    if (!verifySnap.exists()) {
      throw new Error('User document not found after creation - Firestore sync failed');
    }
    
    console.log('✅ User created and verified in Firestore:', user.uid);
    
    // 3. Update public stats
    await bumpUserCount();
    
    return user;
  } catch (error) {
    console.error('❌ Failed to create user profile:', error);
    // Clean up orphaned auth user
    try {
      await user.delete();
    } catch (e) {
      console.error('Could not clean up auth user:', e);
    }
    throw error;
  }
}

export function isAdmin(user) {
  if (!user) return false;
  return user.uid === ADMIN_UID || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

// Firestore helpers
const postsRef = collection(db, "posts");
const landmarksRef = collection(db, "landmarks");
const statsRef = doc(db, "stats", "public");

async function bumpUserCount() {
  try {
    await setDoc(statsRef, { userCount: increment(1) }, { merge: true });
    console.log('✅ User count incremented');
  } catch (e) {
    console.warn("Failed to bump user count:", e);
  }
}

// CRITICAL FIX: Force server reads for production P2P reliability
export async function fetchPosts(forceServer = true) {
  const q = query(postsRef, orderBy("createdAt", "desc"));
  // ALWAYS use getDocsFromServer to ensure fresh data from cloud
  const snapshot = forceServer 
    ? await getDocsFromServer(q)
    : await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchUsersCount(options = {}) {
  const forceUsers = options?.forceUsers === true;
  
  if (!forceUsers) {
    try {
      // Force server read for stats
      const snap = await getDocFromServer(statsRef);
      if (snap.exists() && typeof snap.data()?.userCount === "number") {
        return { count: snap.data().userCount, source: "stats" };
      }
    } catch (e) {
      console.warn('Failed to fetch stats from server:', e);
    }
  }
  
  // Fallback: count users collection directly from server
  const usersRef = collection(db, "users");
  const snap = await getCountFromServer(usersRef);
  return { count: snap?.data()?.count ?? 0, source: "users" };
}

export async function setPublicUserCount(count) {
  if (!Number.isFinite(count)) return;
  await setDoc(statsRef, { userCount: count }, { merge: true });
}

export function observePosts(callback) {
  const q = query(postsRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const posts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(posts);
    },
    (error) => {
      console.error("observePosts error:", error);
      // Don't fail silently - log to help diagnose P2P issues
      if (error.code === 'permission-denied') {
        console.error('Firestore permission denied - check security rules');
      }
    }
  );
}

export async function fetchPost(id, forceServer = true) {
  const docRef = doc(db, "posts", id);
  const snap = forceServer 
    ? await getDocFromServer(docRef) 
    : await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Save post.
 * - Accepts media: array of image URLs (preferred)
 * - For backward compatibility we also set coverUrl to first media item or null
 */
export async function savePost({ id, title, content, media = [], author, authorId = null }) {
  const coverUrl = Array.isArray(media) && media.length ? media[0] : null;
  const payload = {
    title,
    content,
    media: Array.isArray(media) ? media : media ? [media] : [],
    coverUrl: coverUrl,
    author,
    authorId: authorId || null,
    updatedAt: serverTimestamp(),
  };
  
  try {
    if (id) {
      await updateDoc(doc(db, "posts", id), payload);
      console.log('✅ Post updated:', id);
      return id;
    }
    const docRef = await addDoc(postsRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    console.log('✅ Post created:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Failed to save post:', error);
    throw error;
  }
}

export async function deletePost(id) {
  await deleteDoc(doc(db, "posts", id));
}

export async function updatePostReactions(id, { likeDelta = 0, dislikeDelta = 0 }) {
  if (!id) return;
  
  console.log('Updating reactions for post:', id, { likeDelta, dislikeDelta });
  
  const payload = {};
  if (likeDelta) payload.likes = increment(likeDelta);
  if (dislikeDelta) payload.dislikes = increment(dislikeDelta);
  if (!Object.keys(payload).length) return;
  
  try {
    await updateDoc(doc(db, "posts", id), payload);
    console.log('✅ Reactions updated for post:', id);
  } catch (error) {
    console.error('❌ Failed to update reactions:', error);
    // Re-throw so UI can handle failure
    throw error;
  }
}

export async function getUserProfile(uid) {
  // Force server read to ensure fresh data
  const snap = await getDocFromServer(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Landmarks (map locations)
export async function fetchLandmarks(forceServer = true) {
  const snapshot = forceServer 
    ? await getDocsFromServer(landmarksRef) 
    : await getDocs(landmarksRef);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchLandmark(id, forceServer = true) {
  const docRef = doc(db, "landmarks", id);
  const snap = forceServer 
    ? await getDocFromServer(docRef) 
    : await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveLandmark({ id, name, lat, lng, summary, coverUrl, color }) {
  const payload = {
    name,
    lat,
    lng,
    summary,
    coverUrl: coverUrl || null,
    color: color || null,
    updatedAt: serverTimestamp(),
  };
  
  try {
    if (id) {
      await updateDoc(doc(db, "landmarks", id), payload);
      console.log('✅ Landmark updated:', id);
      return id;
    }
    const docRef = await addDoc(landmarksRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    console.log('✅ Landmark created:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Failed to save landmark:', error);
    throw error;
  }
}

export async function deleteLandmark(id) {
  await deleteDoc(doc(db, "landmarks", id));
}

// Diagnostic helper - call this from browser console to verify connection
export async function verifyFirestoreConnection() {
  console.log('=== Firestore Connection Diagnostic ===');
  console.log('Project ID:', firebaseConfig.projectId);
  console.log('Current user:', auth.currentUser?.uid || 'none');
  console.log('Is localhost:', isLocalhost);
  console.log('Emulator enabled:', useEmulator);
  
  try {
    const testRef = doc(db, '_diagnostics', 'connection-test');
    await setDoc(testRef, { 
      timestamp: serverTimestamp(),
      client: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      testId: Math.random().toString(36).slice(2)
    });
    const verifySnap = await getDocFromServer(testRef);
    if (verifySnap.exists()) {
      console.log('✅ Firestore connection verified - data written and read from server');
      return true;
    } else {
      console.error('❌ Firestore write succeeded but read failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Firestore connection failed:', error);
    return false;
  }
}

// Auto-verify on load (remove in production if too verbose)
if (typeof window !== 'undefined') {
  window.verifyFirestore = verifyFirestoreConnection;
  console.log('Firestore initialized. Run verifyFirestore() in console to test connection.');
}
