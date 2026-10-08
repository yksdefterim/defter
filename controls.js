const chevron = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function initThemedSelect(select) {
  if (!select || select.dataset.themed) return;
  select.dataset.themed = 'true';
  const wrapper = document.createElement('div'); wrapper.className = 'themed-select';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'themed-select__trigger';
  trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const label = select.labels?.[0];
  if (label) { label.id ||= select.id + '-label'; trigger.setAttribute('aria-labelledby', label.id + ' ' + select.id + '-value'); }
  const value = document.createElement('span'); value.id = select.id + '-value';
  const arrow = document.createElement('span'); arrow.className = 'control-chevron'; arrow.innerHTML = chevron;
  trigger.append(value, arrow);
  const list = document.createElement('div'); list.id = select.id + '-options'; list.className = 'themed-select__options'; list.hidden = true; list.setAttribute('role', 'listbox');
  if (label) list.setAttribute('aria-labelledby', label.id);
  trigger.setAttribute('aria-controls', list.id);
  select.after(wrapper); wrapper.append(trigger, list); select.hidden = true;
  const options = [...select.options].map(option => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'themed-select__option'; button.textContent = option.text; button.setAttribute('role', 'option'); button.disabled = option.disabled; button.tabIndex = -1;
    button.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); close(); trigger.focus(); });
    list.append(button); return { option, button };
  });
  function refresh() { value.textContent = select.selectedOptions[0]?.text || ''; options.forEach(({ option, button }) => button.setAttribute('aria-selected', String(option.selected))); }
  function close() { list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  function open() {
    list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect(), below = innerHeight - rect.bottom - 16, above = rect.top - 16;
    const upwards = below < Math.min(list.scrollHeight, 240) && above > below;
    wrapper.classList.toggle('opens-up', upwards);
    list.style.maxHeight = Math.min(240, Math.max(100, upwards ? above : below)) + 'px';
    (options.find(o => o.option.selected && !o.button.disabled) || options.find(o => !o.button.disabled))?.button.focus();
  }
  trigger.addEventListener('click', () => list.hidden ? open() : close());
  trigger.addEventListener('keydown', e => { if (['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); open(); } });
  list.addEventListener('keydown', e => {
    const available = options.filter(o => !o.button.disabled).map(o => o.button), index = available.indexOf(document.activeElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? available.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
      available[next]?.focus();
    }
  });
  wrapper.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); } });
  wrapper.addEventListener('focusout', e => { if (!wrapper.contains(e.relatedTarget)) close(); });
  document.addEventListener('click', e => { if (!wrapper.contains(e.target)) close(); });
  select.addEventListener('change', refresh);
  label?.addEventListener('click', () => trigger.focus());
  refresh();
}

export function confirmLogout() {
  let dialog = document.getElementById('logoutDialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'logoutDialog'; dialog.className = 'logout-dialog';
    dialog.setAttribute('aria-labelledby', 'logoutTitle'); dialog.setAttribute('aria-describedby', 'logoutDescription');
    dialog.innerHTML = '<div class="logout-dialog__symbol" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/></svg></div><h2 id="logoutTitle">Çıkış yapılsın mı?</h2><p id="logoutDescription">Hesabından çıkış yapılacak ve ana sayfaya döneceksin.</p><div class="logout-dialog__actions"><button type="button" class="btn-neo" data-cancel autofocus>İptal</button><button type="button" class="btn-neo btn-neo--primary" data-confirm>Çıkış yap</button></div>';
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
    dialog.querySelector('[data-confirm]').addEventListener('click', () => dialog.close('confirm'));
    dialog.addEventListener('click', e => { const rect = dialog.getBoundingClientRect(); if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) dialog.close('cancel'); });
    document.body.append(dialog);
  }
  if (dialog.open) return Promise.resolve(false);
  return new Promise(resolve => {
    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
