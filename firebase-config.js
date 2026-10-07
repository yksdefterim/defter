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

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export async function registerUser(name, email, password, alan) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { 
    displayName: name,
    photoURL: alan 
  });
  return credential.user;
}

export async function loginUser(email, password) {
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
  return docRef.id;
}

export function deleteDeneme(userId, denemeId) {
  return deleteDoc(doc(db, "users", userId, "denemeler", denemeId));
}

export function updateDenemeAiNote(userId, denemeId, aiAnalizNotu) {
  return updateDoc(doc(db, "users", userId, "denemeler", denemeId), { aiAnalizNotu });
}

// İndex çakışmalarını önlemek için sorgu sadeleştirildi, sıralama JS tarafına alındı
export function watchDenemeler(userId, callback) {
  const q = query(denemelerRef(userId));
  return onSnapshot(q, (snapshot) => {
    const denemeler = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    // Tarihe göre kronolojik sıralama
    denemeler.sort((a, b) => (a.tarih || "").localeCompare(b.tarih || ""));
    callback(denemeler);
  });
}
