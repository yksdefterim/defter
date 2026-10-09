import { auth, getVerificationAccess, refreshVerification, sendVerificationEmail, logoutUser } from './firebase-config.js';
import { confirmLogout } from './controls.js';

let currentDialog;
let currentUserId, closeCurrentDialog;
const deadlines = new Map();
const keyFor = user => `defter-verification-resend:${user.uid}`;
function deadline(user) {
  try { return Math.max(deadlines.get(user.uid) || 0, Number(localStorage.getItem(keyFor(user))) || 0); }
  catch { return deadlines.get(user.uid) || 0; }
}
function beginCooldown(user) {
  const until = Date.now() + 30000;
  deadlines.set(user.uid, until);
  try { localStorage.setItem(keyFor(user), String(until)); } catch {}
}
export function verificationError(error) {
  return ({
    'auth/too-many-requests': 'Çok fazla gönderim isteği yapıldı. Bir süre bekleyip tekrar dene.',
    'auth/network-request-failed': 'İnternet bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.',
    'auth/unauthorized-continue-uri': 'E-posta gönderilemedi. Site adresinin Firebase yetkili alan adlarına eklenmesi gerekiyor.',
    'auth/invalid-continue-uri': 'E-posta gönderilemedi. Doğrulama dönüş adresi ayarını kontrol et.',
    'auth/user-token-expired': 'Oturumun sona erdi. Yeniden giriş yapıp e-posta iste.',
    'auth/user-disabled': 'Hesabın devre dışı bırakılmış. Site yöneticisiyle iletişime geç.',
  })[error.code] || 'İşlem tamamlanamadı. Biraz sonra yeniden dene.';
}

