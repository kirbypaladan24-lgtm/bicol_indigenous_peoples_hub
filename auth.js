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
  deleteField,
  doc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  runTransaction,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { assertFirebaseConfig } from "./firebase-config.js";

const ADMIN_UID = "6bs7TaQnJBZDGiyhR1eoDMLncsb2";
const ADMIN_EMAIL = "admin@ip-bicol.com";

const firebaseConfig = assertFirebaseConfig();
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

  const userRef = doc(db, "users", user.uid);
  const existingSnap = await getDoc(userRef);
  const existingProfile = existingSnap.exists() ? existingSnap.data() : null;
  const email = profile.email || user.email || null;
  const username =
    existingProfile?.username ||
    profile.username ||
    user.displayName ||
    (email ? email.split("@")[0] : "Contributor");

  const payload = {
    uid: user.uid,
    email,
    username,
    lastLoginAt: serverTimestamp(),
  };

  if (!existingProfile?.createdAt) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(userRef, payload, { merge: true });

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
  const privateUserRef = doc(db, "users_private", user.uid);
  const userData = {
    username,
    email,
    uid: user.uid,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
  const privateUserData = {
    uid: user.uid,
    phone: phone || null,
    birthdate: birthdate || null,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(userRef, userData, { merge: true });
    await setDoc(privateUserRef, privateUserData, { merge: true });

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
const postReactionsRef = collection(db, "post_reactions");
const sharedLocationsRef = collection(db, "shared_locations");
const emergencyAlertsRef = collection(db, "emergency_alerts");
const statsRef = doc(db, "stats", "public");

function getReactionDocRef(uid, postId) {
  return doc(db, "post_reactions", `${uid}_${postId}`);
}

function getSharedLocationDocRef(uid) {
  return doc(db, "shared_locations", uid);
}

function getPrivateUserDocRef(uid) {
  return doc(db, "users_private", uid);
}

async function hydrateSharedLocation(entry) {
  if (!entry?.uid || entry.phone) return entry;

  try {
    const privateProfile = await fetchPrivateUserProfile(entry.uid, false);
    if (privateProfile?.phone) {
      return {
        ...entry,
        phone: privateProfile.phone,
      };
    }
  } catch (error) {
    console.warn("Could not hydrate shared location phone:", error);
  }

  return entry;
}

async function hydrateSharedLocations(entries = []) {
  return Promise.all(entries.map((entry) => hydrateSharedLocation(entry)));
}

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
  const usersRef = collection(db, "users");
  try {
    const snap = await getCountFromServer(usersRef);
    return { count: snap?.data()?.count ?? 0, source: "users" };
  } catch (usersError) {
    console.warn("Failed to fetch user count from users collection:", usersError);
  }

  if (options?.forceUsers === true) {
    throw new Error("Failed to fetch users count from source");
  }

  try {
    const snap = await getDocFromServer(statsRef);
    if (snap.exists() && typeof snap.data()?.userCount === "number") {
      return { count: snap.data().userCount, source: "stats" };
    }
  } catch (statsError) {
    console.warn("Failed to fetch stats from server:", statsError);
  }

  return { count: 0, source: "fallback" };
}

export async function fetchUsers(forceServer = true) {
  const usersRef = collection(db, "users");
  const snapshot = forceServer ? await getDocsFromServer(usersRef) : await getDocs(usersRef);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function observeUsers(callback) {
  const usersRef = collection(db, "users");
  return onSnapshot(
    usersRef,
    (snapshot) => {
      const users = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(users);
    },
    (error) => {
      console.warn("observeUsers error:", error);
    }
  );
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

function resolveDisplayIdentity(user, profile = null) {
  const username =
    profile?.username ||
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "Contributor");

  return {
    username,
    email: profile?.email || user?.email || null,
  };
}

export async function fetchPrivateUserProfile(uid = auth.currentUser?.uid, forceServer = true) {
  if (!uid) return null;

  const privateRef = getPrivateUserDocRef(uid);

  try {
    const snap = forceServer ? await getDocFromServer(privateRef) : await getDoc(privateRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    if (!forceServer) throw error;
    const snap = await getDoc(privateRef);
    return snap.exists() ? snap.data() : null;
  }
}

async function resolveSharedLocationProfile(user, existingLocation = null) {
  const [publicProfile, privateProfile] = await Promise.all([
    getUserProfile(user.uid).catch(() => null),
    fetchPrivateUserProfile(user.uid, false).catch(() => null),
  ]);

  const identity = resolveDisplayIdentity(user, publicProfile);

  return {
    identity,
    phone: privateProfile?.phone || existingLocation?.phone || null,
  };
}

export async function fetchSharedLocation(uid = auth.currentUser?.uid, forceServer = true) {
  if (!uid) return null;

  const locationRef = getSharedLocationDocRef(uid);

  try {
    const snap = forceServer ? await getDocFromServer(locationRef) : await getDoc(locationRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    if (!forceServer) throw error;
    const snap = await getDoc(locationRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }
}

export function observeSharedLocation(uid = auth.currentUser?.uid, callback) {
  if (!uid || typeof callback !== "function") {
    return () => {};
  }

  const locationRef = getSharedLocationDocRef(uid);
  return onSnapshot(
    locationRef,
    (snapshot) => {
      callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    },
    (error) => {
      console.warn("observeSharedLocation error:", error);
      callback(null);
    }
  );
}

export async function acknowledgeLocationConsent() {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) {
    throw new Error("Login required to share location.");
  }

  const existingLocation = await fetchSharedLocation(user.uid, false).catch(() => null);
  const { identity, phone } = await resolveSharedLocationProfile(user, existingLocation);
  const locationRef = getSharedLocationDocRef(user.uid);

  await setDoc(
    locationRef,
    {
      userId: user.uid,
      uid: user.uid,
      username: identity.username,
      email: identity.email,
      phone,
      consentAccepted: true,
      consentAcceptedAt: existingLocation?.consentAcceptedAt || serverTimestamp(),
      sharingEnabled: existingLocation?.sharingEnabled === true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return fetchSharedLocation(user.uid, false);
}

export async function saveCurrentUserSharedLocation({ lat, lng, accuracy = null }) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) {
    throw new Error("Login required to share location.");
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("A valid latitude and longitude are required.");
  }

  const existingLocation = await fetchSharedLocation(user.uid, false).catch(() => null);
  const { identity, phone } = await resolveSharedLocationProfile(user, existingLocation);
  const normalizedAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : null;

  await setDoc(
    getSharedLocationDocRef(user.uid),
    {
      userId: user.uid,
      uid: user.uid,
      username: identity.username,
      email: identity.email,
      phone,
      lat,
      lng,
      accuracy: normalizedAccuracy,
      consentAccepted: true,
      consentAcceptedAt: existingLocation?.consentAcceptedAt || serverTimestamp(),
      sharingEnabled: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return fetchSharedLocation(user.uid, false);
}

export async function submitEmergencyReport({ message, imageUrl, lat = null, lng = null, accuracy = null }) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) {
    throw new Error("Login required to send an emergency report.");
  }

  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    throw new Error("Please describe the emergency before sending.");
  }
  if (!imageUrl) {
    throw new Error("Image proof is required before sending the emergency report.");
  }

  const existingLocation = await fetchSharedLocation(user.uid, false).catch(() => null);
  if (!existingLocation?.sharingEnabled || !Number.isFinite(existingLocation?.lat) || !Number.isFinite(existingLocation?.lng)) {
    throw new Error("Share your current location first before sending an emergency report.");
  }

  const { identity, phone } = await resolveSharedLocationProfile(user, existingLocation);

  const nextLat = Number.isFinite(lat) ? lat : existingLocation.lat;
  const nextLng = Number.isFinite(lng) ? lng : existingLocation.lng;
  const nextAccuracy = Number.isFinite(accuracy)
    ? Math.round(accuracy)
    : (Number.isFinite(existingLocation.accuracy) ? existingLocation.accuracy : null);

  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
    throw new Error("A current location is required before sending an emergency report.");
  }

  await setDoc(
    getSharedLocationDocRef(user.uid),
    {
      userId: user.uid,
      uid: user.uid,
      username: identity.username,
      email: identity.email,
      phone,
      lat: nextLat,
      lng: nextLng,
      accuracy: nextAccuracy,
      sharingEnabled: true,
      emergencyActive: true,
      emergencyMessage: trimmedMessage,
      emergencyImageUrl: imageUrl,
      emergencyStatus: "pending",
      emergencySubmittedAt: serverTimestamp(),
      responseStatus: null,
      responseReason: null,
      respondedAt: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await addDoc(emergencyAlertsRef, {
    userId: user.uid,
    uid: user.uid,
    username: identity.username,
    email: identity.email,
    phone,
    lat: nextLat,
    lng: nextLng,
    accuracy: nextAccuracy,
    message: trimmedMessage,
    imageUrl,
    status: "pending",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return fetchSharedLocation(user.uid, false);
}

export async function respondToEmergency(userId, { status, reason = "" }) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous || !isAdmin(user)) {
    throw new Error("Administrator access is required to respond.");
  }

  const normalizedStatus = String(status || "").trim();
  const allowed = ["approved", "help_on_the_way", "declined"];
  if (!allowed.includes(normalizedStatus)) {
    throw new Error("Choose a valid emergency response.");
  }

  const trimmedReason = String(reason || "").trim();
  if (normalizedStatus === "declined" && !trimmedReason) {
    throw new Error("A reason is required when declining an emergency report.");
  }

  await setDoc(
    getSharedLocationDocRef(userId),
    {
      emergencyActive: false,
      emergencyStatus: null,
      responseStatus: normalizedStatus,
      responseReason: trimmedReason || null,
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return fetchSharedLocation(userId, false);
}

export function observeSharedLocations(callback) {
  return onSnapshot(
    sharedLocationsRef,
    async (snapshot) => {
      const locations = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (entry) =>
            entry?.sharingEnabled === true &&
            Number.isFinite(entry?.lat) &&
            Number.isFinite(entry?.lng)
        )
        .sort((a, b) => {
          const aTime = a?.updatedAt?.seconds || 0;
          const bTime = b?.updatedAt?.seconds || 0;
          return bTime - aTime;
        });

      callback(await hydrateSharedLocations(locations));
    },
    (error) => {
      console.warn("observeSharedLocations error:", error);
      callback([]);
    }
  );
}

export async function fetchSharedLocations(forceServer = true) {
  const snapshot = forceServer ? await getDocsFromServer(sharedLocationsRef) : await getDocs(sharedLocationsRef);
  const locations = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (entry) =>
        entry?.sharingEnabled === true &&
        Number.isFinite(entry?.lat) &&
        Number.isFinite(entry?.lng)
    )
    .sort((a, b) => {
      const aTime = a?.updatedAt?.seconds || 0;
      const bTime = b?.updatedAt?.seconds || 0;
      return bTime - aTime;
    });

  return hydrateSharedLocations(locations);
}

export function observeEmergencyAlerts(callback) {
  return onSnapshot(
    emergencyAlertsRef,
    (snapshot) => {
      const alerts = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (entry) =>
            entry?.userId &&
            Number.isFinite(entry?.lat) &&
            Number.isFinite(entry?.lng)
        )
        .sort((a, b) => {
          const aTime = a?.submittedAt?.seconds || a?.updatedAt?.seconds || 0;
          const bTime = b?.submittedAt?.seconds || b?.updatedAt?.seconds || 0;
          return bTime - aTime;
        });

      callback(alerts);
    },
    (error) => {
      console.warn("observeEmergencyAlerts error:", error);
      callback([]);
    }
  );
}

export async function fetchEmergencyAlerts(forceServer = true) {
  const snapshot = forceServer ? await getDocsFromServer(emergencyAlertsRef) : await getDocs(emergencyAlertsRef);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (entry) =>
        entry?.userId &&
        Number.isFinite(entry?.lat) &&
        Number.isFinite(entry?.lng)
    )
    .sort((a, b) => {
      const aTime = a?.submittedAt?.seconds || a?.updatedAt?.seconds || 0;
      const bTime = b?.submittedAt?.seconds || b?.updatedAt?.seconds || 0;
      return bTime - aTime;
    });
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

export async function fetchCurrentUserReactions(forceServer = true) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) return {};

  const reactionsQuery = query(postReactionsRef, where("userId", "==", user.uid));
  let snapshot;

  try {
    snapshot = forceServer ? await getDocsFromServer(reactionsQuery) : await getDocs(reactionsQuery);
  } catch (error) {
    if (!forceServer) throw error;
    snapshot = await getDocs(reactionsQuery);
  }

  return snapshot.docs.reduce((acc, reactionDoc) => {
    const data = reactionDoc.data();
    if (data?.postId && (data?.value === "like" || data?.value === "dislike")) {
      acc[data.postId] = data.value;
    }
    return acc;
  }, {});
}

export function observeCurrentUserReactions(callback) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) {
    callback({});
    return () => {};
  }

  const reactionsQuery = query(postReactionsRef, where("userId", "==", user.uid));
  return onSnapshot(
    reactionsQuery,
    (snapshot) => {
      const reactions = snapshot.docs.reduce((acc, reactionDoc) => {
        const data = reactionDoc.data();
        if (data?.postId && (data?.value === "like" || data?.value === "dislike")) {
          acc[data.postId] = data.value;
        }
        return acc;
      }, {});
      callback(reactions);
    },
    (error) => {
      console.warn("observeCurrentUserReactions error:", error);
      callback({});
    }
  );
}

