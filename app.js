// ============================================================
// app.js - Uygulama Mantığı & Firestore Bağlantısı
// ============================================================

import {
  auth, registerUser, loginUser, logoutUser, watchAuthState,
  addDeneme, deleteDeneme, watchDenemeler,
} from "./firebase-config.js";

/* ------------------------------------------------------------
   ÖZEL SEÇİM MENÜSÜ KONTROLCÜSÜ (CUSTOM SELECT UI)
------------------------------------------------------------- */
class CustomSelect {
  constructor(originalSelect) {
    this.originalSelect = originalSelect;
    this.originalSelect.style.display = 'none';
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'neo-select';

    this.trigger = document.createElement('div');
    this.trigger.className = 'neo-select__trigger';

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'neo-select__options';

    this.wrapper.appendChild(this.trigger);
    this.wrapper.appendChild(this.optionsContainer);
    this.originalSelect.parentNode.insertBefore(this.wrapper, this.originalSelect.nextSibling);

    this.render();
    this.setupEvents();
  }

  render() {
    this.optionsContainer.innerHTML = '';
    const options = Array.from(this.originalSelect.options);
    let selectedText = options.length > 0 ? options[0].text : '';

    options.forEach(opt => {
      if (opt.selected) selectedText = opt.text;
      const optDiv = document.createElement('div');
      optDiv.className = 'neo-select__option' + (opt.selected ? ' is-selected' : '') + (opt.disabled ? ' is-disabled' : '');
      optDiv.textContent = opt.text;
      optDiv.dataset.value = opt.value;

      if (!opt.disabled) {
        optDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          this.originalSelect.value = opt.value;
          this.originalSelect.dispatchEvent(new Event('change'));
          this.close();
          this.render();
        });
      }
      this.optionsContainer.appendChild(optDiv);
    });

    this.trigger.innerHTML = `<span>${selectedText}</span> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
  }

  setupEvents() {
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.wrapper.classList.contains('is-open');
      document.querySelectorAll('.neo-select').forEach(s => s.classList.remove('is-open'));
      if (!isOpen) this.wrapper.classList.add('is-open');
    });
    document.addEventListener('click', () => this.wrapper.classList.remove('is-open'));
  }

  close() { this.wrapper.classList.remove('is-open'); }
}

function initCustomSelect(selectEl) {
  if (!selectEl) return;
  if (selectEl._customSelect) {
    selectEl._customSelect.render();
  } else {
    selectEl._customSelect = new CustomSelect(selectEl);
  }
}

/* ------------------------------------------------------------
   DURUM (STATE)
------------------------------------------------------------- */
const state = {
  user: null, userAlan: "sayisal", denemeler: [],
  unsubscribeDenemeler: null, chart: null,
};
const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------
   GÖRÜNÜM KONTROLLERİ
------------------------------------------------------------- */
function showLanding() { el("landingPage").hidden = false; el("authOverlay").hidden = true; el("appShell").hidden = true; }
function showAuthScreen(mode) { el("landingPage").hidden = true; el("authOverlay").hidden = false; el("appShell").hidden = true; switchAuthTab(mode); }
function showApp() { el("landingPage").hidden = true; el("authOverlay").hidden = true; el("appShell").hidden = false; }

el("landingTopLoginBtn").addEventListener("click", () => showAuthScreen("login"));
el("landingHeroLoginBtn").addEventListener("click", () => showAuthScreen("register"));
el("landingFooterLoginBtn").addEventListener("click", () => showAuthScreen("login"));
el("authBackToLanding").addEventListener("click", () => showLanding());

function showToast(message, type = "info", duration = 4000) {
  const stack = el("toastStack");
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "is-error" : ""} ${type === "success" ? "is-success" : ""}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ------------------------------------------------------------
   AUTH
------------------------------------------------------------- */
function switchAuthTab(target) {
  const isLogin = target === "login";
  el("authTabLogin").classList.toggle("is-active", isLogin);
  el("authTabRegister").classList.toggle("is-active", !isLogin);
  el("loginForm").hidden = !isLogin;
  el("registerForm").hidden = isLogin;
  el("authError").hidden = true;
}

el("authTabLogin").addEventListener("click", () => switchAuthTab("login"));
el("authTabRegister").addEventListener("click", () => switchAuthTab("register"));

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await loginUser(el("loginEmail").value.trim(), el("loginPassword").value);
    showToast("Başarıyla giriş yaptınız.", "success", 500);
  } catch (err) {
    el("authError").textContent = "Giriş başarısız. E-posta veya şifre hatalı.";
    el("authError").hidden = false;
  }
});

el("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const name = el("registerName").value.trim();
    const alan = el("registerAlan").value;
    await registerUser(name, el("registerEmail").value.trim(), el("registerPassword").value, alan);
    showToast("Kayıt olma başarılı.", "success", 500);
  } catch (err) {
    el("authError").textContent = "Kayıt olunamadı: " + err.message;
    el("authError").hidden = false;
  }
});

el("logoutBtn").addEventListener("click", () => logoutUser());

watchAuthState((user) => {
  state.user = user;
  if (state.unsubscribeDenemeler) {
    state.unsubscribeDenemeler();
    state.unsubscribeDenemeler = null;
  }

  if (user) {
    showApp();
    const displayName = user.displayName || user.email.split("@")[0];
    el("userDisplayName").textContent = displayName;
    el("userAvatarInitial").textContent = displayName.charAt(0).toUpperCase();

    state.userAlan = user.photoURL || "sayisal";
    const alanNames = { sayisal: "Sayısal", ea: "Eşit Ağırlık", sozel: "Sözel", dil: "Dil" };
    el("userDisplayAlan").textContent = alanNames[state.userAlan] || "Sayısal";

    // NOT: Her render fonksiyonu ayrı try/catch içine alındı.
    // Önceki sürümde bunlardan biri (grafik/analiz) hata fırlatırsa
    // zincirdeki sonraki fonksiyonlar (Deneme Geçmişi, Analiz vs.)
    // hiç çalışmıyordu — yeni deneme kaydedilince sadece üstteki
    // ortalama/en-yüksek-net kutucuklarının güncellenip diğerlerinin
    // güncellenmemesi tam olarak bu yüzdendi. Artık biri patlasa da
    // diğerleri çalışmaya devam ediyor.
    state.unsubscribeDenemeler = watchDenemeler(user.uid, (denemeler) => {
      state.denemeler = denemeler;
      try { renderDashboard(); } catch (err) { console.error("Genel Bakış render hatası:", err); }
      try { renderHistoryTable(); } catch (err) { console.error("Deneme Geçmişi render hatası:", err); }
      try { renderAnalizView(); } catch (err) { console.error("Analiz render hatası:", err); }
    });
  } else {
    showLanding();
    state.denemeler = [];
    initCustomSelect(el("registerAlan"));
  }
});

/* ------------------------------------------------------------
   MENÜ GEÇİŞLERİ
------------------------------------------------------------- */
document.querySelectorAll(".sidebar__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sidebar__btn").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    btn.classList.add("is-active");
    el(`view-${btn.dataset.view}`).classList.add("is-active");
  });
});

/* ------------------------------------------------------------
   YENİ DENEME FORMU VE DİNAMİK ALANLAR
------------------------------------------------------------- */
el("entryTabManual").addEventListener("click", () => {
  el("entryTabManual").classList.add("is-active");
  el("entryTabPdf").classList.remove("is-active");
  el("manualEntryForm").hidden = false;
  el("pdfEntryPanel").hidden = true;
});

el("entryTabPdf").addEventListener("click", () => {
  el("entryTabPdf").classList.add("is-active");
  el("entryTabManual").classList.remove("is-active");
  el("pdfEntryPanel").hidden = false;
  el("manualEntryForm").hidden = true;
});

el("entryType").addEventListener("change", () => {
  const isAyt = el("entryType").value === "AYT";
  el("entryAlanField").hidden = !isAyt;
  renderFormStructure();
});

el("entryDate").valueAsDate = new Date();

function renderFormStructure() {
  const type = el("entryType").value;
  const container = el("dynamicSubjectContainer");
  container.innerHTML = "";

  if (type === "TYT") {
    container.appendChild(createSubjectCard("turkce", "Türkçe", true, false, []));
    container.appendChild(createSubjectCard("sosyal", "Sosyal Bilimler", false, true, [
      { id: "tarih", name: "Tarih" }, { id: "cografya", name: "Coğrafya" },
      { id: "felsefe", name: "Felsefe" }, { id: "din", name: "Din Kültürü" }
    ]));
    container.appendChild(createSubjectCard("matematik", "Matematik", true, true, [
      { id: "matematikSub", name: "Matematik" }, { id: "geometri", name: "Geometri" }
    ]));
    container.appendChild(createSubjectCard("fen", "Fen Bilimleri", true, true, [
      { id: "fizik", name: "Fizik" }, { id: "kimya", name: "Kimya" }, { id: "biyoloji", name: "Biyoloji" }
    ]));
  } else {
    container.appendChild(createSubjectCard("matematik", "Matematik", true, true, [
      { id: "matematikSub", name: "Matematik" }, { id: "geometri", name: "Geometri" }
    ]));
    container.appendChild(createSubjectCard("fen", "Fen Bilimleri", true, true, [
      { id: "fizik", name: "Fizik" }, { id: "kimya", name: "Kimya" }, { id: "biyoloji", name: "Biyoloji" }
    ]));
  }

  attachFormCalculators();
  initCustomSelect(el("entryType"));
  initCustomSelect(el("entryAlan"));
}

function createSubjectCard(cardId, title, hasTopics, hasSubSubjects, subSubjects) {
  const card = document.createElement("div");
  card.className = "subject-card";
  card.dataset.subjectCard = cardId;

  let innerHTML = `
    <div class="subject-card__header">
      <span class="subject-card__title">${title}</span>
      <div class="subject-net-badge">Net: <span id="${cardId}_total_net">0.00</span></div>
    </div>
  `;

  if (!hasSubSubjects) {
    innerHTML += `
      <div class="subject-row-inputs">
        <div class="sub-field"><label>Doğru</label><input type="number" min="0" value="0" class="input-d" data-card="${cardId}"></div>
        <div class="sub-field"><label>Yanlış</label><input type="number" min="0" value="0" class="input-y" data-card="${cardId}"></div>
        <div class="sub-field"><label>Boş</label><input type="number" min="0" value="0" class="input-b" data-card="${cardId}"></div>
        <div class="sub-field"><label>Net</label><input type="text" readonly value="0.00" class="input-net-readonly" id="${cardId}_net"></div>
      </div>
      <div class="topic-inputs-container" id="${cardId}_topics"></div>
    `;
  } else {
    innerHTML += `<div class="sub-subjects-grid">`;
    subSubjects.forEach((sub) => {
      innerHTML += `
        <div class="sub-subject-row" data-sub="${sub.id}">
          <span class="sub-subject-name">${sub.name}</span>
          <div class="sub-field"><label>D</label><input type="number" min="0" value="0" class="input-d" data-card="${cardId}" data-sub="${sub.id}"></div>
          <div class="sub-field"><label>Y</label><input type="number" min="0" value="0" class="input-y" data-card="${cardId}" data-sub="${sub.id}"></div>
          <div class="sub-field"><label>B</label><input type="number" min="0" value="0" class="input-b" data-card="${cardId}" data-sub="${sub.id}"></div>
          <div class="sub-field"><label>Net</label><input type="text" readonly value="0.00" class="input-net-readonly" id="${sub.id}_net"></div>
        </div>
      `;
    });
    innerHTML += `</div>`;

    if (hasTopics) {
      innerHTML += `<div class="topic-inputs-container" id="${cardId}_topics"></div>`;
    }
  }

  card.innerHTML = innerHTML;
  return card;
}

function attachFormCalculators() {
  document.querySelectorAll("#dynamicSubjectContainer input").forEach((input) => {
    input.addEventListener("input", calculateFormTotals);
  });
  calculateFormTotals();
}

function calculateFormTotals() {
  let grandD = 0, grandY = 0, grandB = 0, grandNet = 0;

  document.querySelectorAll(".subject-card").forEach((card) => {
    const cardId = card.dataset.subjectCard;
    let cardNet = 0;

    const subRows = card.querySelectorAll(".sub-subject-row");

    if (subRows.length === 0) {
      const d = parseInt(card.querySelector(".input-d").value) || 0;
      const y = parseInt(card.querySelector(".input-y").value) || 0;
      const b = parseInt(card.querySelector(".input-b").value) || 0;
      cardNet = d - (y * 0.25);

      const netInput = card.querySelector(`#${cardId}_net`);
      if (netInput) netInput.value = cardNet.toFixed(2);

      grandD += d; grandY += y; grandB += b;
      updateTopicFields(cardId, "", card.querySelector('.subject-card__title').textContent, y, b);
    } else {
      subRows.forEach((row) => {
        const d = parseInt(row.querySelector(".input-d").value) || 0;
        const y = parseInt(row.querySelector(".input-y").value) || 0;
        const b = parseInt(row.querySelector(".input-b").value) || 0;
        const net = d - (y * 0.25);

        row.querySelector(".input-net-readonly").value = net.toFixed(2);
        cardNet += net;
        grandD += d; grandY += y; grandB += b;
      });
      if (cardId !== "sosyal") updateSubTopicsForCard(card);
    }

    el(`${cardId}_total_net`).textContent = cardNet.toFixed(2);
    grandNet += cardNet;
  });

  el("grandTotalDogru").textContent = grandD;
  el("grandTotalYanlis").textContent = grandY;
  el("grandTotalBos").textContent = grandB;
  el("grandTotalNet").textContent = grandNet.toFixed(2);
}

