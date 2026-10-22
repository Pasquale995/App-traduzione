// Documento nascosto dell'estensione: scarica l'immagine, legge le scritte e le traduce.
import * as ort from 'onnxruntime-web/webgpu';
import { PaddleOcr } from './ocr.js';
import { loadWords, balloons, sentenceCase, isJapanese, readingOrder } from './testo.js';
import { PREDEFINITE } from './impostazioni.js';

ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
ort.env.wasm.numThreads = 1;

const url = p => chrome.runtime.getURL(p);
const bytes = async p => new Uint8Array(await (await fetch(url(p))).arrayBuffer());
const text = async p => (await fetch(url(p))).text();

let ocrPromise = null;
let backend = '';

function getOcr() {
  ocrPromise ??= (async () => {
    const [det, rec, keys, words] = await Promise.all([
      bytes('modelli/det.onnx'), bytes('modelli/rec.onnx'), text('modelli/chiavi.txt'), text('parole_en.txt'),
    ]);
    loadWords(words);
    // La scheda video (WebGPU) se c'è, altrimenti il processore.
    try {
      const o = await PaddleOcr.create(ort, det, rec, keys, { executionProviders: ['webgpu'] });
      backend = 'scheda video';
      return o;
    } catch (e) {
      console.warn('Mercurio: WebGPU non disponibile, uso il processore', e);
      backend = 'processore';
      return PaddleOcr.create(ort, det, rec, keys, { executionProviders: ['wasm'] });
    }
  })();
  ocrPromise.catch(() => { ocrPromise = null; });
  return ocrPromise;
}

let current = { ...PREDEFINITE };
const settings = async () => current;

// ---------- Immagine ----------

