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

export const SUPER_ADMIN_UID = "6bs7TaQnJBZDGiyhR1eoDMLncsb2";
export const ADMIN_ROLE_UIDS = {
  content_admin: "7gquSWQ94xZZLMxLCW4Xlv2QJ613",
  landmark_admin: "L6aGCzr08Wd4gcj6ndiAqa0Z5dx2",
  emergency_admin: "TI0yeuCaYcggEJmjh7H4BlAmp562",
};
export const ADMIN_OPERATOR_UIDS = [
  ADMIN_ROLE_UIDS.content_admin,
  ADMIN_ROLE_UIDS.landmark_admin,
  ADMIN_ROLE_UIDS.emergency_admin,
];
export const VALID_ADMIN_ROLES = [
  "content_admin",
  "landmark_admin",
  "emergency_admin",
];
const ADMIN_UIDS = new Set(ADMIN_OPERATOR_UIDS);
const DEFAULT_ADMIN_ROLE_BY_UID = new Map(
  Object.entries(ADMIN_ROLE_UIDS).map(([role, uid]) => [uid, role])
);
const adminAccessCache = new Map();
let adminAccessUnsub = null;

const firebaseConfig = assertFirebaseConfig();
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const isLocalhost =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

const urlParams = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const emulatorExplicitlyEnabled = urlParams.get("emulator") === "true";
const useEmulator = isLocalhost && emulatorExplicitlyEnabled;
const DEBUG_LOGS = isLocalhost || urlParams.get("debug") === "true";

function debugLog(...args) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (DEBUG_LOGS) {
    console.warn(...args);
  }
}

function createFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    debugWarn("Falling back to default Firestore initialization:", error);
    return getFirestore(app);
  }
}

let db;

if (useEmulator) {
  debugWarn("FIRESTORE EMULATOR MODE ACTIVE");
  debugWarn("Data will NOT sync to production.");
  debugWarn("Host:", location.hostname);
  db = getFirestore(app);
  connectFirestoreEmulator(db, "localhost", 8080);
} else {
  debugLog("Firestore Production Mode");
  debugLog("Project:", firebaseConfig.projectId);
  debugLog("Host:", typeof location !== "undefined" ? location.hostname : "server");
  db = createFirestore();
}

export { db, firebaseConfig };

function getAdminAccessDocRef(uid) {
  return doc(db, "admin_access", uid);
}

function resolveAdminAccessState(uid) {
  if (!uid) return null;
  if (uid === SUPER_ADMIN_UID) {
    return { uid, role: "super_admin", active: true };
  }

  const defaultRole = DEFAULT_ADMIN_ROLE_BY_UID.get(uid) || null;
  const cached = adminAccessCache.get(uid);

  if (cached) {
    const role = VALID_ADMIN_ROLES.includes(cached.role) ? cached.role : defaultRole;
    const active = cached.active !== false;
    if (!role) return null;
    return {
      uid,
      role,
      active,
      updatedAt: cached.updatedAt || null,
      updatedBy: cached.updatedBy || null,
    };
  }

  if (!defaultRole) return null;
  return { uid, role: defaultRole, active: true };
}

function setAdminAccessCache(uid, data = null) {
  if (!uid || uid === SUPER_ADMIN_UID) return;
  if (data) {
    adminAccessCache.set(uid, {
      role: data.role || null,
      active: data.active !== false,
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || null,
    });
  } else {
    adminAccessCache.delete(uid);
  }
}

async function syncAdminAccess(uid, forceServer = true) {
  if (!uid || uid === SUPER_ADMIN_UID) return resolveAdminAccessState(uid);
  try {
    const snap = forceServer
      ? await getDocFromServer(getAdminAccessDocRef(uid))
      : await getDoc(getAdminAccessDocRef(uid));
    if (snap.exists()) {
      setAdminAccessCache(uid, snap.data());
    } else {
      setAdminAccessCache(uid, null);
    }
  } catch (error) {
    console.warn("Falling back to cached admin access state:", error);
    try {
      const snap = await getDoc(getAdminAccessDocRef(uid));
      if (snap.exists()) {
        setAdminAccessCache(uid, snap.data());
      }
    } catch (cachedError) {
      console.warn("Could not read cached admin access state:", cachedError);
    }
  }
  return resolveAdminAccessState(uid);
}