export function openVerificationDialog(user, { blocking = false, autoSend = false } = {}) {
  if (auth.currentUser?.uid !== user.uid) return Promise.resolve('signed-out');
  if (currentDialog && currentUserId === user.uid) return currentDialog;
  closeCurrentDialog?.('signed-out');
  currentUserId = user.uid;
  currentDialog = new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'logout-dialog verification-dialog';
    dialog.setAttribute('aria-labelledby', 'verificationTitle');
    dialog.setAttribute('aria-describedby', 'verificationDescription');
    dialog.innerHTML = `<div class="verification-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></div><span class="eyebrow">HESABININ SON ADIMI</span><h2 id="verificationTitle">E-posta adresini doğrula</h2><p id="verificationDescription">${blocking ? 'Denemelerini eklemeye devam etmek için e-posta adresini doğrulaman gerekiyor.' : 'Giriş yapabilmek için e-posta adresini doğrulaman gerekiyor.'}</p><p class="verification-address"></p><p class="verification-status" role="status" aria-live="polite"></p><p class="verification-error" role="alert" hidden></p><div class="verification-tip"><strong>Maili bulamadın mı?</strong><p>Spam / Gereksiz ve Promosyonlar klasörlerini kontrol et. En son gönderilen bağlantıyı kullan. E-postanın ulaşması birkaç dakika sürebilir.</p></div><div class="verification-actions"><button type="button" class="btn-neo btn-neo--primary verification-send">Doğrulama e-postası gönder</button><button type="button" class="text-button verification-check">Doğruladım, kontrol et</button>${blocking ? '<button type="button" class="text-button verification-exit">Hesaptan çık</button>' : '<button type="button" class="btn-neo verification-done">Tamam</button>'}</div><p class="verification-footnote">Bağlantıyı açtıktan sonra bu sayfaya dön. Doğrulamanı otomatik olarak kontrol edeceğiz.</p>`;
    const find = selector => dialog.querySelector(selector);
    find('.verification-address').textContent = user.email || '';
    const sendButton = find('.verification-send'), checkButton = find('.verification-check');
    const status = find('.verification-status'), error = find('.verification-error');
    let sending = false, checking = false, closed = false, lastCheck = 0, sent = deadline(user) > Date.now();
    if (sent) status.textContent = 'Yakın zamanda bir gönderim isteği yapıldı. E-postanı kontrol edebilir veya sayaç bitince yeniden deneyebilirsin.';
    const connection = document.createElement('p');
    connection.className = 'verification-connection'; connection.setAttribute('role', 'status');
    status.before(connection);
    function tick() {
      if (closed) return;
      if (auth.currentUser?.uid !== user.uid) { finish('signed-out'); return; }
      const seconds = Math.max(0, Math.ceil((deadline(user) - Date.now()) / 1000));
      const offline = navigator.onLine === false;
      connection.textContent = offline ? 'İnternet bağlantısı yok. Bağlantı geldiğinde doğrulama kontrolü devam edecek.' : '';
      connection.hidden = !offline;
      sendButton.disabled = sending || checking || seconds > 0 || offline;
      checkButton.disabled = sending || checking || offline;
      checkButton.textContent = checking ? 'Kontrol ediliyor…' : 'Doğruladım, kontrol et';
      dialog.setAttribute('aria-busy', String(sending || checking));
      if (find('.verification-done')) find('.verification-done').disabled = sending;
      if (find('.verification-exit')) find('.verification-exit').disabled = sending;
      sendButton.textContent = sending ? 'Gönderiliyor…' : seconds > 0 ? `Tekrar gönder (${seconds} sn)` : sent ? 'Tekrar gönder' : 'Doğrulama e-postası gönder';
    }
    function finish(result) {
      if (closed) return; closed = true;
      clearInterval(ticker); clearInterval(poller);
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('storage', tick);
      window.removeEventListener('online', onFocus); window.removeEventListener('offline', tick);
      dialog.close(); dialog.remove(); currentDialog = null; currentUserId = null; closeCurrentDialog = null; resolve(result);
    }
    closeCurrentDialog = finish;
    async function check(manual = false) {
      if (closed || checking || sending || navigator.onLine === false || auth.currentUser?.uid !== user.uid) return;
      if (!manual && (document.hidden || Date.now() - lastCheck < 4000)) return;
      checking = true; lastCheck = Date.now(); tick();
      try {
        const verified = await refreshVerification(user);
        if (closed || auth.currentUser?.uid !== user.uid) return;
        if (verified) { finish('verified'); return; }
        error.hidden = true;
        if (manual) { status.textContent = 'Henüz doğrulama görünmüyor. E-postandaki bağlantıya tıklayıp yeniden kontrol et.'; error.hidden = true; }
      } catch (err) { if (!closed) { error.textContent = verificationError(err); error.hidden = false; } }
      finally { checking = false; tick(); }
    }
    async function send() {
      if (sending || checking || closed || navigator.onLine === false) return;
      sending = true; tick();
      const execute = async () => {
        if (closed || auth.currentUser?.uid !== user.uid || deadline(user) > Date.now()) return;
        beginCooldown(user); tick(); error.hidden = true;
        try {
          if (await getVerificationAccess(user, true) === 'ready') { await refreshVerification(user); finish('verified'); return; }
          if (closed || auth.currentUser?.uid !== user.uid) return;
          await sendVerificationEmail(user);
          if (closed) return;
          sent = true; status.textContent = 'Doğrulama bağlantısı gönderildi. Giriş yapmak için e-postandaki bağlantıyı onayla.';
          find('#verificationTitle').textContent = 'E-postanı kontrol et';
        } catch (err) { error.textContent = verificationError(err); error.hidden = false; status.textContent = 'Yeni bir doğrulama e-postası gönderilemedi.'; }
      };
      try {
        if (navigator.locks?.request) await navigator.locks.request(keyFor(user), execute); else await execute();
      } catch (err) { if (!closed) { error.textContent = verificationError(err); error.hidden = false; } }
      finally { sending = false; tick(); }
    }
    function onFocus() { tick(); if (!document.hidden) { lastCheck = 0; void check(); } }
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!blocking && !sending) finish('dismissed'); });
    sendButton.addEventListener('click', () => { void send(); });
    checkButton.addEventListener('click', () => { void check(true); });
    find('.verification-done')?.addEventListener('click', () => finish('dismissed'));
    find('.verification-exit')?.addEventListener('click', async () => {
      if (!await confirmLogout()) return;
      try { await logoutUser(); finish('signed-out'); location.replace('index.html#giris'); }
      catch (err) { error.textContent = verificationError(err); error.hidden = false; }
    });
    const ticker = setInterval(tick, 250), poller = setInterval(() => { void check(); }, 5000);
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus); window.addEventListener('storage', tick);
    window.addEventListener('online', onFocus); window.addEventListener('offline', tick);
    document.body.append(dialog); dialog.showModal(); tick();
    if (autoSend) void send();
  });
  return currentDialog;
}
