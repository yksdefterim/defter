// ============================================================
// pdf-parser.js - 360 Derece Eğitim karne PDF'i okuyucu
// PDF tarayıcıda (pdf.js ile) okunur, sunucuya hiçbir şey gönderilmez.
// Çıktı: Firestore'a addDeneme ile yazılabilecek denemeData yapısı.
// ============================================================

const PDFJS_WORKER_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ------------------------------------------------------------
   YARDIMCILAR
------------------------------------------------------------- */
const norm = (s) =>
  String(s).normalize("NFC").toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
const isNum = (s) => /^[-−–]?\d+(?:[.,]\d+)?$/.test(s);
const toNum = (s) => parseFloat(s.replace(/[−–]/g, "-").replace(",", "."));
const round2 = (n) => Math.round(n * 100) / 100;

// Ders adı -> uygulamadaki alt ders anahtarı
const SUBJECT_KEYS = {
  [norm("Türkçe")]: "turkce",
  [norm("Tarih")]: "tarih",
  [norm("Coğrafya")]: "cografya",
  [norm("Felsefe")]: "felsefe",
  [norm("Din Kültürü")]: "din",
  [norm("Matematik")]: "matematikSub",
  [norm("Geometri")]: "geometri",
  [norm("Fizik")]: "fizik",
  [norm("Kimya")]: "kimya",
  [norm("Biyoloji")]: "biyoloji",
};

// Bazı PDF'lerde "ti", "tı", "ft" gibi ligatürler okunamıyor, bozuk karakter, boşluk ya da hiç gelmiyor
// (örn. "Matema\u0000k", "Matema k"). Ders adı eşleştirirken bozuk harfler yok sayılır:
// okunan harfler, gerçek ders adında sırayla geçiyorsa ve en fazla 3 harf eksikse eşleşir.
const lettersOnly = (x) => x.replace(/[^\p{L}]/gu, "");
function subjectKeyOf(text) {
  const t = norm(text);
  if (SUBJECT_KEYS[t]) return SUBJECT_KEYS[t];
  const sk = lettersOnly(t);
  if (sk.length < 4) return null;
  for (const [name, key] of Object.entries(SUBJECT_KEYS)) {
    const full = lettersOnly(name);
    if (full[0] !== sk[0] || full.length - sk.length < 0 || full.length - sk.length > 3) continue;
    let i = 0;
    for (const ch of full) if (ch === sk[i]) i++;
    if (i === sk.length) return key;
  }
  return null;
}
const cleanText = (x) => x.replace(/\u0000+/g, "…");

// Uygulamadaki form yapısıyla (app.js renderFormStructure) birebir aynı
const MAT_FEN = [
  { id: "matematik", baslik: "Matematik", subs: [["matematikSub", "Matematik"], ["geometri", "Geometri"]] },
  { id: "fen", baslik: "Fen Bilimleri", subs: [["fizik", "Fizik"], ["kimya", "Kimya"], ["biyoloji", "Biyoloji"]] },
];
const CARDS = {
  TYT: [
    { id: "turkce", baslik: "Türkçe", subs: null },
    {
      id: "sosyal", baslik: "Sosyal Bilimler",
      subs: [["tarih", "Tarih"], ["cografya", "Coğrafya"], ["felsefe", "Felsefe"], ["din", "Din Kültürü"]],
    },
    ...MAT_FEN,
  ],
  AYT: MAT_FEN,
};

/* ------------------------------------------------------------
   PDF.JS -> KELİME LİSTESİ
   Her metin parçası boşluklardan bölünür; x konumu orantılı tahmin edilir.
------------------------------------------------------------- */
function toWords(items) {
  const words = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const len = it.str.length;
    const x0 = it.transform[4];
    const y = it.transform[5];
    const width = it.width || 0;
    for (const m of it.str.matchAll(/\S+/g)) {
      words.push({
        str: m[0],
        x: x0 + width * (m.index / len),
        w: width * (m[0].length / len),
        y,
      });
    }
  }
  return words;
}

// Aynı yükseklikteki kelimeleri satırlara toplar (yukarıdan aşağı)
function groupRows(words, tol = 2.5) {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const w of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - w.y) <= tol) last.words.push(w);
    else rows.push({ y: w.y, words: [w] });
  }
  rows.forEach((r) => r.words.sort((a, b) => a.x - b.x));
  return rows;
}

