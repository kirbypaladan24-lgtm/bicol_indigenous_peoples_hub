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
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

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
const ADMIN_EMAIL = "admin@ip-bicol.com"; // change to your real admin email

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const observeAuth = (cb) => onAuthStateChanged(auth, cb);

export async function loginWithEmail(email, password) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    return user;
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
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
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", user.uid), {
    username,
    phone,
    birthdate,
    email,
    createdAt: serverTimestamp(),
  });
  return user;
}

export function isAdmin(user) {
  if (!user) return false;
  return user.uid === ADMIN_UID || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

// Firestore helpers
const postsRef = collection(db, "posts");
const landmarksRef = collection(db, "landmarks");

export async function fetchPosts(forceServer = false) {
  const q = query(postsRef, orderBy("createdAt", "desc"));
  const snapshot = forceServer ? await getDocsFromServer(q) : await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchUsersCount() {
  const usersRef = collection(db, "users");
  const snap = await getCountFromServer(usersRef);
  return snap?.data()?.count ?? 0;
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
    }
  );
}

export async function fetchPost(id, forceServer = false) {
  const docRef = doc(db, "posts", id);
  const snap = forceServer ? await getDocFromServer(docRef) : await getDoc(docRef);
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
    coverUrl: coverUrl, // keep for compatibility with older clients
    author,
    authorId: authorId || null,
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "posts", id), payload);
    return id;
  }
  const docRef = await addDoc(postsRef, {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function deletePost(id) {
  await deleteDoc(doc(db, "posts", id));
}

export async function updatePostReactions(id, { likeDelta = 0, dislikeDelta = 0 }) {
  if (!id) return;
  const payload = {};
  if (likeDelta) payload.likes = increment(likeDelta);
  if (dislikeDelta) payload.dislikes = increment(dislikeDelta);
  if (!Object.keys(payload).length) return;
  await updateDoc(doc(db, "posts", id), payload);
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Landmarks (map locations)
export async function fetchLandmarks(forceServer = false) {
  const snapshot = forceServer ? await getDocsFromServer(landmarksRef) : await getDocs(landmarksRef);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchLandmark(id, forceServer = false) {
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
  if (id) {
    await updateDoc(doc(db, "landmarks", id), payload);
    return id;
  }
  const docRef = await addDoc(landmarksRef, {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function deleteLandmark(id) {
  await deleteDoc(doc(db, "landmarks", id));
}