function updateTopicFields(cardId, subPrefix, labelName, yCount, bCount) {
  const container = el(`${cardId}_topics`);
  if (!container) return;

  const existingValues = {};
  container.querySelectorAll("input").forEach((inp) => existingValues[inp.name] = inp.value);

  let html = "";
  for (let i = 1; i <= yCount; i++) {
    const name = `${cardId}_${subPrefix}_wrong_${i}`;
    html += `<div class="topic-input-item"><label>${labelName} Yanlış ${i}: Konu</label><input type="text" name="${name}" required value="${existingValues[name] || ''}" placeholder="Eksik konu adını giriniz..."></div>`;
  }
  for (let i = 1; i <= bCount; i++) {
    const name = `${cardId}_${subPrefix}_blank_${i}`;
    html += `<div class="topic-input-item"><label class="is-blank">${labelName} Boş ${i}: Konu</label><input type="text" name="${name}" required value="${existingValues[name] || ''}" placeholder="Boş bırakılan konu adını giriniz..."></div>`;
  }
  container.innerHTML = html;
}

function updateSubTopicsForCard(card) {
  const cardId = card.dataset.subjectCard;
  const container = el(`${cardId}_topics`);
  if (!container) return;

  const existingValues = {};
  container.querySelectorAll("input").forEach((inp) => existingValues[inp.name] = inp.value);

  let html = "";
  card.querySelectorAll(".sub-subject-row").forEach((row) => {
    const subName = row.querySelector(".sub-subject-name").textContent;
    const y = parseInt(row.querySelector(".input-y").value) || 0;
    const b = parseInt(row.querySelector(".input-b").value) || 0;

    for (let i = 1; i <= y; i++) {
      const name = `${cardId}_${row.dataset.sub}_wrong_${i}`;
      html += `<div class="topic-input-item"><label>${subName} Yanlış ${i}: Konu</label><input type="text" name="${name}" required value="${existingValues[name] || ''}" placeholder="Eksik konuları yazınız..."></div>`;
    }
    for (let i = 1; i <= b; i++) {
      const name = `${cardId}_${row.dataset.sub}_blank_${i}`;
      html += `<div class="topic-input-item"><label class="is-blank">${subName} Boş ${i}: Konu</label><input type="text" name="${name}" required value="${existingValues[name] || ''}" placeholder="Boş bırakılan konuyu yazınız..."></div>`;
    }
  });
  container.innerHTML = html;
}