async function loadImage(src) {
  const res = await fetch(src, { credentials: 'omit' });
  if (!res.ok) throw new Error(`il sito non mi dà l'immagine (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { data, width: canvas.width, height: canvas.height };
}

// ---------- Traduzione con Ollama ----------

const cache = new Map();
let autoModel = null;

async function ollama(cfg, path, body) {
  const base = cfg.ollama.trim().replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error('Ollama non risponde: è aperto sul PC?');
  }
  if (res.status === 403) throw new Error("Ollama rifiuta l'estensione: imposta OLLAMA_ORIGINS=chrome-extension://* e riavvialo");
  if (!res.ok) throw new Error(`Ollama ha risposto ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

async function models(cfg) {
  if (cfg.motore === 'mercurio') return [cfg.motoreModello || 'Mercurio Motore'];
  const j = await ollama(cfg, '/api/tags');
  return (j.models || []).map(m => m.name);
}

async function pickModel(cfg) {
  if (cfg.motore === 'mercurio') return cfg.motoreModello || 'Mercurio Motore';
  if (cfg.modello) return cfg.modello;
  if (autoModel) return autoModel;
  const names = await models(cfg);
  autoModel = names.find(n => n.includes('translategemma')) || names.find(n => n.includes('gemma')) || names[0];
  if (!autoModel) throw new Error("Su Ollama non c'è nessun modello: lancia 'ollama pull translategemma:4b'");
  return autoModel;
}

function prompt(model, src, japanese = isJapanese(src)) {
  const [lang, code] = japanese ? ['Japanese', 'ja'] : ['English', 'en'];
  const t = code === 'en' ? sentenceCase(src) : src;
  if (model.toLowerCase().includes('translategemma')) {
    // Il formato fisso con cui Google ha addestrato TranslateGemma.
    return `You are a professional ${lang} (${code}) to Italian (it) translator. Your goal is to accurately convey ` +
      `the meaning and nuances of the original ${lang} text while adhering to Italian grammar, vocabulary, and ` +
      `cultural sensitivities.\nProduce only the Italian translation, without any additional explanations or ` +
      `commentary. Please translate the following ${lang} text into Italian:\n\n\n${t}`;
  }
  return `Translate this ${lang} comic book text into natural Italian, keeping tone, slang and jokes. ` +
    `The text comes from OCR and may contain small errors: fix them silently. ` +
    `Answer with only the Italian translation.\n\n${t}`;
}

const explainedSound = t => /\)$/.test(t) && t.includes(' (') && !/[a-z]/.test(t.split(' (')[0]);

/** Una domanda al modello: a Mercurio Motore (llama.cpp) o a Ollama. */
async function chat(cfg, model, content) {
  if (cfg.motore === 'mercurio') {
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${cfg.motorePorta || 11435}/completion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Formato di conversazione di Gemma scritto a mano: non dipende dal template dentro il file del modello.
        body: JSON.stringify({
          prompt: `<start_of_turn>user\n${content}<end_of_turn>\n<start_of_turn>model\n`,
          n_predict: 1536, temperature: 0.2, stop: ['<end_of_turn>'], cache_prompt: true,
        }),
      });
    } catch {
      throw new Error('Mercurio Motore non risponde');
    }
    if (!res.ok) throw new Error(`Mercurio Motore ha risposto ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return (await res.json()).content || '';
  }
  const j = await ollama(cfg, '/api/chat', {
    model, stream: false, keep_alive: '30m',
    options: { temperature: 0.2 },
    messages: [{ role: 'user', content }],
  });
  return j.message?.content || '';
}

async function translate(cfg, src) {
  if (explainedSound(src)) return src;
  const model = await pickModel(cfg);
  const key = model + '\n' + src;
  if (cache.has(key)) return cache.get(key);
  const out = (await chat(cfg, model, prompt(model, src))).replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["«]|["»]$/g, '').trim();
  cache.set(key, out);
  return out;
}

/**
 * Tutta la pagina in una richiesta: le nuvolette numerate "1. …", così il modello vede la scena intera.
 * Restituisce null se la risposta non torna con gli stessi numeri (allora si va una nuvoletta alla volta).
 */
async function translatePage(cfg, texts, context = []) {
  const model = await pickModel(cfg);
  const its = texts.map(t => explainedSound(t) ? t : cache.get(model + '\n' + t));
  const todo = texts.map((t, i) => [t, i]).filter(([, i]) => its[i] == null);
  if (todo.length === 1) its[todo[0][1]] = await translate(cfg, todo[0][0]);
  else if (todo.length > 1) {
    const japanese = todo.filter(([t]) => isJapanese(t)).length * 2 > todo.length;
    // Le ultime battute della pagina prima vanno in testa, solo per contesto: la loro traduzione la scarto.
    const ctx = context.filter(t => t && isJapanese(t) === japanese).slice(-3);
    const lines = [...ctx, ...todo.map(([t]) => t)];
    const numbered = lines.map((t, n) => `${n + 1}. ${japanese ? t : sentenceCase(t)}`).join('\n');
    const raw = (await chat(cfg, model, prompt(model, numbered, japanese))).replace(/<think>[\s\S]*?<\/think>/g, '');
    const got = new Map();
    let last = 0;
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*\**(\d+)\**\s*[.)\]:-]\s*(.*)$/);
      if (m) { last = Number(m[1]); got.set(last, m[2].trim()); }
      else if (last && line.trim()) got.set(last, got.get(last) + ' ' + line.trim()); // battuta andata a capo
    }
    const k = ctx.length;
    if (todo.some((_, n) => !got.get(k + n + 1))) return null;
    todo.forEach(([t, i], n) => {
      const it = got.get(k + n + 1).replace(/^["«]|["»]$/g, '').trim();
      its[i] = it;
      cache.set(model + '\n' + t, it);
    });
  }
  return its;
}

// ---------- Messaggi ----------

const pages = new Map(); // src -> scritte già lette

/** Solo lettura: le traduzioni le chiede la pagina una alla volta, così compaiono man mano. */
async function page(src, data) {
  if (pages.has(src)) return pages.get(src);
  const [ocr, img] = await Promise.all([getOcr(), loadImage(data || src)]);
  const t0 = performance.now();
  // Pagine "normali" (manga): righe da destra a sinistra. Strisce lunghe (webtoon): dall'alto in basso.
  const rtl = img.height < img.width * 2;
  const found = readingOrder(balloons(await ocr.read(img)), rtl).map(b => ({ box: b.box, text: b.text }));
  const result = { w: img.width, h: img.height, balloons: found, ms: Math.round(performance.now() - t0), backend };
  pages.set(src, result);
  if (pages.size > 300) pages.delete(pages.keys().next().value);
  return result;
}

async function test() {
  const cfg = await settings();
  const t0 = performance.now();
  const model = await pickModel(cfg);
  cache.delete(model + '\nDAMN... TOP RANKERS HAVE CONNECTIONS WITH GOVERNMENTS TOO.'); // tempo vero, non dalla memoria
  const it = await translate(cfg, 'DAMN... TOP RANKERS HAVE CONNECTIONS WITH GOVERNMENTS TOO.');
  return { model, it, secondi: ((performance.now() - t0) / 1000).toFixed(1) };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.to !== 'offscreen') return;
  if (msg.cfg) current = { ...PREDEFINITE, ...msg.cfg };
  const run = { pagina: () => page(msg.src, msg.data), traduci: async () => ({ it: await translate(await settings(), msg.text) }),
    traduciPagina: async () => ({ its: await translatePage(await settings(), msg.texts, msg.context) }), prova: test, modelli: async () => ({ modelli: await models(await settings()) }) }[msg.type];
  if (!run) return;
  if (!['pagina', 'traduci', 'traduciPagina'].includes(msg.type)) autoModel = null; // dopo un cambio di impostazioni riscelgo il modello
  run().then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});
