import { auth, applyActionCode, checkActionCode, verifyPasswordResetCode, confirmPasswordReset } from './firebase-config.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode'), code = params.get('oobCode');
const title = document.getElementById('actionTitle'), message = document.getElementById('actionMessage');
const symbol = document.getElementById('actionSymbol'), login = document.getElementById('actionLogin');
const form = document.getElementById('resetForm');
function display(heading, copy, success) {
  title.textContent = heading; message.textContent = copy;
  symbol.classList.toggle('is-error', !success);
  symbol.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${success ? '<path d="m5 12 4 4L19 6"/>' : '<path d="m6 6 12 12M6 18 18 6"/>'}</svg>`;
  login.hidden = false;
}
function fail(error) {
  const network = error.code === 'auth/network-request-failed';
  display(network ? 'Bağlantı kurulamadı' : 'Bu bağlantı kullanılamıyor', network
    ? 'İnternet bağlantını kontrol edip bu sayfayı yeniden yükle.'
    : 'Bağlantının süresi dolmuş, daha önce kullanılmış veya geçersiz olabilir. Daha önce doğruladıysan giriş yapabilirsin; aksi halde giriş ekranından yeni bir bağlantı iste.', false);
}
async function run() {
  if (!code || !['verifyEmail', 'resetPassword', 'recoverEmail'].includes(mode)) { fail({}); return; }
  try {
    if (mode === 'resetPassword') {
      await verifyPasswordResetCode(auth, code);
      title.textContent = 'Yeni şifreni belirle'; message.textContent = 'Hesabın için başka bir yerde kullanmadığın bir şifre seç.';
      symbol.hidden = true; form.hidden = false;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const password = document.getElementById('newPassword'), repeat = document.getElementById('confirmPassword');
        const error = document.getElementById('resetError'), button = form.querySelector('button');
        error.hidden = true;
        if (password.value !== repeat.value) { error.textContent = 'Şifreler eşleşmiyor.'; error.hidden = false; return; }
        button.disabled = true;
        try {
          await confirmPasswordReset(auth, code, password.value);
          form.reset(); form.hidden = true; symbol.hidden = false;
          history.replaceState(null, '', location.pathname);
          display('Şifren güncellendi', 'Yeni şifrenle hesabına giriş yapabilirsin.', true);
        } catch (err) {
          error.textContent = err.code === 'auth/weak-password' ? 'Daha güçlü bir şifre seç; en az 6 karakter kullan.' : 'Şifre güncellenemedi. Bağlantıyı ve internet bağlantını kontrol et; gerekirse yeni bir sıfırlama e-postası iste.';
          error.hidden = false;
        } finally { button.disabled = false; }
      });
      return;
    }
    const action = await checkActionCode(auth, code);
    const expected = mode === 'verifyEmail' ? 'VERIFY_EMAIL' : 'RECOVER_EMAIL';
    if (action.operation !== expected) { fail({}); return; }
    await applyActionCode(auth, code);
    history.replaceState(null, '', location.pathname);
    display(mode === 'verifyEmail' ? 'E-posta adresin doğrulandı' : 'E-posta adresin geri alındı', mode === 'verifyEmail'
      ? 'E-posta adresin başarıyla doğrulandı. Hesabına dönebilir veya aşağıdan giriş yapabilirsin. Açık olan Defter panelin doğrulamayı otomatik algılayacak.'
      : 'Önceki e-posta adresin geri yüklendi. Hesabının güvenliği için giriş ekranından şifreni sıfırlamanı öneririz.', true);
  } catch (error) { fail(error); }
}
void run();