function startAdminAccessSync(user) {
  try {
    adminAccessUnsub?.();
  } catch (error) {}
  adminAccessUnsub = null;

  if (!user?.uid || user.uid === SUPER_ADMIN_UID || !ADMIN_UIDS.has(user.uid)) return;

  adminAccessUnsub = onSnapshot(
    getAdminAccessDocRef(user.uid),
    (snapshot) => {
      if (snapshot.exists()) {
        setAdminAccessCache(user.uid, snapshot.data());
      } else {
        setAdminAccessCache(user.uid, null);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("admin-access-changed", {
            detail: {
              uid: user.uid,
              state: resolveAdminAccessState(user.uid),
            },
          })
        );
      }
    },
    (error) => {
      console.warn("observe admin access error:", error);
    }
  );
}

export const observeAuth = (cb) =>
  onAuthStateChanged(auth, async (user) => {
    const normalizedUser = user && !user.isAnonymous ? user : null;
    if (normalizedUser?.uid) {
      await syncAdminAccess(normalizedUser.uid, true).catch(() => {});
    }
    startAdminAccessSync(normalizedUser);
    cb(normalizedUser);
  });

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

    debugLog("User created and verified in Firestore:", user.uid);
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

export function isSuperAdmin(user) {
  return Boolean(user?.uid) && user.uid === SUPER_ADMIN_UID;
}

export function getAdminAccessState(userOrUid) {
  const uid = typeof userOrUid === "string" ? userOrUid : userOrUid?.uid;
  return resolveAdminAccessState(uid);
}

export function getAdminRole(user) {
  const state = getAdminAccessState(user);
  return state?.active ? state.role : null;
}

export function getAdminRoleLabel(user) {
  switch (getAdminRole(user)) {
    case "super_admin":
      return "Super Admin";
    case "content_admin":
      return "Content Admin";
    case "landmark_admin":
      return "Landmark Admin";
    case "emergency_admin":
      return "Emergency Admin";
    default:
      return "Member";
  }
}

export function isContentAdmin(user) {
  return getAdminRole(user) === "content_admin";
}

export function isLandmarkAdmin(user) {
  return getAdminRole(user) === "landmark_admin";
}

export function isEmergencyAdmin(user) {
  return getAdminRole(user) === "emergency_admin";
}

export function isAdmin(user) {
  if (!user) return false;
  return Boolean(getAdminRole(user));
}

export function canManagePosts(user) {
  return isSuperAdmin(user) || isContentAdmin(user);
}

export function canManageLandmarks(user) {
  return isSuperAdmin(user) || isLandmarkAdmin(user);
}

export function canManageEmergencies(user) {
  return isSuperAdmin(user) || isEmergencyAdmin(user);
}

export function canAccessAdminWorkspace(user) {
  return canManagePosts(user) || canManageLandmarks(user);
}

export function canAccessTracker(user) {
  return canManageEmergencies(user);
}

export function canAccessCharts(user) {
  return isAdmin(user);
}

export async function fetchAdminAccessState(uid, forceServer = true) {
  return syncAdminAccess(uid, forceServer);
}

export async function fetchAdminDirectory(forceServer = true) {
  const entries = await Promise.all(
    ADMIN_OPERATOR_UIDS.map(async (uid) => {
      const [profile, access] = await Promise.all([
        getUserProfile(uid).catch(() => null),
        fetchAdminAccessState(uid, forceServer).catch(() => resolveAdminAccessState(uid)),
      ]);
      return {
        uid,
        profile,
        access: access || resolveAdminAccessState(uid),
      };
    })
  );
  return entries;
}

