import { auth, loginUser, registerUser, logoutUser, watchAuthState, ensureProfile, resetPassword } from './firebase-config.js';
import { $, showToast, errorMessage, flash, consumeFlash, recordEvent } from './ui.js';
import { initThemedSelect } from './controls.js';

const admin = document.body.dataset.page === 'admin-login';
let busy = false;
initThemedSelect($('registerAlan'));
function showAuth(mode = 'login') {
  if ($('landingPage')) $('landingPage').hidden = true;
  $('authOverlay').hidden = false;
  if (!$('registerForm')) return;
  $('loginForm').hidden = mode !== 'login'; $('registerForm').hidden = mode === 'login';
  $('authTabLogin').classList.toggle('is-active', mode === 'login');
  $('authTabRegister').classList.toggle('is-active', mode !== 'login');
  $('authTabLogin').setAttribute('aria-selected', String(mode === 'login'));
  $('authTabRegister').setAttribute('aria-selected', String(mode !== 'login'));
  $('authError').hidden = true;
  $(mode === 'login' ? 'loginEmail' : 'registerName').focus();
}
['landingTopLoginBtn', 'landingFooterLoginBtn'].forEach(id => $(id)?.addEventListener('click', () => showAuth()));
$('landingHeroLoginBtn')?.addEventListener('click', () => showAuth('register'));
$('authTabLogin')?.addEventListener('click', () => showAuth());
$('authTabRegister')?.addEventListener('click', () => showAuth('register'));
$('authBackToLanding')?.addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); $('landingPage').hidden = false; $('authOverlay').hidden = true; });
async function destination(user, message) {
  const profile = await ensureProfile(user);
  if (profile.status !== 'active') { await logoutUser(); throw new Error('Bu hesap dondurulmuş. Yöneticiyle iletişime geç.'); }
  if (admin && !(await user.getIdTokenResult(true)).claims.admin) { await logoutUser(); throw new Error('Bu hesapta yönetici yetkisi bulunmuyor.'); }
  if (message) flash(message);
  location.replace(admin ? 'adpanel.html' : 'kullanici.html');
}
async function submit(form, operation) {
  if (busy || !form.reportValidity()) return;
  busy = true; const button = form.querySelector('[type=submit]'); button.disabled = true;
  $('authError').hidden = true;
  try { await operation(); }
  catch (error) { $('authError').textContent = errorMessage(error); $('authError').hidden = false; showToast(errorMessage(error), 'error'); }
  finally { busy = false; button.disabled = false; }
}
$('loginForm').addEventListener('submit', e => {
  e.preventDefault(); submit(e.currentTarget, async () => {
    const user = await loginUser($('loginEmail').value.trim(), $('loginPassword').value, $('rememberMe').checked);
    await ensureProfile(user);
    if (!admin) await recordEvent('login');
    await destination(user, 'Başarıyla giriş yaptın.');
  });
});
$('registerForm')?.addEventListener('submit', e => {
  e.preventDefault(); submit(e.currentTarget, async () => {
    const name = $('registerName').value.trim().replace(/\s+/g, ' ');
    if (name.split(' ').length < 2) throw new Error('Adını ve soyadını birlikte gir.');
    const user = await registerUser(name, $('registerEmail').value.trim(), $('registerPassword').value, $('registerAlan').value);
    await destination(user, 'Hesabın oluşturuldu. Defter’e hoş geldin!');
  });
});
$('forgotPassword').addEventListener('click', async () => {
  const input = $('loginEmail');
  if (!input.value || !input.reportValidity()) { input.focus(); showToast('Önce e-posta adresini gir.', 'info'); return; }
  const button = $('forgotPassword'); button.disabled = true;
  try { await resetPassword(input.value.trim()); showToast('Adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.', 'success'); }
  catch (error) { showToast(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
});
watchAuthState(user => { if (user && !busy) destination(user).catch(error => { $('authError').textContent = errorMessage(error); $('authError').hidden = false; }); });
consumeFlash();
if (!admin) recordEvent('visit');

// Public feature pages and footer CTAs open the appropriate form.
function openLinkedForm() {
  if (admin) return;
  if (location.hash === '#kayit') showAuth('register');
  else if (location.hash === '#giris') showAuth('login');
}
window.addEventListener('hashchange', openLinkedForm);
openLinkedForm();