function findPhrase(rows, targets) {
  for (const row of rows) {
    const ws = row.words;
    for (let i = 0; i + targets.length <= ws.length; i++) {
      if (targets.every((t, j) => norm(ws[i + j].str) === norm(t))) {
        const last = ws[i + targets.length - 1];
        return { x: ws[i].x, right: last.x + last.w, y: row.y };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------
   SAYFA 1: ÜST BİLGİ + DERS ANALİZİ
------------------------------------------------------------- */
// "X(X)" şeklinde iki kez yazılan sınav adını tek yapar
function cleanExamName(raw) {
  const s = raw.replace(/\s+/g, " ").trim();
  for (let i = s.indexOf("("); i !== -1; i = s.indexOf("(", i + 1)) {
    const before = s.slice(0, i).trim();
    const rest = s.slice(i + 1).replace(/\)\s*$/, "").trim();
    if (before && rest.startsWith(before)) return before;
  }
  return s;
}

function readHeaderInfo(words) {
  const rows = groupRows(words);
  const ad = findPhrase(rows, ["Ad", "Soyad"]);
  const adi = findPhrase(rows, ["Sınav", "Adı"]);
  const trh = findPhrase(rows, ["Sınav", "Tarihi"]);
  const kit = words.find((w) => norm(w.str) === norm("Kitapçık"));
  const num = words.find((w) => norm(w.str) === norm("Numara"));

  const info = { ogrenci: "", denemeAdi: "", tarih: "" };

  if (ad) {
    info.ogrenci = words
      .filter((w) => Math.abs(w.y - ad.y) <= 2.5 && w.x >= ad.right - 1 && (!num || w.x < num.x - 1))
      .sort((a, b) => a.x - b.x)
      .map((w) => w.str)
      .join(" ");
  }

  if (adi && ad && trh) {
    // Sınav adı iki satıra bölünebiliyor: Ad Soyad ile Sınav Tarihi satırları arasındaki hücre
    const nameWords = words.filter(
      (w) => w.x >= adi.right - 1 && (!kit || w.x < kit.x - 1) && w.y < ad.y - 5 && w.y > trh.y + 5
    );
    const raw = groupRows(nameWords).map((r) => r.words.map((w) => w.str).join(" ")).join(" ");
    info.denemeAdi = cleanExamName(raw);
  }

  if (trh) {
    const d = words.find(
      (w) => Math.abs(w.y - trh.y) <= 2.5 && w.x >= trh.right - 1 && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(w.str)
    );
    if (d) {
      const [gun, ay, yil] = d.str.split(".");
      info.tarih = `${yil}-${ay.padStart(2, "0")}-${gun.padStart(2, "0")}`;
    }
  }
  return info;
}

function mapSummaryLabel(label) {
  const L = norm(label);
  const m = L.match(/^(TYT|AYT)-(.+)$/);
  if (m) return m[2] === norm("Türkçe") ? "turkce" : null; // TYT-SOSYAL, TYT-MATEMATİK... toplam satırları
  return subjectKeyOf(label);
}

function parseSummaryPage(words) {
  const rows = groupRows(words);
  const info = readHeaderInfo(words);

  const headerIdx = rows.findIndex((r) => {
    const k = r.words.map((w) => norm(w.str));
    return k.includes("SORU") && k.includes(norm("Doğru")) && k.includes(norm("Yanlış"));
  });
  if (headerIdx < 0) throw new Error("Ders analizi tablosu bulunamadı.");

  // Boş hücreler PDF'te hiç yazılmadığı için değerleri sütun başlığının x konumuna göre eşleriz
  const colNames = ["SORU", norm("Doğru"), norm("Yanlış"), norm("Boş"), "NET", "ORT"];
  const centers = {};
  rows[headerIdx].words.forEach((w) => {
    const k = norm(w.str);
    if (colNames.includes(k)) centers[k] = w.x + w.w / 2;
  });

  const ders = {};
  let toplam = null, sawTyt = false, sawAyt = false;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const label = r.words.filter((w) => !isNum(w.str)).map((w) => w.str).join(" ");
    const L = norm(label);
    if (/^TYT-/.test(L)) sawTyt = true;
    if (/^AYT-/.test(L)) sawAyt = true;

    const vals = {};
    r.words.filter((w) => isNum(w.str)).forEach((w) => {
      const cx = w.x + w.w / 2;
      let best = null, bd = Infinity;
      for (const [k, c] of Object.entries(centers)) {
        const d = Math.abs(cx - c);
        if (d < bd) { bd = d; best = k; }
      }
      if (best && !(best in vals)) vals[best] = toNum(w.str);
    });

    if (L === "TOPLAM") { toplam = vals; break; }
    const key = mapSummaryLabel(label);
    if (!key) continue;
    ders[key] = {
      soru: vals.SORU,
      dogru: vals[norm("Doğru")] || 0,
      yanlis: vals[norm("Yanlış")] || 0,
      bos: vals[norm("Boş")] || 0,
    };
  }

  return { info, ders, toplam, tur: sawAyt && !sawTyt ? "AYT" : "TYT" };
}

/* ------------------------------------------------------------
   SAYFA 2: KONU ANALİZİ (yan yana 3 tablo)
   Her satır: No | Konu | DC (doğru cevap) | ÖC (öğrenci cevabı) | SO (+/-)
------------------------------------------------------------- */
function parseTopicsPage(words) {
  const dcHeaders = words.filter((w) => norm(w.str) === "DC").sort((a, b) => a.x - b.x);
  if (dcHeaders.length === 0) throw new Error("Konu analizi tablosu bulunamadı.");

  // Tablolar DC başlığının yaklaşık 112 pt solunda başlıyor
  const starts = dcHeaders.map((h, i) => (i === 0 ? -Infinity : h.x - 112));
  const topics = {}; // altDersAnahtari -> { wrong: [], blank: [], toplam }
  // Tablolar soldan sağa ve yukarıdan aşağı bu sırayla ilerliyor; başlık okunamazsa sıradakini varsayarız
  const SECTION_ORDER = ["turkce", "matematikSub", "geometri", "tarih", "cografya", "felsefe", "din", "fizik", "kimya", "biyoloji"];
  let nextSection = 0;

  starts.forEach((lo, i) => {
    const hi = i + 1 < starts.length ? starts[i + 1] : Infinity;
    const colWords = words.filter((w) => w.x >= lo && w.x < hi);
    let section = null;
    let seenHeader = false;

    for (const row of groupRows(colWords)) {
      const toks = row.words;
      const keys = toks.map((t) => norm(t.str));
      if (keys.includes("DC") && keys.includes("ÖC")) { seenHeader = true; continue; } // sütun başlığı satırı
      if (!seenHeader) continue; // tablonun üstündeki başlık/açıklama satırları

      // Bölüm başlığı satırı (Türkçe, Matematik, Geometri, Tarih ...)
      if (!isNum(toks[0].str)) {
        const text = toks.map((t) => t.str).join(" ");
        let sec = subjectKeyOf(text);
        if (sec) {
          nextSection = SECTION_ORDER.indexOf(sec) + 1;
        } else {
          const looksLikeHeader =
            toks.length <= 4 && text.length <= 25 && !/\d{1,2}\.\d{1,2}\.\d{4}/.test(text) &&
            !toks.some((t) => /^[A-E+\-−–]$/.test(t.str));
          if (looksLikeHeader && nextSection < SECTION_ORDER.length) sec = SECTION_ORDER[nextSection++];
        }
        if (sec) { section = sec; if (!topics[sec]) topics[sec] = { wrong: [], blank: [], toplam: 0 }; }
        continue;
      }

      // Soru satırı
      if (!section || !/^\d+$/.test(toks[0].str)) continue;
      const rest = toks.slice(1).map((t) => t.str);
      const answers = [];
      let so = "";
      while (rest.length) {
        const last = rest[rest.length - 1];
        if (/^[+\-−–]$/.test(last)) { so = rest.pop(); }
        else if (/^[A-E]$/.test(last)) { answers.unshift(rest.pop()); }
        else break;
      }
      const konu = cleanText(rest.join(" ").trim());
      const dc = answers[0] || "";
      const oc = answers[1] || ""; // tek harf varsa o DC'dir, ÖC boştur
      const t = topics[section];
      t.toplam++;
      if (!oc) t.blank.push(konu);
      else if (oc !== dc || /^[-−–]$/.test(so)) t.wrong.push(konu);
    }
  });
  return topics;
}

/* ------------------------------------------------------------
   denemeData OLUŞTURMA (app.js'teki kayıt yapısıyla birebir)
------------------------------------------------------------- */
function buildDeneme(summary, topics, opts) {
  const { info, ders: pdfDers, toplam, tur } = summary;
  const warnings = [];
  const missing = [];
  const dersler = {};
  const konular = []; // uygulamanın kayıt yapısı: { ders, altDers, tip, konu }
  const konuGruplari = []; // sadece önizleme için
  let gD = 0, gY = 0, gB = 0, gN = 0;

  for (const card of CARDS[tur]) {
    const subDefs = card.subs || [[card.id, card.baslik]];
    const subResults = {};
    let D = 0, Y = 0, B = 0, N = 0;

    for (const [subId, subName] of subDefs) {
      const s = pdfDers[subId === card.id && !card.subs ? "turkce" : subId];
      if (!s) { missing.push(subName); continue; }

      const net = round2(s.dogru - s.yanlis * 0.25);
      subResults[subId] = { baslik: subName, dogru: s.dogru, yanlis: s.yanlis, bos: s.bos, net };
      D += s.dogru; Y += s.yanlis; B += s.bos; N += net;

      if (s.soru !== undefined && s.soru !== s.dogru + s.yanlis + s.bos) {
        warnings.push(`${subName}: D+Y+B toplamı soru sayısıyla (${s.soru}) uyuşmuyor.`);
      }

      // Sosyal Bilimler için uygulamada konu girilmediği için o dersin konuları kaydedilmez
      if (card.id !== "sosyal") {
        const t = (topics && topics[card.subs ? subId : "turkce"]) || { wrong: [], blank: [] };
        const altDers = card.subs ? subId : null;
        t.wrong.forEach((n) => konular.push({ ders: card.id, altDers, tip: "yanlis", konu: n }));
        t.blank.forEach((n) => konular.push({ ders: card.id, altDers, tip: "bos", konu: n }));
        konuGruplari.push({ ders: subName, yanlis: t.wrong, bos: t.blank });

        if (topics) {
          if (t.wrong.length !== s.yanlis)
            warnings.push(`${subName}: karnede ${s.yanlis} yanlış var, konu sayfasında ${t.wrong.length} yanlış konu bulundu.`);
          if (t.blank.length !== s.bos)
            warnings.push(`${subName}: karnede ${s.bos} boş var, konu sayfasında ${t.blank.length} boş konu bulundu.`);
        }
      }
    }

    dersler[card.id] = card.subs
      ? { baslik: card.baslik, dogru: D, yanlis: Y, bos: B, net: round2(N), altDersler: subResults }
      : { ...subResults[card.id] };
    gD += D; gY += Y; gB += B; gN += N;
  }

  if (missing.length) {
    throw new Error(`PDF'te şu dersler bulunamadı: ${missing.join(", ")}. Bu karne biçimi henüz desteklenmiyor olabilir.`);
  }
  if (!topics) warnings.push("Konu Analizi sayfası bulunamadı; yanlış/boş konu detayları kaydedilmeyecek.");
  if (!info.tarih) warnings.push("Sınav tarihi okunamadı, lütfen tarihi elle girin.");
  if (!info.denemeAdi) warnings.push("Sınav adı okunamadı, lütfen adı elle girin.");

  gN = round2(gN);
  if (toplam) {
    const pdfD = toplam[norm("Doğru")], pdfY = toplam[norm("Yanlış")], pdfN = toplam.NET;
    if ((pdfD !== undefined && pdfD !== gD) || (pdfY !== undefined && pdfY !== gY) || (pdfN !== undefined && Math.abs(pdfN - gN) > 0.01)) {
      warnings.push(`Toplamlar karnedeki TOPLAM satırıyla uyuşmuyor (hesaplanan net ${gN.toFixed(2)}, karne ${pdfN}).`);
    }
  }

  const denemeData = {
    denemeAdi: info.denemeAdi,
    tarih: info.tarih,
    tur,
    alan: tur === "AYT" ? "sayisal" : opts.alan || "sayisal",
    toplamDogru: gD,
    toplamYanlis: gY,
    toplamBos: gB,
    toplamNet: gN,
    dersler,
    konular,
  };
  return { denemeData, konuGruplari, warnings, ogrenci: info.ogrenci };
}

/* ------------------------------------------------------------
   DIŞA AÇILAN FONKSİYONLAR
------------------------------------------------------------- */
// pages: her sayfa için kelime listesi ({str, x, y, w})
export function parseExamPages(pages, opts = {}) {
  let summaryWords = null, topicWords = null;
  for (const words of pages) {
    const text = norm(words.map((w) => w.str).join(" "));
    if (!summaryWords && text.includes(norm("Ders Analizi"))) summaryWords = words;
    if (!topicWords && text.includes(norm("Konu Analizi"))) topicWords = words;
  }
  if (!summaryWords) {
    throw new Error("Bu PDF 360 Derece karnesine benzemiyor (Ders Analizi bulunamadı).");
  }
  const summary = parseSummaryPage(summaryWords);
  const topics = topicWords ? parseTopicsPage(topicWords) : null;
  return buildDeneme(summary, topics, opts);
}

export async function parseExamPdf(file, opts = {}) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error("PDF okuyucu (pdf.js) yüklenemedi. İnternet bağlantını kontrol et.");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(toWords(content.items));
  }
  return parseExamPages(pages, opts);
}
