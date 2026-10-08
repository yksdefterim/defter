// ============================================================
// gemini-service.js - Gemini AI Servis Fonksiyonları
// ============================================================

const GEMINI_API_KEY = "AQ.Ab8RN6LcgfKmDEP-1OKASDyW6ax2SGP9Oh55-5fq3YQVdlNwBw";
const GEMINI_MODEL = "gemini-1.5-flash"; // Model adındaki sürüm hatası giderildi (2.5 yerine mevcut olan 1.5 kullanılıyor)
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini({ parts, responseSchema, temperature = 0.3 }) {
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    },
  };

  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("Gemini API hatası");
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  try {
    // API'nin JSON formatını bozan markdown (```json ...) ekleme ihtimaline karşı temizleyici
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch(e) {
    console.error("Yapay zeka yanıtı parse edilemedi:", text);
    throw e;
  }
}

export async function analyzeSingleExam(currentExam, allExams) {
  const schema = {
    type: "OBJECT",
    properties: {
      genelOrtalamayaGoreDurum: { type: "STRING" },
      genelYorum: { type: "STRING" },
    },
    required: ["genelOrtalamayaGoreDurum", "genelYorum"],
  };

  const promptText = `YKS Öğrenci Koçusun.
ANALİZ EDİLECEK DENEME: ${JSON.stringify(currentExam)}
TÜM GEÇMİŞ DENEMELER: ${JSON.stringify(allExams.map((e) => ({ tarih: e.tarih, tur: e.tur, net: e.toplamNet })))}

Öğrencinin bu denemesini değerlendir. Genel ortalamasına göre ne durumda olduğunu ve eksik olduğu konulara dair yapıcı önerilerini JSON formatında ver.`;

  return callGemini({
    parts: [{ text: promptText }],
    responseSchema: schema,
  });
}

export async function analyzeChronicPatterns(allExams) {
  const schema = {
    type: "OBJECT",
    properties: {
      genelDegerlendirme: { type: "STRING" },
      yolHaritasi: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            adim: { type: "INTEGER" },
            baslik: { type: "STRING" },
            aciklama: { type: "STRING" },
          },
          required: ["adim", "baslik", "aciklama"],
        },
      },
    },
    required: ["genelDegerlendirme", "yolHaritasi"],
  };

  const promptText = `Öğrencinin tüm deneme geçmişi ve yanlış/boş bıraktığı konular:
${JSON.stringify(allExams)}

Sürekli tekrar eden eksik konuları tespit et. 3-4 adımlık somut ve uygulanabilir bir YKS çalışma yol haritası çıkart. Sadece Türkçe JSON yanıtı döndür.`;

  return callGemini({
    parts: [{ text: promptText }],
    responseSchema: schema,
  });
}