import { aggregateActivity, dayKey } from './analytics.js';
import { db, collection, onSnapshot } from './firebase-config.js';
import { $, requireUser, initChrome, callServer, showToast, errorMessage, escapeHtml } from './ui.js';

initChrome();
let started = false, users = [], days = [], metrics = {}, charts = {}, events = [], summaries = [], summariesReady = false, eventsReady = false;
const number = n => Number(n || 0).toLocaleString('tr-TR');
const date = value => value?.toDate ? value.toDate().toLocaleDateString('tr-TR') : '—';
const titles = { overview: 'Genel izlenim', users: 'Kayıt olan kullanıcılar', data: 'Loglar' };
document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-admin-view]').forEach(item => item.classList.toggle('is-active', item === button));
  document.querySelectorAll('main .view').forEach(view => view.classList.toggle('is-active', view.id === 'admin-' + button.dataset.adminView));
  $('adminTitle').textContent = titles[button.dataset.adminView];
  requestAnimationFrame(() => Object.values(charts).forEach(chart => chart.resize()));
}));
function report(error) { $('adminError').hidden = false; $('adminError').textContent = 'Veriler yüklenemedi: ' + errorMessage(error) + ' Firestore kurallarını yayımlayıp sayfayı yenile.'; }
requireUser(() => {
  $('userDisplayAlan').textContent = 'Yönetici';
  if (started) return; started = true;
  onSnapshot(collection(db, 'userActivity'), snapshot => { summariesReady = true; summaries = snapshot.docs.map(d => ({ id: d.id, ...d.data() })); rebuildMetrics(); }, report);
  onSnapshot(collection(db, 'activityEvents'), snapshot => { eventsReady = true; events = snapshot.docs.map(d => d.data()); rebuildMetrics(); }, report);
}, true);
function chart(id, type, labels, datasets) {
  if (!globalThis.Chart) { report(new Error('Grafik kitaplığı yüklenemedi.')); return; }
  const colors = ['#c7d6a8', '#8fc2af', '#d3ac7e', '#b1acc9', '#95b6c0', '#687b65'];
  datasets = datasets.map((data, i) => ({ ...data, borderColor: colors[i % colors.length], backgroundColor: type === 'doughnut' ? colors : colors[i % colors.length] + '50', borderWidth: 2, tension: .35 }));
  const canvas = $(id);
  const summary = labels.map((label, index) => `${label}: ${datasets.map(set => `${set.label || 'Hesap'} ${set.data[index] || 0}`).join(', ')}`).join('; ');
  canvas.setAttribute('aria-label', summary || 'Henüz grafik verisi yok');
  if (type === 'doughnut') {
    let legend = $(id + 'Legend');
    if (!legend) { legend = document.createElement('ul'); legend.id = id + 'Legend'; legend.className = 'chart-legend'; canvas.parentElement.after(legend); }
    legend.innerHTML = labels.map((label,i) => `<li><span class="legend-dot" style="background:${colors[i % colors.length]}" aria-hidden="true"></span>${escapeHtml(label)} <strong>${number(datasets[0].data[i])}</strong></li>`).join('');
    let empty = $(id + 'Empty');
    if (!empty) { empty = document.createElement('span'); empty.id = id + 'Empty'; empty.className = 'chart-empty'; empty.textContent = 'Henüz gösterilecek işlem yok.'; canvas.after(empty); }
    empty.hidden = datasets[0].data.some(value => value > 0);
  }
  const options = { responsive: true, maintainAspectRatio: false, animation: !matchMedia('(prefers-reduced-motion: reduce)').matches, cutout: '66%', plugins: { legend: { display: type !== 'doughnut', position: 'bottom', labels: { color: '#b7c5ac', boxWidth: 10, padding: 16, font: { size: 11 } } }, tooltip: { backgroundColor: '#172d21', titleColor: '#eef0df', bodyColor: '#d5dec8', padding: 12, cornerRadius: 8 } }, scales: type === 'doughnut' ? {} : { x: { ticks: { color: '#b1c1a5', maxTicksLimit: 5, maxRotation: 0, font: { size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#b1c1a5', precision: 0, font: { size: 10 } }, grid: { color: '#c0d0a510' } } } };
  if (charts[id]) { charts[id].data = { labels, datasets }; charts[id].options = options; charts[id].update(); return; }
  charts[id] = new Chart(canvas, { type, data: { labels, datasets }, options });
}
function rebuildMetrics() {
  if (!summariesReady || !eventsReady) return;
  ({ users, days, metrics } = aggregateActivity(summaries, events));
  renderUsers(); renderMetrics();
}
function renderMetrics() {
  const today = dayKey(new Date()); const month = today.slice(0, 7);
  const todayData = days.find(d => d.id === today) || {};
  const monthData = days.filter(d => d.id.startsWith(month));
  const exams = users.filter(u => !u.admin).reduce((sum, user) => sum + Math.max(0, user.examCount || 0), 0);
  const students = users.filter(u => !u.admin);
  const active = students.filter(u => u.status === 'active').length;
  const withExam = students.filter(u => u.examCount > 0).length;
  const returned = students.filter(u => u.loginCount > 0).length;
  const cards = [
    ['Bugünkü giriş', todayData.visits, 'Başarılı öğrenci girişleri'], ['Bu ay giriş', monthData.reduce((n,d) => n + (d.visits || 0), 0), 'Tekrarlanan girişler dahil'],
    ['Kayıtlı hesap', students.length, 'Yöneticiler hariç'], ['Aktif hesap', active, 'Dondurulmamış öğrenci hesapları'],
    ['Bugün yeni kayıt', todayData.registrations, 'Yöneticiler hariç'], ['Bu ay yeni kayıt', monthData.reduce((n,d) => n + (d.registrations || 0),0), 'Aylık yeni öğrenci hesapları'],
    ['Bu yıl giriş', days.filter(d => d.id.startsWith(today.slice(0,4))).reduce((n,d) => n + d.visits, 0), 'Yıllık başarılı girişler'],
    ['Kayıtlı deneme', exams, 'Net bilgisi içermez'], ['Geri dönen hesap', returned, 'Kayıttan sonra giriş yapan'],
  ];
  $('adminStats').innerHTML = cards.map(([label, value, sub]) => `<div class="stat-card"><span class="stat-card__title">${label}</span><strong class="stat-card__value">${number(value)}</strong><span class="stat-card__sub">${sub}</span></div>`).join('');
  const daily = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 29 + i); const key = dayKey(d); return { key, ...(days.find(x => x.id === key) || {}) }; });
  chart('dailyChart', 'line', daily.map(d => d.key.slice(5).replace('-', '/')), [{ label: 'Ba\u015far\u0131l\u0131 giri\u015f', data: daily.map(d => d.visits || 0) }, { label: 'Kayıt', data: daily.map(d => d.registrations || 0) }]);
  const monthKeys = Array.from({ length: 6 }, (_, i) => { const [y,m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 6 + i, 1)).toISOString().slice(0,7); });
  chart('monthlyChart', 'bar', monthKeys, [{ label: 'Ba\u015far\u0131l\u0131 giri\u015f', data: monthKeys.map(key => days.filter(d => d.id.startsWith(key)).reduce((n,d) => n + (d.visits || 0),0)) }, { label: 'Kayıt', data: monthKeys.map(key => days.filter(d => d.id.startsWith(key)).reduce((n,d) => n + (d.registrations || 0),0)) }]);
  const percent = count => students.length ? Math.round(count / students.length * 100) + '%' : '—';
  $('funnelMetrics').innerHTML = [[percent(withExam), 'Deneme ekleme oranı', `${number(withExam)} / ${number(students.length)} hesap`], [percent(returned), 'Tekrar giriş oranı', `${number(returned)} / ${number(students.length)} hesap`], [number(metrics.logins), 'Toplam açık giriş', 'Otomatik oturum açılışları hariç']].map(([value,label,sub]) => `<div><strong>${value}</strong><span>${label}</span><small>${sub}</small></div>`).join('');
  const actions = { 'new-entry': 'Yeni deneme', analiz: 'Analiz', history: 'Geçmiş', profile: 'Bilgilerim', dashboard: 'Genel bakış' };
  const counts = Object.keys(actions).map(key => students.filter(u => u.firstAction === key).length);
  chart('firstActionChart', 'doughnut', [...Object.values(actions), 'Henüz işlem yok'], [{ data: [...counts, students.filter(u => !u.firstAction).length] }]);
  $('adminUpdated').textContent = 'Son güncelleme: ' + new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' });
}
$('userSearch').addEventListener('input', renderUsers);
function renderUsers() {
  const search = $('userSearch').value.toLocaleLowerCase('tr');
  const filtered = users.filter(u => `${u.name} ${u.email}`.toLocaleLowerCase('tr').includes(search)).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  const opened = new Set([...document.querySelectorAll('.admin-user[open]')].map(el => el.dataset.uid));
  $('userCount').textContent = `${number(filtered.length)} hesap`;
  $('adminUsers').innerHTML = filtered.length ? filtered.map(u => {
    const count = Math.max(0, u.examCount || 0);
    const interval = u.firstExamAt?.toMillis && u.lastExamAt?.toMillis && count > 1 ? Math.max(1, Math.round((u.lastExamAt.toMillis() - u.firstExamAt.toMillis()) / 86400000 / (count - 1))) + ' günde bir' : 'Henüz yeterli veri yok';
    const status = u.status === 'frozen' ? 'Dondurulmuş' : u.status === 'deleting' ? 'Siliniyor' : u.admin ? 'Yönetici' : 'Aktif';
    return `<details class="admin-user" data-uid="${escapeHtml(u.id)}" ${opened.has(u.id) ? 'open' : ''}><summary><span><strong>${escapeHtml(u.name || 'İsimsiz hesap')}</strong><small>${escapeHtml(u.email)}</small></span><span class="summary-status"><span>${status}</span><span class="disclosure-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></span></summary><div class="admin-user-body"><div class="activity-grid"><div><span>Deneme sayısı</span><strong>${number(count)}</strong></div><div><span>Ekleme sıklığı</span><strong>${interval}</strong></div><div><span>Son deneme</span><strong>${date(u.lastExamAt)}</strong></div><div><span>Kayıt tarihi</span><strong>${date(u.createdAt)}</strong></div><div><span>Son giriş</span><strong>${date(u.lastLoginAt)}</strong></div><div><span>Giriş sayısı</span><strong>${number(u.loginCount)}</strong></div></div><details class="management"><summary><span>Yönetim</span><span class="disclosure-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="management-actions"><button class="btn-neo danger-button" data-action="delete" ${u.admin ? 'disabled' : ''}>Kullanıcıyı sil</button><button class="btn-neo" data-action="${u.status === 'frozen' ? 'unfreeze' : 'freeze'}" ${u.admin ? 'disabled' : ''}>${u.status === 'frozen' ? 'Hesabı etkinleştir' : 'Hesabı dondur'}</button><button class="btn-neo" data-action="promote" ${u.admin ? 'disabled' : ''}>Yönetici yap</button></div></details></div></details>`;
  }).join('') : '<p class="empty-text">Eşleşen kullanıcı bulunamadı.</p>';
}
$('adminUsers').addEventListener('click', async e => {
  const button = e.target.closest('[data-action]'); if (!button || button.disabled) return;
  const uid = button.closest('[data-uid]').dataset.uid;
  const target = users.find(u => u.id === uid), action = button.dataset.action;
  const prompts = { delete: 'Hesap ve bütün denemeleri kalıcı olarak silinecek.', freeze: 'Hesabın erişimi durdurulacak.', unfreeze: 'Hesap yeniden etkinleştirilecek.', promote: 'Bu hesaba tam yönetici yetkisi verilecek.' };
  if (!confirm(`${target.name}: ${prompts[action]} Devam edilsin mi?`)) return;
  button.disabled = true;
  try { await callServer('manageUser', { uid, action }); showToast('Yönetim işlemi tamamlandı.', 'success'); }
  catch (error) { showToast(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
});
