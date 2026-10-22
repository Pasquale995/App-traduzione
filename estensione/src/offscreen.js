// Documento nascosto dell'estensione: scarica l'immagine, legge le scritte e le traduce.
import * as ort from 'onnxruntime-web/webgpu';
import { PaddleOcr } from './ocr.js';
import { loadWords, balloons, sentenceCase, isJapanese } from './testo.js';
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
  const j = await ollama(cfg, '/api/tags');
  return (j.models || []).map(m => m.name);
}

async function pickModel(cfg) {
  if (cfg.modello) return cfg.modello;
  if (autoModel) return autoModel;
  const names = await models(cfg);
  autoModel = names.find(n => n.includes('translategemma')) || names.find(n => n.includes('gemma')) || names[0];
  if (!autoModel) throw new Error("Su Ollama non c'è nessun modello: lancia 'ollama pull translategemma:4b'");
  return autoModel;
}

function prompt(model, src) {
  const [lang, code] = isJapanese(src) ? ['Japanese', 'ja'] : ['English', 'en'];
  const t = code === 'en' ? sentenceCase(src) : src;
  if (model.includes('translategemma')) {
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

async function translate(cfg, src) {
  if (explainedSound(src)) return src;
  const model = await pickModel(cfg);
  const key = model + '\n' + src;
  if (cache.has(key)) return cache.get(key);
  const j = await ollama(cfg, '/api/chat', {
    model, stream: false, keep_alive: '30m',
    options: { temperature: 0.2 },
    messages: [{ role: 'user', content: prompt(model, src) }],
  });
  const out = (j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["«]|["»]$/g, '').trim();
  cache.set(key, out);
  return out;
}

// ---------- Messaggi ----------

const pages = new Map(); // src -> scritte già lette

/** Solo lettura: le traduzioni le chiede la pagina una alla volta, così compaiono man mano. */
async function page(src, data) {
  if (pages.has(src)) return pages.get(src);
  const [ocr, img] = await Promise.all([getOcr(), loadImage(data || src)]);
  const t0 = performance.now();
  const found = balloons(await ocr.read(img)).map(b => ({ box: b.box, text: b.text }));
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
  const run = { pagina: () => page(msg.src, msg.data), traduci: async () => ({ it: await translate(await settings(), msg.text) }), prova: test, modelli: async () => ({ modelli: await models(await settings()) }) }[msg.type];
  if (!run) return;
  if (msg.type !== 'pagina' && msg.type !== 'traduci') autoModel = null; // dopo un cambio di impostazioni riscelgo il modello
  run().then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});