export async function updateAdminAccessState(uid, { role, active }) {
  const actingUser = auth.currentUser;
  if (!isSuperAdmin(actingUser)) {
    throw new Error("Only the super admin can manage admin access.");
  }
  if (!ADMIN_UIDS.has(uid)) {
    throw new Error("This UID is not part of the managed admin list.");
  }
  if (!VALID_ADMIN_ROLES.includes(role)) {
    throw new Error("Choose a valid admin role.");
  }

  await setDoc(
    getAdminAccessDocRef(uid),
    {
      uid,
      role,
      active: active !== false,
      updatedAt: serverTimestamp(),
      updatedBy: actingUser.uid,
    },
    { merge: true }
  );

  setAdminAccessCache(uid, {
    role,
    active: active !== false,
    updatedAt: new Date(),
    updatedBy: actingUser.uid,
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("admin-access-changed", {
        detail: {
          uid,
          state: resolveAdminAccessState(uid),
        },
      })
    );
  }

  return resolveAdminAccessState(uid);
}

const postsRef = collection(db, "posts");
const landmarksRef = collection(db, "landmarks");
const postReactionsRef = collection(db, "post_reactions");
const sharedLocationsRef = collection(db, "shared_locations");
const emergencyAlertsRef = collection(db, "emergency_alerts");
const adminActivityLogsRef = collection(db, "admin_activity_logs");
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

async function getCurrentAdminIdentity(user = auth.currentUser) {
  if (!user?.uid || !isAdmin(user)) return null;

  let profile = null;
  try {
    profile = await getUserProfile(user.uid);
  } catch (error) {
    console.warn("Could not load admin profile for activity log:", error);
  }

  return {
    uid: user.uid,
    email: profile?.email || user.email || null,
    name:
      profile?.username ||
      user.displayName ||
      (user.email ? user.email.split("@")[0] : getAdminRoleLabel(user)),
    role: getAdminRole(user),
  };
}