renderFormStructure();

/* ------------------------------------------------------------
   KONU VERİSİ YARDIMCILARI
   (Yeni kayıtlar "konular" dizisini kullanır; eski kayıtlarda
   sadece "konuDetaylari" varsa buradan otomatik türetilir, böylece
   geçmiş denemeler de analizde kullanılabilir.)
------------------------------------------------------------- */
const TOPIC_KEY_REGEX = /^([a-z]+)_([a-zA-Z]*)_(wrong|blank)_(\d+)$/;

function getKonularForDeneme(deneme) {
  if (Array.isArray(deneme.konular)) return deneme.konular;
  const result = [];
  if (deneme.konuDetaylari) {
    Object.entries(deneme.konuDetaylari).forEach(([key, konu]) => {
      if (!konu) return;
      const m = key.match(TOPIC_KEY_REGEX);
      if (!m) return;
      result.push({
        ders: m[1],
        altDers: m[2] || null,
        tip: m[3] === "wrong" ? "yanlis" : "bos",
        konu,
      });
    });
  }
  return result;
}

/* ------------------------------------------------------------
   FORM KAYDETME (Analiz için yapılandırılmış "konular" dizisi ile)
------------------------------------------------------------- */
el("manualEntryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return;

  const denemeAlani = el("entryType").value === "AYT" ? el("entryAlan").value : (state.userAlan || "sayisal");

  const dersler = {};
  document.querySelectorAll(".subject-card").forEach((card) => {
    const cardId = card.dataset.subjectCard;
    const cardTitle = card.querySelector(".subject-card__title").textContent;
    const subRows = card.querySelectorAll(".sub-subject-row");

    if (subRows.length === 0) {
      const d = parseInt(card.querySelector(".input-d").value) || 0;
      const y = parseInt(card.querySelector(".input-y").value) || 0;
      const b = parseInt(card.querySelector(".input-b").value) || 0;
      const net = d - (y * 0.25);
      dersler[cardId] = { baslik: cardTitle, dogru: d, yanlis: y, bos: b, net: net };
    } else {
      const subDersler = {};
      let totalCardD = 0, totalCardY = 0, totalCardB = 0, totalCardNet = 0;
      subRows.forEach((row) => {
        const subId = row.dataset.sub;
        const subName = row.querySelector(".sub-subject-name").textContent;
        const d = parseInt(row.querySelector(".input-d").value) || 0;
        const y = parseInt(row.querySelector(".input-y").value) || 0;
        const b = parseInt(row.querySelector(".input-b").value) || 0;
        const net = d - (y * 0.25);
        subDersler[subId] = { baslik: subName, dogru: d, yanlis: y, bos: b, net: net };
        totalCardD += d; totalCardY += y; totalCardB += b; totalCardNet += net;
      });
      dersler[cardId] = {
        baslik: cardTitle,
        dogru: totalCardD,
        yanlis: totalCardY,
        bos: totalCardB,
        net: totalCardNet,
        altDersler: subDersler
      };
    }
  });

  // Konu detayları artık ders/altDers/tip bilgisiyle birlikte
  // yapılandırılmış bir dizi olarak kaydediliyor; analiz ekranı
  // bunu doğrudan kullanıyor.
  const konular = [];
  document.querySelectorAll(".topic-input-item input").forEach((inp) => {
    const val = inp.value.trim();
    if (!val) return;
    const m = inp.name.match(TOPIC_KEY_REGEX);
    if (!m) return;
    konular.push({
      ders: m[1],
      altDers: m[2] || null,
      tip: m[3] === "wrong" ? "yanlis" : "bos",
      konu: val,
    });
  });

  const denemeData = {
    denemeAdi: el("entryName").value.trim(),
    tarih: el("entryDate").value,
    tur: el("entryType").value,
    alan: denemeAlani,
    toplamDogru: parseInt(el("grandTotalDogru").textContent),
    toplamYanlis: parseInt(el("grandTotalYanlis").textContent),
    toplamBos: parseInt(el("grandTotalBos").textContent),
    toplamNet: parseFloat(el("grandTotalNet").textContent),
    dersler: dersler,
    konular: konular,
  };

  try {
    await addDeneme(state.user.uid, denemeData);
    showToast("Deneme başarıyla kaydedildi.", "success");
    el("manualEntryForm").reset();
    el("entryDate").valueAsDate = new Date();
    renderFormStructure();
  } catch (err) {
    showToast("Hata: " + err.message, "error");
  }
});

