import { auth, db, doc, onSnapshot, ensureProfile, watchAuthState, logoutUser, trackActivity, reportTrackingError } from './firebase-config.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { firebaseApp, useEmulators } from './firebase-config.js';
import { confirmLogout } from './controls.js';

let loggingOut = false;

const functions = getFunctions(firebaseApp, 'europe-west1');
if (useEmulators) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
export const callServer = async (name, data = {}) => (await httpsCallable(functions, name)(data)).data;
export const $ = id => document.getElementById(id);
export const alanNames = { sayisal: 'Sayısal', ea: 'Eşit Ağırlık', sozel: 'Sözel', dil: 'Dil' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = { check: '<path d="m5 12 4 4L19 6"/>', error: '<path d="m6 6 12 12M6 18 18 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>', logout: '<path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>' };
export const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
export function showToast(message, type = 'info', duration = 4500) {
  const toast = document.createElement('div');
  toast.className = `toast is-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = icon(type === 'success' ? 'check' : type === 'error' ? 'error' : 'info');
  const copy = document.createElement('span'); copy.textContent = message; toast.append(copy);
  $('toastStack')?.append(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}
export function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'E-posta veya şifre hatalı.', 'auth/wrong-password': 'Şifre hatalı.',
    'auth/user-not-found': 'E-posta veya şifre hatalı.', 'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı.',
    'auth/invalid-email': 'Geçerli bir e-posta adresi gir.', 'auth/weak-password': 'Şifren en az 6 karakter olmalı.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
    'auth/network-request-failed': 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.',
    'auth/user-disabled': 'Bu hesap dondurulmuş. Yöneticiyle iletişime geç.',
    'permission-denied': 'Bu işlem için erişim izni yok.',
    'functions/unavailable': 'Yönetim hizmetine ulaşılamıyor. Firebase kurulumunu kontrol et.',
  };
  return messages[error.code] || error.message || 'İşlem tamamlanamadı. Lütfen tekrar dene.';
}
export function flash(message) { sessionStorage.setItem('defter-flash', message); }
export function consumeFlash() { const message = sessionStorage.getItem('defter-flash'); if (message) { sessionStorage.removeItem('defter-flash'); showToast(message, 'success'); } }
let trackingWarningShown = false;
window.addEventListener('tracking-error', () => {
  if (trackingWarningShown) return;
  trackingWarningShown = true;
  showToast('İstatistikler kaydedilemedi. Firestore kurallarının güncel olduğunu kontrol et.', 'error');
});
export async function recordEvent(kind, action) {
  try { await trackActivity(kind, action); }
  catch (error) { reportTrackingError(error); }
}
export function initChrome() {
  document.querySelectorAll('.field-group').forEach(group => {
    const label = group.querySelector('label'), control = group.querySelector('input[id],select[id],textarea[id]');
    if (label && control) label.htmlFor = control.id;
  });
  const button = $('menuToggle'), backdrop = $('menuBackdrop');
  const close = () => { document.body.classList.remove('menu-open'); button?.setAttribute('aria-expanded', 'false'); };
  if (button) button.innerHTML = icon('menu');
  button?.addEventListener('click', () => { const open = document.body.classList.toggle('menu-open'); button.setAttribute('aria-expanded', String(open)); });
  backdrop?.addEventListener('click', close);
  document.querySelectorAll('.sidebar a, .sidebar button').forEach(item => item.addEventListener('click', close));
  const trigger = $('userMenuTrigger'), menu = $('userMenu');
  const closeUser = () => { if (menu) menu.hidden = true; trigger?.setAttribute('aria-expanded', 'false'); };
  trigger?.addEventListener('click', () => { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!e.target.closest('.topbar__user')) closeUser(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); closeUser(); } });
  $('logoutBtn')?.addEventListener('click', async () => {
    if (loggingOut || !await confirmLogout()) return;
    loggingOut = true;
    try { await logoutUser(); location.replace('index.html'); }
    catch (e) { loggingOut = false; showToast(errorMessage(e), 'error'); }
  });
  consumeFlash();
}
export function renderIdentity(user, profile) {
  if ($('userDisplayName')) $('userDisplayName').textContent = profile.name || user.displayName || 'Öğrenci';
  if ($('userDisplayAlan')) $('userDisplayAlan').textContent = alanNames[profile.alan] || 'Sayısal';
  if ($('userAvatarInitial')) $('userAvatarInitial').textContent = (profile.name || 'Ö').charAt(0).toLocaleUpperCase('tr');
}
export function requireUser(callback, admin = false) {
  let unsubscribe, generation = 0;
  watchAuthState(async user => {
    const current = ++generation;
    unsubscribe?.(); unsubscribe = null;
    if (!user) { if (!loggingOut) location.replace(admin ? 'adgiris.html' : 'index.html'); return; }
    try {
      if (admin && !(await user.getIdTokenResult(true)).claims.admin) { await logoutUser(); flash('Bu hesapta yönetici yetkisi bulunmuyor.'); location.replace('adgiris.html'); return; }
      await ensureProfile(user);
      if (current !== generation) return;
      unsubscribe = onSnapshot(doc(db, 'users', user.uid), async snapshot => {
        if (current !== generation) return;
        const profile = snapshot.data();
        if (!profile || profile.status !== 'active') { await logoutUser(); location.replace('index.html'); return; }
        $('sessionLoading').hidden = true;
        $('appShell').hidden = false;
        renderIdentity(user, profile); callback(user, profile);
      }, error => sessionError(error));
    } catch (error) { sessionError(error); }
  });
}
function sessionError(error) {
  $('sessionLoading').hidden = false;
  $('sessionLoading').textContent = 'Oturum doğrulanamadı. Bağlantını ve Firebase erişim kurallarını kontrol edip sayfayı yenile.';
  if ($('appShell')) $('appShell').hidden = true;
  showToast(errorMessage(error), 'error');
}