export async function logAdminActivity({
  actionType,
  targetType,
  targetId = null,
  targetLabel = null,
  summary = "",
} = {}) {
  const user = auth.currentUser;
  if (!user?.uid || user.isAnonymous || !isAdmin(user)) return null;

  const identity = await getCurrentAdminIdentity(user);
  if (!identity) return null;

  const trimmedActionType = String(actionType || "").trim();
  const trimmedTargetType = String(targetType || "").trim();
  if (!trimmedActionType || !trimmedTargetType) return null;

  return addDoc(adminActivityLogsRef, {
    actorUid: identity.uid,
    actorEmail: identity.email || null,
    actorName: identity.name,
    actorRole: identity.role,
    actionType: trimmedActionType,
    targetType: trimmedTargetType,
    targetId: targetId ? String(targetId) : null,
    targetLabel: targetLabel ? String(targetLabel).slice(0, 200) : null,
    summary: String(summary || "").slice(0, 2000),
    createdAt: serverTimestamp(),
  });
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
    debugLog("User count incremented");
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
  if (!user?.uid || user.isAnonymous || !canManageEmergencies(user)) {
    throw new Error("Emergency admin access is required to respond.");
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

  const targetLocation = await fetchSharedLocation(userId, false).catch(() => null);

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

  await logAdminActivity({
    actionType: "emergency_responded",
    targetType: "emergency",
    targetId: userId,
    targetLabel: targetLocation?.username || targetLocation?.email || userId,
    summary:
      normalizedStatus === "declined" && trimmedReason
        ? `Emergency response: ${normalizedStatus}. Reason: ${trimmedReason}`
        : `Emergency response: ${normalizedStatus}`,
  }).catch((error) => {
    console.warn("Failed to log emergency response:", error);
  });

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

export function observeAdminActivityLogs(callback) {
  const logsQuery = query(adminActivityLogsRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    logsQuery,
    (snapshot) => {
      const logs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(logs);
    },
    (error) => {
      console.warn("observeAdminActivityLogs error:", error);
      callback([]);
    }
  );
}

export async function fetchAdminActivityLogs(forceServer = true) {
  const logsQuery = query(adminActivityLogsRef, orderBy("createdAt", "desc"));
  const snapshot = forceServer ? await getDocsFromServer(logsQuery) : await getDocs(logsQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchPost(id, forceServer = true) {
  const docRef = doc(db, "posts", id);
  const snap = forceServer ? await getDocFromServer(docRef) : await getDoc(docRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function savePost({ id, title, content, media = [], author, authorId = null }) {
  const actingUser = auth.currentUser;
  if (isAdmin(actingUser) && !canManagePosts(actingUser)) {
    throw new Error("Your admin role cannot manage posts.");
  }
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
      if (isAdmin(actingUser)) {
        await logAdminActivity({
          actionType: "post_updated",
          targetType: "post",
          targetId: id,
          targetLabel: title,
          summary: `Updated post: ${title}`,
        }).catch((error) => console.warn("Failed to log post update:", error));
      }
      debugLog("Post updated:", id);
      return id;
    }
    const docRef = await addDoc(postsRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    if (isAdmin(actingUser)) {
      await logAdminActivity({
        actionType: "post_created",
        targetType: "post",
        targetId: docRef.id,
        targetLabel: title,
        summary: `Created post: ${title}`,
      }).catch((error) => console.warn("Failed to log post creation:", error));
    }
    debugLog("Post created:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Failed to save post:", error);
    throw error;
  }
}

export async function deletePost(id) {
  const actingUser = auth.currentUser;
  if (isAdmin(actingUser) && !canManagePosts(actingUser)) {
    throw new Error("Your admin role cannot delete posts.");
  }
  const existingPost = await fetchPost(id, false).catch(() => null);
  await deleteDoc(doc(db, "posts", id));
  if (isAdmin(actingUser)) {
    await logAdminActivity({
      actionType: "post_deleted",
      targetType: "post",
      targetId: id,
      targetLabel: existingPost?.title || id,
      summary: `Deleted post: ${existingPost?.title || id}`,
    }).catch((error) => console.warn("Failed to log post deletion:", error));
  }
}

export async function updatePostReactions(id, { likeDelta = 0, dislikeDelta = 0 }) {
  if (!id) return;

  debugLog("Updating reactions for post:", id, { likeDelta, dislikeDelta });

  const payload = {};
  if (likeDelta) payload.likes = increment(likeDelta);
  if (dislikeDelta) payload.dislikes = increment(dislikeDelta);
  if (!Object.keys(payload).length) return;

  try {
    await updateDoc(doc(db, "posts", id), payload);
    debugLog("Reactions updated for post:", id);
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
  const actingUser = auth.currentUser;
  if (!canManageLandmarks(actingUser)) {
    throw new Error("Your admin role cannot manage landmarks.");
  }
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
      if (isAdmin(actingUser)) {
        await logAdminActivity({
          actionType: "landmark_updated",
          targetType: "landmark",
          targetId: id,
          targetLabel: name,
          summary: `Updated landmark: ${name}`,
        }).catch((error) => console.warn("Failed to log landmark update:", error));
      }
      debugLog("Landmark updated:", id);
      return id;
    }
    const docRef = await addDoc(landmarksRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    if (isAdmin(actingUser)) {
      await logAdminActivity({
        actionType: "landmark_created",
        targetType: "landmark",
        targetId: docRef.id,
        targetLabel: name,
        summary: `Created landmark: ${name}`,
      }).catch((error) => console.warn("Failed to log landmark creation:", error));
    }
    debugLog("Landmark created:", docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Failed to save landmark:", error);
    throw error;
  }
}

export async function deleteLandmark(id) {
  const actingUser = auth.currentUser;
  if (!canManageLandmarks(actingUser)) {
    throw new Error("Your admin role cannot delete landmarks.");
  }
  const existingLandmark = await fetchLandmark(id, false).catch(() => null);
  await deleteDoc(doc(db, "landmarks", id));
  if (isAdmin(actingUser)) {
    await logAdminActivity({
      actionType: "landmark_deleted",
      targetType: "landmark",
      targetId: id,
      targetLabel: existingLandmark?.name || id,
      summary: `Deleted landmark: ${existingLandmark?.name || id}`,
    }).catch((error) => console.warn("Failed to log landmark deletion:", error));
  }
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
  debugLog("Firestore initialized. Run verifyFirestore() in console to test connection.");
}