export async function setPostReaction(postId, nextReaction) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous) {
    throw new Error("Login required to react to posts.");
  }

  const reactionRef = getReactionDocRef(user.uid, postId);
  const postRef = doc(db, "posts", postId);
  return runTransaction(db, async (transaction) => {
    const [postSnap, reactionSnap] = await Promise.all([
      transaction.get(postRef),
      transaction.get(reactionRef),
    ]);

    if (!postSnap.exists()) {
      throw new Error("Post not found.");
    }

    const postData = postSnap.data() || {};
    const currentReaction = reactionSnap.exists() ? reactionSnap.data()?.value || null : null;

    if (currentReaction === nextReaction) {
      return {
        reaction: currentReaction,
        likeDelta: 0,
        dislikeDelta: 0,
      };
    }

    let likeDelta = 0;
    let dislikeDelta = 0;

    if (currentReaction === "like") likeDelta -= 1;
    if (currentReaction === "dislike") dislikeDelta -= 1;
    if (nextReaction === "like") likeDelta += 1;
    if (nextReaction === "dislike") dislikeDelta += 1;

    const currentLikes = Math.max(0, Number(postData.likes || 0));
    const currentDislikes = Math.max(0, Number(postData.dislikes || 0));
    const nextLikes = Math.max(0, currentLikes + likeDelta);
    const nextDislikes = Math.max(0, currentDislikes + dislikeDelta);

    transaction.update(postRef, {
      likes: nextLikes,
      dislikes: nextDislikes,
    });

    if (nextReaction === "like" || nextReaction === "dislike") {
      transaction.set(
        reactionRef,
        {
          userId: user.uid,
          postId,
          value: nextReaction,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else if (reactionSnap.exists()) {
      transaction.delete(reactionRef);
    }

    return {
      reaction: nextReaction || null,
      likeDelta,
      dislikeDelta,
    };
  });
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

export function observeLandmarks(callback) {
  return onSnapshot(
    landmarksRef,
    (snapshot) => {
      const landmarks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(landmarks);
    },
    (error) => {
      console.warn("observeLandmarks error:", error);
    }
  );
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