/* ------------------------------------------------------------
   DASHBOARD & CHART
------------------------------------------------------------- */
function renderDashboard() {
  const denemeler = state.denemeler;
  const tytExams = denemeler.filter((d) => d.tur === "TYT");
  const aytExams = denemeler.filter((d) => d.tur === "AYT");

  const tytAvg = tytExams.length ? (tytExams.reduce((s, x) => s + x.toplamNet, 0) / tytExams.length) : 0;
  const aytAvg = aytExams.length ? (aytExams.reduce((s, x) => s + x.toplamNet, 0) / aytExams.length) : 0;
  const tytMaxObj = tytExams.length ? tytExams.reduce((max, x) => x.toplamNet > max.toplamNet ? x : max, tytExams[0]) : null;
  const aytMaxObj = aytExams.length ? aytExams.reduce((max, x) => x.toplamNet > max.toplamNet ? x : max, aytExams[0]) : null;

  el("statTytAvg").textContent = tytAvg.toFixed(2);
  el("statAytAvg").textContent = aytAvg.toFixed(2);
  el("statTytMax").textContent = tytMaxObj ? tytMaxObj.toplamNet.toFixed(2) : "0.00";
  el("statTytMaxName").textContent = tytMaxObj ? tytMaxObj.denemeAdi : "—";
  el("statAytMax").textContent = aytMaxObj ? aytMaxObj.toplamNet.toFixed(2) : "0.00";
  el("statAytMaxName").textContent = aytMaxObj ? aytMaxObj.denemeAdi : "—";

  initCustomSelect(el("chartTypeFilter"));
  renderChart();
}

