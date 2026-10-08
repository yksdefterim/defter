import { saveProfile, changePassword } from './firebase-config.js';
import { $, requireUser, initChrome, showToast, errorMessage, alanNames, recordEvent } from './ui.js';
import { initThemedSelect } from './controls.js';

let user, profile, initialized = false;
initChrome();
requireUser((currentUser, saved) => {
  user = currentUser; profile = saved;
  $('profileAvatar').textContent = saved.name.charAt(0).toLocaleUpperCase('tr');
  $('profileHeading').textContent = saved.name; $('profileAlanTitle').textContent = alanNames[saved.alan];
  // Live updates must not overwrite an unsaved edit.
  if (!initialized) {
    ['name', 'alan', 'email', 'phone', 'school', 'address'].forEach(key => $('profile-' + key).value = saved[key] || '');
    initThemedSelect($('profile-alan'));
    initialized = true; recordEvent('visit'); recordEvent('firstAction', 'profile');
  }
  $('profile-phone').disabled = Boolean(saved.phone);
  if (saved.phone) $('profile-phone').value = saved.phone;
  $('phoneHint').textContent = saved.phone ? 'İlk kaydettiğin telefon numarası kilitlidir.' : 'İlk kayıttan sonra bu numara değiştirilemez.';
});
$('profileForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!user || !e.currentTarget.reportValidity()) return;
  const values = Object.fromEntries(['name', 'alan', 'phone', 'school', 'address'].map(key => [key, $('profile-' + key).value.trim()]));
  values.name = values.name.replace(/\s+/g, ' ');
  if (values.name.split(' ').length < 2) { showToast('Adını ve soyadını birlikte gir.', 'error'); return; }
  if (!profile.phone && values.phone) {
    values.phone = values.phone.replace(/[\s()-]/g, '');
    if (!/^(?:\+90|0)?5\d{9}$/.test(values.phone)) { showToast('Geçerli bir Türkiye cep telefonu numarası gir.', 'error'); return; }
    values.phone = '+90' + values.phone.slice(-10);
  }
  const button = $('saveProfile'); button.disabled = true;
  try { await saveProfile(user, values); showToast('Bilgilerin kaydedildi.', 'success'); }
  catch (error) { showToast(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
});
$('passwordForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!user || !e.currentTarget.reportValidity()) return;
  const next = $('nextPassword').value;
  if (next !== $('repeatPassword').value) { showToast('Yeni şifreler eşleşmiyor.', 'error'); return; }
  if (next === $('currentPassword').value) { showToast('Yeni şifren mevcut şifrenden farklı olmalı.', 'error'); return; }
  const button = $('changePassword'); button.disabled = true;
  try { await changePassword(user, $('currentPassword').value, next); $('passwordForm').reset(); showToast('Şifren değiştirildi.', 'success'); }
  catch (error) { showToast(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
});
