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
import { firebaseConfig } from "./firebase-config.js";

const ADMIN_UID = "6bs7TaQnJBZDGiyhR1eoDMLncsb2";
const ADMIN_EMAIL = "admin@ip-bicol.com";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const isLocalhost =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

const urlParams = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const emulatorExplicitlyEnabled = urlParams.get("emulator") === "true";
const useEmulator = isLocalhost && emulatorExplicitlyEnabled;

function createFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    console.warn("Falling back to default Firestore initialization:", error);
    return getFirestore(app);
  }
}

let db;

if (useEmulator) {
  console.warn("FIRESTORE EMULATOR MODE ACTIVE");
  console.warn("Data will NOT sync to production.");
  console.warn("Host:", location.hostname);
  db = getFirestore(app);
  connectFirestoreEmulator(db, "localhost", 8080);
} else {
  console.log("Firestore Production Mode");
  console.log("Project:", firebaseConfig.projectId);
  console.log("Host:", typeof location !== "undefined" ? location.hostname : "server");
  db = createFirestore();
}

export { db, firebaseConfig };

export const observeAuth = (cb) =>
  onAuthStateChanged(auth, (user) => cb(user && !user.isAnonymous ? user : null));

async function ensureUserProfile(user, profile = {}) {
  if (!user?.uid) return null;

  const email = profile.email || user.email || null;
  const username =
    profile.username ||
    user.displayName ||
    (email ? email.split("@")[0] : "Contributor");

  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      email,
      username,
      phone: profile.phone || null,
      birthdate: profile.birthdate || null,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  );

  return user;
}

export async function loginWithEmail(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserProfile(user, { email });
  return user;
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
    return null;
  }
}

export async function createAccount(email, password) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserProfile(user, { email });
  await bumpUserCount();
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
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  const userRef = doc(db, "users", user.uid);
  const userData = {
    username,
    phone,
    birthdate,
    email,
    uid: user.uid,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };

  try {
    await setDoc(userRef, userData, { merge: true });

    const verifySnap = await getDocFromServer(userRef);
    if (!verifySnap.exists()) {
      throw new Error("User document not found after creation - Firestore sync failed");
    }

    console.log("User created and verified in Firestore:", user.uid);
    await bumpUserCount();
    return user;
  } catch (error) {
    console.error("Failed to create user profile:", error);
    try {
      await user.delete();
    } catch (cleanupError) {
      console.error("Could not clean up auth user:", cleanupError);
    }
    throw error;
  }
}

export function isAdmin(user) {
  if (!user) return false;
  return user.uid === ADMIN_UID || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

const postsRef = collection(db, "posts");
const landmarksRef = collection(db, "landmarks");
const statsRef = doc(db, "stats", "public");

async function bumpUserCount() {
  try {
    await setDoc(statsRef, { userCount: increment(1) }, { merge: true });
    console.log("User count incremented");
  } catch (e) {
    console.warn("Failed to bump user count:", e);
  }
}

export async function fetchPosts(forceServer = true) {
  const q = query(postsRef, orderBy("createdAt", "desc"));
  const snapshot = forceServer ? await getDocsFromServer(q) : await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchUsersCount(options = {}) {
  const forceUsers = options?.forceUsers === true;

  if (!forceUsers) {
    try {
      const snap = await getDocFromServer(statsRef);
      if (snap.exists() && typeof snap.data()?.userCount === "number") {
        return { count: snap.data().userCount, source: "stats" };
      }
    } catch (e) {
      console.warn("Failed to fetch stats from server:", e);
    }
  }

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
      if (error.code === "permission-denied") {
        console.error("Firestore permission denied - check security rules");
      }
    }
  );
}

export async function fetchPost(id, forceServer = true) {
  const docRef = doc(db, "posts", id);
  const snap = forceServer ? await getDocFromServer(docRef) : await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function savePost({ id, title, content, media = [], author, authorId = null }) {
  const coverUrl = Array.isArray(media) && media.length ? media[0] : null;
  const payload = {
    title,
    content,
    media: Array.isArray(media) ? media : media ? [media] : [],
    coverUrl,
    author,
    authorId: authorId || null,
    updatedAt: serverTimestamp(),
  };

  try {
    if (id) {
      await updateDoc(doc(db, "posts", id), payload);
      console.log("Post updated:", id);
      return id;
    }
    const docRef = await addDoc(postsRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    console.log("Post created:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Failed to save post:", error);
    throw error;
  }
}

export async function deletePost(id) {
  await deleteDoc(doc(db, "posts", id));
}

export async function updatePostReactions(id, { likeDelta = 0, dislikeDelta = 0 }) {
  if (!id) return;

  console.log("Updating reactions for post:", id, { likeDelta, dislikeDelta });

  const payload = {};
  if (likeDelta) payload.likes = increment(likeDelta);
  if (dislikeDelta) payload.dislikes = increment(dislikeDelta);
  if (!Object.keys(payload).length) return;

  try {
    await updateDoc(doc(db, "posts", id), payload);
    console.log("Reactions updated for post:", id);
  } catch (error) {
    console.error("Failed to update reactions:", error);
    throw error;
  }
}

export async function getUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  try {
    const snap = await getDocFromServer(userRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Falling back to cached user profile:", error);
    const snap = await getDoc(userRef);
    return snap.exists() ? snap.data() : null;
  }
}

export async function fetchLandmarks(forceServer = true) {
  const snapshot = forceServer ? await getDocsFromServer(landmarksRef) : await getDocs(landmarksRef);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchLandmark(id, forceServer = true) {
  const docRef = doc(db, "landmarks", id);
  const snap = forceServer ? await getDocFromServer(docRef) : await getDoc(docRef);
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
      console.log("Landmark updated:", id);
      return id;
    }
    const docRef = await addDoc(landmarksRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    console.log("Landmark created:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Failed to save landmark:", error);
    throw error;
  }
}

export async function deleteLandmark(id) {
  await deleteDoc(doc(db, "landmarks", id));
}

export async function verifyFirestoreConnection() {
  console.log("=== Firestore Connection Diagnostic ===");
  console.log("Project ID:", firebaseConfig.projectId);
  console.log("Current user:", auth.currentUser?.uid || "none");
  console.log("Is localhost:", isLocalhost);
  console.log("Emulator enabled:", useEmulator);

  try {
    const testRef = doc(db, "_diagnostics", "connection-test");
    await setDoc(testRef, {
      timestamp: serverTimestamp(),
      client: typeof navigator !== "undefined" ? navigator.userAgent : "server",
      testId: Math.random().toString(36).slice(2),
    });
    const verifySnap = await getDocFromServer(testRef);
    if (verifySnap.exists()) {
      console.log("Firestore connection verified - data written and read from server");
      return true;
    }
    console.error("Firestore write succeeded but read failed");
    return false;
  } catch (error) {
    console.error("Firestore connection failed:", error);
    return false;
  }
}

if (typeof window !== "undefined") {
  window.verifyFirestore = verifyFirestoreConnection;
  console.log("Firestore initialized. Run verifyFirestore() in console to test connection.");
}