el("chartTypeFilter").addEventListener("change", renderChart);

function renderChart() {
  const filter = el("chartTypeFilter").value;
  const filteredExams = state.denemeler.filter((d) => d.tur === filter);
  const labels = filteredExams.map((d) => d.tarih);
  const values = filteredExams.map((d) => d.toplamNet);

  const ctx = el("netTrendChart").getContext("2d");
  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: `${filter} Net Trendi`, data: values, borderColor: "#3b82f6", backgroundColor: "rgba(59, 130, 246, 0.1)", borderWidth: 3, tension: 0.3, fill: true, pointBackgroundColor: "#6366f1", pointRadius: 5 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

/* ------------------------------------------------------------
   GEÇMİŞ TABLOSU
------------------------------------------------------------- */
function renderHistoryTable() {
  const tbody = el("historyTableBody");
  const reversed = [...state.denemeler].reverse();

  if (reversed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-text">Henüz kaydedilmiş deneme bulunmuyor.</td></tr>`;
    return;
  }

  tbody.innerHTML = reversed.map((d, index) => {
    let detailsHtml = '';

    if (d.dersler && Object.keys(d.dersler).length > 0) {
      const derslerHtml = Object.values(d.dersler).map(ders => {
        let altHtml = '';
        if (ders.altDersler) {
          altHtml = `<div style="margin-top: 6px; font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 3px;">` +
            Object.values(ders.altDersler).map(alt =>
              `<div>• <strong>${alt.baslik}:</strong> ${alt.dogru} D / ${alt.yanlis} Y / ${alt.bos} B (${alt.net.toFixed(2)} Net)</div>`
            ).join('') + `</div>`;
        }
        return `
          <div style="background: var(--card-bg); padding: 12px; border-radius: var(--radius-sm); box-shadow: var(--shadow-drop-sm); border-left: 3px solid var(--primary-blue);">
            <div style="display: flex; justify-content: space-between; font-weight: 800; margin-bottom: 4px; font-size: 0.9rem;">
              <span>${ders.baslik}</span>
              <span style="color: var(--primary-blue);">${ders.net.toFixed(2)} Net</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600;">
              ${ders.dogru} Doğru | ${ders.yanlis} Yanlış | ${ders.bos} Boş
            </div>
            ${altHtml}
          </div>
        `;
      }).join('');

      detailsHtml += `<h4 style="margin-bottom: 10px; font-size: 0.95rem; font-weight: 800;">Ders Bazlı Sonuçlar</h4><div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-bottom: 20px;">${derslerHtml}</div>`;
    }

    const konularList = getKonularForDeneme(d);
    if (konularList.length > 0) {
      const cardsHtml = konularList.map((k) => {
        const isBlank = k.tip === 'bos';
        const typeStr = isBlank ? 'Boş:' : 'Yanlış:';
        return `<div class="history-topic-card ${isBlank ? 'is-blank' : ''}"><span>${typeStr}</span> ${k.konu}</div>`;
      }).join('');
      detailsHtml += `<h4 style="margin-bottom: 10px; font-size: 0.95rem; font-weight: 800;">Yanlış ve Boş Bırakılan Konular</h4><div class="history-topic-grid">${cardsHtml}</div>`;
    } else {
      detailsHtml += '<p class="empty-text">Bu deneme için kaydedilmiş yanlış veya boş konu detayı bulunmuyor.</p>';
    }

    return `
      <tr class="history-main-row" data-index="${index}">
        <td>${d.tarih}</td>
        <td><strong>${d.denemeAdi}</strong></td>
        <td><span class="badge-type">${d.tur}</span></td>
        <td>${d.toplamDogru || 0} D / ${d.toplamYanlis || 0} Y / ${d.toplamBos || 0} B</td>
        <td><strong>${(d.toplamNet || 0).toFixed(2)}</strong></td>
        <td><button class="delete-btn" data-id="${d.id}">Sil</button></td>
      </tr>
      <tr class="history-details-row" id="details-${index}" style="display: none;">
        <td colspan="6">
          <div class="history-details-content">
            ${detailsHtml}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Bu denemeyi silmek istediğinize emin misiniz?")) {
        await deleteDeneme(state.user.uid, btn.dataset.id);
        showToast("Deneme silindi.", "success");
      }
    });
  });

  tbody.querySelectorAll(".history-main-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = row.dataset.index;
      const detailRow = el(`details-${idx}`);
      const isVisible = detailRow.style.display === 'table-row';
      document.querySelectorAll(".history-details-row").forEach(r => r.style.display = 'none');
      if (!isVisible) detailRow.style.display = 'table-row';
    });
  });
}

/* ------------------------------------------------------------
   ANALİZ — DERS TANIMLARI
------------------------------------------------------------- */
const TYT_GENEL_DERSLER = [
  { key: "turkce", label: "Türkçe" },
  { key: "sosyal", label: "Sosyal Bilimler" },
  { key: "matematik", label: "Matematik" },
  { key: "fen", label: "Fen Bilimleri" },
];
const AYT_GENEL_DERSLER = [
  { key: "matematik", label: "Matematik" },
  { key: "fen", label: "Fen Bilimleri" },
];

const MATEMATIK_TABS = [
  { altDers: null, label: "Genel" },
  { altDers: "matematikSub", label: "Matematik" },
  { altDers: "geometri", label: "Geometri" },
];
const FEN_TABS = [
  { altDers: null, label: "Genel" },
  { altDers: "fizik", label: "Fizik" },
  { altDers: "kimya", label: "Kimya" },
  { altDers: "biyoloji", label: "Biyoloji" },
];

const TYT_DETAY_GRUPLARI = [
  { ders: "turkce", label: "Türkçe", tabs: null },
  { ders: "sosyal", label: "Sosyal Bilimler", tabs: null },
  { ders: "matematik", label: "Matematik", tabs: MATEMATIK_TABS },
  { ders: "fen", label: "Fen Bilimleri", tabs: FEN_TABS },
];
const AYT_DETAY_GRUPLARI = [
  { ders: "matematik", label: "Matematik", tabs: MATEMATIK_TABS },
  { ders: "fen", label: "Fen Bilimleri", tabs: FEN_TABS },
];

/* ------------------------------------------------------------
   ANALİZ — HESAPLAMA YARDIMCILARI (Yapay zeka YOK — tüm hesaplar
   Firestore'dan çekilen denemeler üzerinden istemci tarafında
   yapılır)
------------------------------------------------------------- */
function getDersStat(deneme, ders, altDers) {
  const d = deneme.dersler && deneme.dersler[ders];
  if (!d) return null;
  if (!altDers) return { dogru: d.dogru || 0, yanlis: d.yanlis || 0, bos: d.bos || 0, net: d.net || 0 };
  const alt = d.altDersler && d.altDersler[altDers];
  if (!alt) return null;
  return { dogru: alt.dogru || 0, yanlis: alt.yanlis || 0, bos: alt.bos || 0, net: alt.net || 0 };
}

function computeAverageStats(denemelerOfType, ders, altDers) {
  let count = 0, sD = 0, sY = 0, sB = 0, sN = 0;
  denemelerOfType.forEach((deneme) => {
    const s = getDersStat(deneme, ders, altDers);
    if (!s) return;
    count++; sD += s.dogru; sY += s.yanlis; sB += s.bos; sN += s.net;
  });
  if (count === 0) return null;
  return { count, avgDogru: sD / count, avgYanlis: sY / count, avgBos: sB / count, avgNet: sN / count };
}

function getKonuListesi(denemelerOfType, ders, altDers, tip) {
  const list = [];
  denemelerOfType.forEach((deneme) => {
    getKonularForDeneme(deneme).forEach((k) => {
      if (k.ders !== ders) return;
      if (altDers && k.altDers !== altDers) return; // altDers belirtilmediyse (genel) tüm alt dersler dahil
      if (k.tip !== tip) return;
      list.push({ konu: k.konu, denemeAdi: deneme.denemeAdi, tarih: deneme.tarih });
    });
  });
  list.sort((a, b) => (b.tarih || "").localeCompare(a.tarih || ""));
  return list;
}

// Konu adlarını büyük/küçük harf duyarsız, karakter bazlı pozisyonel
// benzerlik oranına göre kümeler (kullanıcının yazım farklarına
// toleranslı olacak şekilde) — eşik %70.
function turkishLower(str) {
  return (str || "").toLocaleLowerCase('tr-TR').trim();
}

function topicSimilarity(a, b) {
  const s1 = turkishLower(a), s2 = turkishLower(b);
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 0;
  const minLen = Math.min(s1.length, s2.length);
  let matches = 0;
  for (let i = 0; i < minLen; i++) if (s1[i] === s2[i]) matches++;
  return matches / maxLen;
}

function clusterAndRankTopics(konuStrings, limit = 5) {
  const clusters = [];
  konuStrings.forEach((konu) => {
    const found = clusters.find(c => topicSimilarity(c.representative, konu) >= 0.7);
    if (found) found.count++;
    else clusters.push({ representative: konu, count: 1 });
  });
  return clusters.sort((a, b) => b.count - a.count).slice(0, limit);
}

/* ------------------------------------------------------------
   ANALİZ — GENEL ANALİZ RENDER
------------------------------------------------------------- */
function renderGenelAnalizBlock(bodyEl, denemelerOfType, dersListDef, turLabel) {
  if (denemelerOfType.length === 0) {
    bodyEl.innerHTML = `<p class="empty-text">Daha önce ${turLabel} denemesi eklenmemiş.</p>`;
    return;
  }

  const rows = dersListDef.map((d) => ({ label: d.label, stat: computeAverageStats(denemelerOfType, d.key, null) }))
    .filter(r => r.stat);

  if (rows.length === 0) {
    bodyEl.innerHTML = `<p class="empty-text">Daha önce ${turLabel} denemesi eklenmemiş.</p>`;
    return;
  }

  const mostWrong = rows.reduce((max, r) => r.stat.avgYanlis > max.stat.avgYanlis ? r : max, rows[0]);
  const mostBlank = rows.reduce((max, r) => r.stat.avgBos > max.stat.avgBos ? r : max, rows[0]);

  let html = `
    <div class="genel-analiz-highlight-row">
      <div class="genel-analiz-highlight">
        <span class="genel-analiz-highlight__label">En Çok Yanlış Yaptığın Ders</span>
        <span class="genel-analiz-highlight__value">${mostWrong.label}</span>
        <span class="genel-analiz-highlight__sub">Ort. ${mostWrong.stat.avgYanlis.toFixed(2)} yanlış</span>
      </div>
      <div class="genel-analiz-highlight">
        <span class="genel-analiz-highlight__label">En Çok Boş Bıraktığın Ders</span>
        <span class="genel-analiz-highlight__value">${mostBlank.label}</span>
        <span class="genel-analiz-highlight__sub">Ort. ${mostBlank.stat.avgBos.toFixed(2)} boş</span>
      </div>
    </div>
    <div class="genel-analiz-subject-grid">
  `;

  rows.forEach((r) => {
    html += `
      <div class="genel-analiz-subject-card">
        <span class="genel-analiz-subject-card__title">${r.label}</span>
        <div class="genel-analiz-subject-card__stats">
          <div><span>Ort. Doğru</span><strong>${r.stat.avgDogru.toFixed(2)}</strong></div>
          <div><span>Ort. Yanlış</span><strong>${r.stat.avgYanlis.toFixed(2)}</strong></div>
          <div><span>Ort. Boş</span><strong>${r.stat.avgBos.toFixed(2)}</strong></div>
          <div><span>Ort. Net</span><strong>${r.stat.avgNet.toFixed(2)}</strong></div>
        </div>
      </div>`;
  });

  html += `</div>`;
  bodyEl.innerHTML = html;
}

function renderGenelAnaliz() {
  const tytExams = state.denemeler.filter(d => d.tur === "TYT");
  const aytExams = state.denemeler.filter(d => d.tur === "AYT");
  renderGenelAnalizBlock(el("genelAnalizTyt").querySelector(".genel-analiz-block__body"), tytExams, TYT_GENEL_DERSLER, "TYT");
  renderGenelAnalizBlock(el("genelAnalizAyt").querySelector(".genel-analiz-block__body"), aytExams, AYT_GENEL_DERSLER, "AYT");
}

/* ------------------------------------------------------------
   ANALİZ — DERS BAZLI DETAY RENDER
------------------------------------------------------------- */
function renderKonuRow(item, isBlank) {
  return `
    <div class="konu-row ${isBlank ? 'is-blank' : ''}">
      <span class="konu-row__name">${item.konu}</span>
      <span class="konu-row__meta">${item.denemeAdi || ''} · ${item.tarih || ''}</span>
    </div>`;
}

function renderTopList(clusters) {
  if (clusters.length === 0) return `<p class="empty-text">Veri bulunamadı.</p>`;
  return `<div class="konu-rank-list">` + clusters.map((c, i) => `
    <div class="konu-rank-item">
      <span class="konu-rank-item__badge">${i + 1}</span>
      <span class="konu-rank-item__name">${c.representative}</span>
      <span class="konu-rank-item__count">${c.count} kez</span>
    </div>`).join('') + `</div>`;
}

function renderDetailCardBody(bodyEl, denemelerOfType, ders, altDers, label) {
  const stat = computeAverageStats(denemelerOfType, ders, altDers);
  if (!stat) {
    bodyEl.innerHTML = `<p class="empty-text">${label} için veri bulunamadı.</p>`;
    return;
  }

  const wrongList = getKonuListesi(denemelerOfType, ders, altDers, "yanlis");
  const blankList = getKonuListesi(denemelerOfType, ders, altDers, "bos");
  const topWrong = clusterAndRankTopics(wrongList.map(x => x.konu), 5);
  const topBlank = clusterAndRankTopics(blankList.map(x => x.konu), 5);
  const groupId = `${ders}_${altDers || 'genel'}`.replace(/[^a-zA-Z0-9_]/g, '');

  bodyEl.innerHTML = `
    <div class="ders-detay-stats">
      <div><span>Ort. Doğru</span><strong>${stat.avgDogru.toFixed(2)}</strong></div>
      <div><span>Ort. Yanlış</span><strong>${stat.avgYanlis.toFixed(2)}</strong></div>
      <div><span>Ort. Boş</span><strong>${stat.avgBos.toFixed(2)}</strong></div>
      <div><span>Ort. Net</span><strong>${stat.avgNet.toFixed(2)}</strong></div>
    </div>
    <div class="ders-detay-columns">
      <div class="ders-detay-column">
        <h4>Son Yanlış Yaptığın Konular</h4>
        <div class="konu-list">
          ${wrongList.length ? wrongList.slice(0, 10).map(item => renderKonuRow(item, false)).join('') : '<p class="empty-text">Veri bulunamadı.</p>'}
        </div>
        ${wrongList.length > 10 ? `<button type="button" class="btn-neo btn-neo--sm konu-show-all-btn" data-target="wrongAll_${groupId}">Tümünü Gör</button>` : ''}
        <div class="konu-list-all" id="wrongAll_${groupId}" hidden>
          ${wrongList.map(item => renderKonuRow(item, false)).join('')}
        </div>
        <h4 style="margin-top:16px;">En Çok Yanlış Yapılan 5 Konu</h4>
        ${renderTopList(topWrong)}
      </div>
      <div class="ders-detay-column">
        <h4>Son Boş Bıraktığın Konular</h4>
        <div class="konu-list">
          ${blankList.length ? blankList.slice(0, 10).map(item => renderKonuRow(item, true)).join('') : '<p class="empty-text">Veri bulunamadı.</p>'}
        </div>
        ${blankList.length > 10 ? `<button type="button" class="btn-neo btn-neo--sm konu-show-all-btn" data-target="blankAll_${groupId}">Tümünü Gör</button>` : ''}
        <div class="konu-list-all" id="blankAll_${groupId}" hidden>
          ${blankList.map(item => renderKonuRow(item, true)).join('')}
        </div>
        <h4 style="margin-top:16px;">En Çok Boş Bırakılan 5 Konu</h4>
        ${renderTopList(topBlank)}
      </div>
    </div>
  `;

  bodyEl.querySelectorAll(".konu-show-all-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = el(btn.dataset.target);
      const isHidden = target.hidden;
      target.hidden = !isHidden;
      btn.textContent = isHidden ? "Gizle" : "Tümünü Gör";
    });
  });
}

function renderDersBazliAnaliz() {
  const tur = el("dersAnalizTurFilter").value;
  const denemelerOfType = state.denemeler.filter(d => d.tur === tur);
  const gruplar = tur === "TYT" ? TYT_DETAY_GRUPLARI : AYT_DETAY_GRUPLARI;
  const container = el("dersBazliAnalizContainer");
  container.innerHTML = "";

  if (denemelerOfType.length === 0) {
    container.innerHTML = `<p class="empty-text">Daha önce ${tur} denemesi eklenmemiş.</p>`;
    return;
  }

  gruplar.forEach((grup) => {
    const card = document.createElement("div");
    card.className = "ders-detay-card";

    let headerHtml = `<div class="ders-detay-card__header"><h3>${grup.label}</h3>`;
    if (grup.tabs) {
      headerHtml += `<div class="ders-detay-tabs">` + grup.tabs.map((t, i) =>
        `<button type="button" class="ders-detay-tab ${i === 0 ? 'is-active' : ''}" data-alt="${t.altDers || ''}">${t.label}</button>`
      ).join('') + `</div>`;
    }
    headerHtml += `</div>`;

    card.innerHTML = headerHtml + `<div class="ders-detay-card__body"></div>`;
    container.appendChild(card);

    const bodyEl = card.querySelector(".ders-detay-card__body");

    if (grup.tabs) {
      const tabBtns = card.querySelectorAll(".ders-detay-tab");
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          tabBtns.forEach(b => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          const altDers = btn.dataset.alt || null;
          const tabDef = grup.tabs.find(t => (t.altDers || '') === (altDers || ''));
          renderDetailCardBody(bodyEl, denemelerOfType, grup.ders, altDers, `${grup.label} - ${tabDef.label}`);
        });
      });
      renderDetailCardBody(bodyEl, denemelerOfType, grup.ders, null, `${grup.label} - Genel`);
    } else {
      renderDetailCardBody(bodyEl, denemelerOfType, grup.ders, null, grup.label);
    }
  });
}

el("dersAnalizTurFilter").addEventListener("change", () => {
  renderDersBazliAnaliz();
});

function renderAnalizView() {
  renderGenelAnaliz();
  initCustomSelect(el("dersAnalizTurFilter"));
  renderDersBazliAnaliz();
}
