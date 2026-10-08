// ============================================================
// firebase-config.js
// Firebase Modüler Yapılandırması (İndex hatası giderildi)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  serverTimestamp,
  getDoc, getDocs, setDoc, runTransaction,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3-iXxt6n4UPi_2pbJb1yAoCWtlY-2jUU",
  authDomain: "ykstakip-ab10a.firebaseapp.com",
  projectId: "ykstakip-ab10a",
  storageBucket: "ykstakip-ab10a.firebasestorage.app",
  messagingSenderId: "96302189389",
  appId: "1:96302189389:web:6c844535e28f95b97e0504",
  measurementId: "G-M17E2CFG7C",
};

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const emulatorOption = new URLSearchParams(location.search).get('emulator');
if (local && emulatorOption !== null) sessionStorage.setItem('defter-emulator', emulatorOption === '1' ? '1' : '0');
export const useEmulators = local && sessionStorage.getItem('defter-emulator') === '1';
export const firebaseApp = initializeApp(useEmulators ? { apiKey: 'demo-key', projectId: 'demo-defter', authDomain: 'demo-defter.firebaseapp.com' } : firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
export { doc, collection, onSnapshot, getDoc, updateDoc, serverTimestamp, query, getDocs, setDoc, runTransaction };

export async function ensureProfile(user, initial = {}) {
  const ref = doc(db, 'users', user.uid);
  await runTransaction(db, async transaction => {
    if ((await transaction.get(ref)).exists()) return;
    transaction.set(ref, {
      name: initial.name || user.displayName || user.email.split('@')[0], email: user.email,
      alan: initial.alan || (['sayisal', 'ea', 'sozel', 'dil'].includes(user.photoURL) ? user.photoURL : 'sayisal'),
      phone: '', school: '', address: '', status: 'active', createdAt: serverTimestamp(),
    });
  });
  const profile = (await getDoc(ref)).data();
  await syncActivity(user, profile).catch(reportTrackingError);
  return profile;
}

export async function saveProfile(user, values) {
  const ref = doc(db, 'users', user.uid);
  await runTransaction(db, async transaction => {
    const saved = (await transaction.get(ref)).data();
    if (saved.phone && values.phone !== saved.phone) throw new Error('Telefon numarası değiştirilemez.');
    transaction.update(ref, { name: values.name, alan: values.alan, phone: values.phone, school: values.school, address: values.address });
  });
  await updateProfile(user, { displayName: values.name });
  await syncActivity(user).catch(reportTrackingError);
}

export async function changePassword(user, currentPassword, nextPassword) {
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, nextPassword);
}
export const resetPassword = email => sendPasswordResetEmail(auth, email);

export async function registerUser(name, email, password, alan) {
  await setPersistence(auth, browserSessionPersistence);
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { 
    displayName: name,
  });
  await ensureProfile(credential.user, { name, alan });
  return credential.user;
}

export async function loginUser(email, password, remember = false) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export function logoutUser() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

function denemelerRef(userId) {
  return collection(db, "users", userId, "denemeler");
}

export async function addDeneme(userId, denemeData) {
  const ref = denemelerRef(userId);
  const docRef = await addDoc(ref, {
    ...denemeData,
    olusturmaZamani: serverTimestamp(),
  });
  await trackActivity('firstAction', 'new-entry').catch(reportTrackingError);
  return docRef.id;
}

export function deleteDeneme(userId, denemeId) {
  return deleteDoc(doc(db, "users", userId, "denemeler", denemeId));
}

export function updateDenemeAiNote(userId, denemeId, aiAnalizNotu) {
  return updateDoc(doc(db, "users", userId, "denemeler", denemeId), { aiAnalizNotu });
}

// İndex çakışmalarını önlemek için sorgu sadeleştirildi, sıralama JS tarafına alındı
export function watchDenemeler(userId, callback, onError = console.error) {
  const q = query(denemelerRef(userId));
  return onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    const denemeler = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    // Tarihe göre kronolojik sıralama
    denemeler.sort((a, b) => (a.tarih || "").localeCompare(b.tarih || ""));
    callback(denemeler);
    if (!snapshot.metadata.hasPendingWrites && !snapshot.metadata.fromCache && auth.currentUser?.uid === userId) {
      syncActivity(auth.currentUser, null, denemeler).catch(reportTrackingError);
    }
  }, onError);
}

// Only metadata is shared with the administrator; scores stay in the owner's collection.
export function reportTrackingError(error) {
  console.warn('İstatistik kaydı güncellenemedi:', error.code || error.message);
  window.dispatchEvent(new CustomEvent('tracking-error'));
}
export async function syncActivity(user, profile = null, exams = null) {
  profile ||= (await getDoc(doc(db, 'users', user.uid))).data();
  if (!profile || profile.status !== 'active') return;
  const isAdmin = Boolean((await user.getIdTokenResult()).claims.admin);
  if (!exams) exams = (await getDocs(collection(db, 'users', user.uid, 'denemeler'))).docs.map(d => d.data());
  const times = exams.map(e => e.olusturmaZamani).filter(t => t?.toMillis).sort((a,b) => a.toMillis() - b.toMillis());
  await setDoc(doc(db, 'userActivity', user.uid), {
    name: profile.name, email: profile.email, status: profile.status,
    createdAt: profile.createdAt, admin: isAdmin, examCount: exams.length,
    firstExamAt: times[0] || null, lastExamAt: times.at(-1) || null,
  }, { merge: true });
}
export async function trackActivity(kind, action) {
  const user = auth.currentUser;
  if (!user || kind === 'visit') return;
  if ((await user.getIdTokenResult()).claims.admin) return;
  if (kind === 'login') {
    await setDoc(doc(db, 'activityEvents', crypto.randomUUID()), {
      uid: user.uid, kind: 'login', at: serverTimestamp(),
    });
  } else if (kind === 'firstAction' && ['new-entry','analiz','history','profile','dashboard'].includes(action)) {
    const ref = doc(db, 'userActivity', user.uid);
    await runTransaction(db, async tx => {
      const saved = await tx.get(ref);
      if (saved.exists() && !saved.data().firstAction) tx.update(ref, { firstAction: action });
    });
  }
}
