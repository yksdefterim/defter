// ============================================================
// app.js - Uygulama Mantığı & Firestore Bağlantısı
// ============================================================

import {
  auth, registerUser, loginUser, logoutUser, watchAuthState,
  addDeneme, deleteDeneme, updateDenemeAiNote, watchDenemeler,
} from "./firebase-config.js";

import { analyzeSingleExam, analyzeChronicPatterns } from "./gemini-service.js";
import { parseExamPdf } from "./pdf-parser.js";

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

    state.unsubscribeDenemeler = watchDenemeler(user.uid, (denemeler) => {
      state.denemeler = denemeler;
      renderDashboard();
      renderHistoryTable();
      populateAnalysisDropdown();
      autoUpdateRoadmap();
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
      if(netInput) netInput.value = cardNet.toFixed(2);

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
   FORM KAYDETME (Ders Bazlı Veriler de Eklenerek Güncellendi)
------------------------------------------------------------- */
el("manualEntryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return;

  const denemeAlani = el("entryType").value === "AYT" ? el("entryAlan").value : (state.userAlan || "sayisal");

  // Ders bazlı doğru/yanlış/boş ve netlerin toplanması
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

  const denemeData = {
    denemeAdi: el("entryName").value.trim(),
    tarih: el("entryDate").value,
    tur: el("entryType").value,
    alan: denemeAlani,
    toplamDogru: parseInt(el("grandTotalDogru").textContent),
    toplamYanlis: parseInt(el("grandTotalYanlis").textContent),
    toplamBos: parseInt(el("grandTotalBos").textContent),
    toplamNet: parseFloat(el("grandTotalNet").textContent),
    dersler: dersler, // Ders bazlı istatistikler veritabanına kaydediliyor
    konuDetaylari: {},
  };

  document.querySelectorAll(".topic-input-item input").forEach((inp) => {
    denemeData.konuDetaylari[inp.name] = inp.value.trim();
  });

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
   GEÇMİŞ TABLOSU (Ders Bazlı Detayların Gösterildiği Alan)
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
    
    // 1. Ders Bazlı Doğru, Yanlış, Boş ve Netler
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

    // 2. Konu Detayları (Yanlış ve Boşlar)
    if (d.konuDetaylari && Object.keys(d.konuDetaylari).length > 0) {
      const cardsHtml = Object.entries(d.konuDetaylari).map(([key, val]) => {
         const isBlank = key.includes('_blank_');
         const typeStr = isBlank ? 'Boş:' : 'Yanlış:';
         return `<div class="history-topic-card ${isBlank ? 'is-blank' : ''}"><span>${typeStr}</span> ${val}</div>`;
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
   ANALİZ SEKSİYONU
------------------------------------------------------------- */
document.addEventListener('click', (e) => {
  const dropdown = el('denemeDropdown');
  const dropdownOptionsList = el('dropdownOptionsList');
  if (dropdown && !dropdown.contains(e.target) && dropdownOptionsList) {
      dropdownOptionsList.classList.remove('show');
  }
});

function populateAnalysisDropdown() {
  const dropdownSelectedText = el("dropdownSelectedText");
  const dropdownOptionsList = el("dropdownOptionsList");
  
  if (!dropdownSelectedText || !dropdownOptionsList) return;

  const newSelectedText = dropdownSelectedText.cloneNode(true);
  dropdownSelectedText.parentNode.replaceChild(newSelectedText, dropdownSelectedText);
  
  newSelectedText.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownOptionsList.classList.toggle('show');
  });

  dropdownOptionsList.innerHTML = ''; 

  if (state.denemeler.length === 0) {
    newSelectedText.innerHTML = `Henüz deneme yok... <span style="font-size: 12px;">▼</span>`;
    return;
  }

  newSelectedText.innerHTML = `Analiz için bir deneme seçin... <span style="font-size: 12px;">▼</span>`;
  newSelectedText.dataset.selectedId = "";

  state.denemeler.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = `${d.tarih} - ${d.denemeAdi} (${d.tur})`;
    
    li.onclick = (e) => {
      e.stopPropagation();
      newSelectedText.innerHTML = `${d.tarih} - ${d.denemeAdi} (${d.tur}) <span style="font-size: 12px;">▼</span>`;
      newSelectedText.dataset.selectedId = d.id;
      dropdownOptionsList.classList.remove('show');
    };
    
    dropdownOptionsList.appendChild(li);
  });
}

el("runSingleAnalysisBtn").addEventListener("click", async () => {
  const dropdownSelectedText = el("dropdownSelectedText");
  const id = dropdownSelectedText ? dropdownSelectedText.dataset.selectedId : null;
  
  if (!id) { showToast("Lütfen bir deneme seçin.", "error"); return; }

  const selectedExam = state.denemeler.find((d) => d.id === id);
  const box = el("singleAnalysisOutput");
  box.innerHTML = "Analiz yapılıyor... Lütfen bekleyin.";

  try {
    const res = await analyzeSingleExam(selectedExam, state.denemeler);
    box.innerHTML = `<h4>${selectedExam.denemeAdi} Analiz Sonucu</h4><p><strong>Genel Durum:</strong> ${res.genelOrtalamayaGoreDurum}</p><p>${res.genelYorum}</p>`;
    await updateDenemeAiNote(state.user.uid, selectedExam.id, res.genelYorum);
    autoUpdateRoadmap();
  } catch (err) {
    box.innerHTML = `<span style="color: var(--danger)">Yapay zeka ağına ulaşılamadı. Lütfen tekrar deneyiniz.</span>`;
  }
});

el("runChronicAnalysisBtn").addEventListener("click", async () => {
  if (state.denemeler.length < 2) { showToast("En az 2 deneme kaydı gerekiyor.", "error"); return; }
  const box = el("chronicAnalysisOutput");
  box.innerHTML = "Tüm denemeler taranıyor... Lütfen bekleyin.";
  try {
    const res = await analyzeChronicPatterns(state.denemeler);
    box.innerHTML = `<p>${res.genelDegerlendirme}</p>`;
    autoUpdateRoadmap();
  } catch (err) {
    box.innerHTML = `<span style="color: var(--danger)">Kronik analiz yapılırken bir hata oluştu. Lütfen tekrar deneyiniz.</span>`;
  }
});

async function autoUpdateRoadmap() {
  const box = el("roadmapOutput");
  if (state.denemeler.length === 0) {
    box.innerHTML = `<p class="empty-text">Henüz deneme bulunmadığı için yol haritası oluşturulamadı.</p>`;
    return;
  }
  try {
    const res = await analyzeChronicPatterns(state.denemeler);
    if (res.yolHaritasi && res.yolHaritasi.length) {
      box.innerHTML = res.yolHaritasi.map((step) => `<p><strong>Adım ${step.adim}: ${step.baslik}</strong> - ${step.aciklama}</p>`).join("");
    } else {
      box.innerHTML = "<p>Mevcut netlerinize göre düzenli deneme çözmeye devam edin.</p>";
    }
  } catch (e) {
    box.innerHTML = `<span style="color: var(--danger)">Yol haritası güncellenirken hata oluştu.</span>`;
  }
}

/* ------------------------------------------------------------
   PDF İLE OTOMATİK OKUMA: yükle -> önizle -> onaylarsan kaydet
------------------------------------------------------------- */
const escapeHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let pendingPdf = null; // onay bekleyen { denemeData, konuGruplari, warnings, ogrenci }

function setPdfStatus(message, isError = false) {
  const box = el("pdfStatus");
  box.hidden = !message;
  box.textContent = message || "";
  box.classList.toggle("is-error", isError);
}

function resetPdfPanel() {
  pendingPdf = null;
  el("pdfPreview").hidden = true;
  el("pdfPreview").innerHTML = "";
  el("pdfDropzone").hidden = false;
  setPdfStatus("");
}

async function handlePdfFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setPdfStatus("Lütfen bir PDF dosyası seçin.", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setPdfStatus("PDF en fazla 10 MB olabilir.", true);
    return;
  }
  setPdfStatus("PDF okunuyor...");
  try {
    pendingPdf = await parseExamPdf(file, { alan: state.userAlan });
    setPdfStatus("");
    renderPdfPreview();
  } catch (err) {
    console.error(err);
    pendingPdf = null;
    setPdfStatus(err.message || "PDF okunamadı.", true);
  }
}

function renderPdfPreview() {
  const { denemeData: d, konuGruplari, warnings, ogrenci } = pendingPdf;

  const warningHtml = warnings.length
    ? `<div class="pdf-warning">Kaydetmeden önce kontrol et:<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
    : "";

  const dersHtml = Object.values(d.dersler).map((ders) => {
    const subs = ders.altDersler
      ? `<div class="pdf-ders-card__subs">${Object.values(ders.altDersler).map((a) =>
          `<div>• <strong>${escapeHtml(a.baslik)}:</strong> ${a.dogru} D / ${a.yanlis} Y / ${a.bos} B (${a.net.toFixed(2)} Net)</div>`).join("")}</div>`
      : "";
    return `<div class="pdf-ders-card">
      <div class="pdf-ders-card__top"><span>${escapeHtml(ders.baslik)}</span><span>${ders.net.toFixed(2)} Net</span></div>
      <div class="pdf-ders-card__line">${ders.dogru} Doğru | ${ders.yanlis} Yanlış | ${ders.bos} Boş</div>${subs}</div>`;
  }).join("");

  const topicHtml = konuGruplari.filter((g) => g.yanlis.length || g.bos.length).map((g) => `
    <div class="pdf-topic-group">
      <h4>${escapeHtml(g.ders)}<small>${g.yanlis.length} yanlış, ${g.bos.length} boş</small></h4>
      <div class="history-topic-grid">
        ${g.yanlis.map((k) => `<div class="history-topic-card"><span>Yanlış:</span> ${escapeHtml(k)}</div>`).join("")}
        ${g.bos.map((k) => `<div class="history-topic-card is-blank"><span>Boş:</span> ${escapeHtml(k)}</div>`).join("")}
      </div>
    </div>`).join("");

  el("pdfPreview").innerHTML = `
    ${warningHtml}
    ${ogrenci ? `<p class="pdf-meta">PDF'teki öğrenci: ${escapeHtml(ogrenci)}</p>` : ""}
    <div class="form-row">
      <div class="field-group"><label>Deneme Adı</label><input type="text" id="pdfPreviewName" value="${escapeHtml(d.denemeAdi)}"></div>
      <div class="field-group"><label>Tarih</label><input type="date" id="pdfPreviewDate" value="${escapeHtml(d.tarih)}"></div>
      <div class="field-group"><label>Sınav Türü</label><input type="text" readonly value="${escapeHtml(d.tur)}"></div>
    </div>
    <div class="total-summary-card">
      <div class="summary-item"><span>Toplam Doğru</span><strong>${d.toplamDogru}</strong></div>
      <div class="summary-item"><span>Toplam Yanlış</span><strong>${d.toplamYanlis}</strong></div>
      <div class="summary-item"><span>Toplam Boş</span><strong>${d.toplamBos}</strong></div>
      <div class="summary-item summary-item--highlight"><span>Toplam Sınav Neti</span><strong>${d.toplamNet.toFixed(2)}</strong></div>
    </div>
    <div class="pdf-ders-grid">${dersHtml}</div>
    ${topicHtml ? `<div><h3 style="font-size:1rem;font-weight:700;color:var(--text-muted)">Yanlış ve Boş Bırakılan Konular</h3>${topicHtml}</div>` : ""}
    <div class="pdf-actions">
      <button type="button" id="pdfCancelBtn" class="btn-neo btn-neo--lg">İptal</button>
      <button type="button" id="pdfConfirmBtn" class="btn-neo btn-neo--primary btn-neo--lg">Onayla ve Kaydet</button>
    </div>`;

  el("pdfDropzone").hidden = true;
  el("pdfPreview").hidden = false;
  el("pdfCancelBtn").addEventListener("click", resetPdfPanel);
  el("pdfConfirmBtn").addEventListener("click", confirmPdfSave);
}

async function confirmPdfSave() {
  if (!pendingPdf || !state.user) return;
  const denemeAdi = el("pdfPreviewName").value.trim();
  const tarih = el("pdfPreviewDate").value;
  if (!denemeAdi || !tarih) { showToast("Deneme adı ve tarih boş olamaz.", "error"); return; }

  const duplicate = state.denemeler.some((x) => x.tarih === tarih && x.denemeAdi === denemeAdi);
  if (duplicate && !confirm("Aynı isim ve tarihte bir deneme zaten kayıtlı. Yine de eklensin mi?")) return;

  const btn = el("pdfConfirmBtn");
  btn.disabled = true;
  try {
    await addDeneme(state.user.uid, { ...pendingPdf.denemeData, denemeAdi, tarih });
    showToast("Deneme PDF'ten başarıyla kaydedildi.", "success");
    resetPdfPanel();
    document.querySelector('.sidebar__btn[data-view="history"]').click();
  } catch (err) {
    btn.disabled = false;
    showToast("Hata: " + err.message, "error");
  }
}

const pdfDropzone = el("pdfDropzone");
const pdfFileInput = el("pdfFileInput");
pdfDropzone.addEventListener("click", () => pdfFileInput.click());
pdfDropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pdfFileInput.click(); } });
pdfFileInput.addEventListener("change", () => { handlePdfFile(pdfFileInput.files[0]); pdfFileInput.value = ""; });
["dragenter", "dragover"].forEach((ev) => pdfDropzone.addEventListener(ev, (e) => { e.preventDefault(); pdfDropzone.classList.add("is-drag"); }));
["dragleave", "drop"].forEach((ev) => pdfDropzone.addEventListener(ev, (e) => { e.preventDefault(); pdfDropzone.classList.remove("is-drag"); }));
pdfDropzone.addEventListener("drop", (e) => handlePdfFile(e.dataTransfer.files[0]));
