// Documento nascosto dell'estensione: scarica l'immagine, legge le scritte e le traduce.
import * as ort from 'onnxruntime-web/webgpu';
import { PaddleOcr } from './ocr.js';
import { loadWords, balloons, sentenceCase, isJapanese, readingOrder, nameCandidates } from './testo.js';
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

async function ollama(cfg, path, body, maxMs = 0) {
  const base = cfg.ollama.trim().replace(/\/+$/, '');
  const stop = new AbortController();
  const timer = maxMs && setTimeout(() => stop.abort(), maxMs);
  let res;
  try {
    res = await fetch(base + path, { signal: stop.signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (res.ok) return await res.json();
  } catch {
    if (stop.signal.aborted) throw new Error('ci mette troppo');
    throw new Error('Ollama non risponde: è aperto sul PC?');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 403) throw new Error("Ollama rifiuta l'estensione: imposta OLLAMA_ORIGINS=chrome-extension://* e riavvialo");
  throw new Error(`Ollama ha risposto ${res.status}: ${(await res.text()).slice(0, 150)}`);
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

function prompt(model, src, japanese = isJapanese(src), names = []) {
  const [lang, code] = japanese ? ['Japanese', 'ja'] : ['English', 'en'];
  const t = code === 'en' ? sentenceCase(src, names) : src;
  if (model.includes('translategemma')) {
    // Il formato fisso con cui Google ha addestrato TranslateGemma.
    return `You are a professional ${lang} (${code}) to Italian (it) translator. Your goal is to accurately convey ` +
      `the meaning and nuances of the original ${lang} text while adhering to Italian grammar, vocabulary, and ` +
      `cultural sensitivities.\nProduce only the Italian translation, without any additional explanations or ` +
      `commentary. Please translate the following ${lang} text into Italian:\n\n\n${t}`;
  }
  const used = names.filter(n => t.toLowerCase().includes(n.toLowerCase()));
  return `Translate this ${lang} comic book text into natural Italian, keeping tone, slang and jokes. ` +
    `The text comes from OCR and may contain small errors: fix them silently. ` +
    (used.length ? `These are names from the story, keep them as they are: ${used.join(', ')}. ` : '') +
    `Answer with only the Italian translation.\n\n${t}`;
}

const explainedSound = t => /\)$/.test(t) && t.includes(' (') && !/[a-z]/.test(t.split(' (')[0]);

async function translate(cfg, src, names = []) {
  if (explainedSound(src)) return src;
  const model = await pickModel(cfg);
  const key = model + '\n' + src;
  if (cache.has(key)) return cache.get(key);
  const j = await ollama(cfg, '/api/chat', {
    model, stream: false, keep_alive: '30m',
    options: { temperature: 0.2, num_predict: 400 }, // tetto: un modello che si inceppa non deve andare avanti all'infinito
    messages: [{ role: 'user', content: prompt(model, src, isJapanese(src), names) }],
  });
  const out = (j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["«]|["»]$/g, '').trim();
  cache.set(key, out);
  return out;
}

const CONTESTO = 6; // battute precedenti date al modello insieme alla pagina

/**
 * Tutta la pagina in una richiesta: le nuvolette numerate "1. …", così il modello vede la scena intera.
 * Restituisce null se la risposta non torna con gli stessi numeri (allora si va una nuvoletta alla volta).
 */
async function translatePage(cfg, texts, context = [], names = []) {
  const model = await pickModel(cfg);
  const its = texts.map(t => explainedSound(t) ? t : cache.get(model + '\n' + t));
  const todo = texts.map((t, i) => [t, i]).filter(([, i]) => its[i] == null);
  if (todo.length === 1) its[todo[0][1]] = await translate(cfg, todo[0][0], names);
  else if (todo.length > 1) {
    const japanese = todo.filter(([t]) => isJapanese(t)).length * 2 > todo.length;
    // Le ultime battute lette prima vanno in testa, solo per contesto: la loro traduzione la scarto.
    const ctx = context.filter(t => t && isJapanese(t) === japanese).slice(-CONTESTO);
    const lines = [...ctx, ...todo.map(([t]) => t)];
    const numbered = lines.map((t, n) => `${n + 1}. ${japanese ? t : sentenceCase(t, names)}`).join('\n');
    const j = await ollama(cfg, '/api/chat', {
      model, stream: false, keep_alive: '30m',
      options: { temperature: 0.2, num_predict: 100 * lines.length + 200 },
      messages: [{ role: 'user', content: prompt(model, numbered, japanese, names) }],
    });
    const raw = (j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
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

// ---------- Secondo passaggio: il correttore ----------

/** Le righe "N. testo" della risposta, anche quando il modello va a capo dentro una battuta. */
function numbered(raw) {
  const got = new Map();
  let last = 0;
  for (const line of raw.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n')) {
    const m = line.match(/^\s*\**(\d+)\**\s*[.)\]:-]\s*(.*)$/);
    if (m) { last = Number(m[1]); got.set(last, m[2].trim()); }
    else if (last && line.trim()) got.set(last, got.get(last) + ' ' + line.trim());
  }
  return got;
}

/**
 * Un modello generale rilegge la bozza di TranslateGemma sapendo che fumetto è, cosa è successo prima
 * e come si chiamano personaggi e cose. Restituisce le nuove traduzioni (null dove non ha risposto bene).
 */
async function revise(cfg, { titolo, scheda, nomi = [], coppie = [], righe }) {
  const model = cfg.correttore;
  const japanese = righe.filter(r => isJapanese(r.o)).length * 2 > righe.length;
  const lang = japanese ? 'Japanese' : 'English';
  const fix = t => japanese ? t : sentenceCase(t, nomi);
  const parts = [
    `You are the Italian adapter of the comic${titolo ? ` "${titolo}"` : ''}. A small model made a first Italian translation of the balloons of one page; it is often too literal or wrong.`,
    `The ${lang} text was read by OCR, so it can contain misread words: guess the intended word from the context.`,
  ];
  if (scheda?.trim()) parts.push(`Notes about this series (use these names and terms, they always win):\n${scheda.trim()}`);
  if (nomi.length) parts.push(`Names that appear in this series: ${nomi.slice(0, 80).join(', ')}.`);
  if (coppie.length) parts.push(`Previous balloons, for context only:\n` + coppie.map(c => `- ${fix(c.o)} → ${c.it}`).join('\n'));
  parts.push(`For every numbered balloon write the final Italian text: natural spoken Italian as in a published comic, short, faithful to the meaning and to who is speaking. ` +
    `Keep the same numbers, exactly one line per number, and write nothing else.`);
  parts.push(righe.map((r, i) => `${i + 1}. ${lang}: ${fix(r.o)}\n   Bozza: ${r.it}`).join('\n'));
  const body = {
    model, stream: false, keep_alive: '30m',
    // Tetto alle parole: senza, un modello che si mette a "ragionare" tiene la scheda video al 100% per minuti.
    options: { temperature: 0.3, num_predict: 100 * righe.length + 200 },
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  };
  // I modelli che "pensano" prima di rispondere (Qwen3, DeepSeek R1…): niente ragionamento, solo la risposta.
  if (/qwen3|deepseek-r1|magistral|gpt-oss/i.test(model)) body.think = false;
  // Due minuti bastano anche per caricare il modello la prima volta; oltre, si tiene la bozza.
  const j = await ollama(cfg, '/api/chat', body, 120000);
  const got = numbered(j.message?.content || '');
  return righe.map((_, i) => {
    const t = got.get(i + 1)?.replace(/^(Italian|Italiano|Finale|Bozza)\s*:\s*/i, '').replace(/^["«]|["»]$/g, '').trim();
    return t || null;
  });
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
  const result = { w: img.width, h: img.height, balloons: found, nomi: nameCandidates(found.map(b => b.text)), ms: Math.round(performance.now() - t0), backend };
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
  const run = { pagina: () => page(msg.src, msg.data), traduci: async () => ({ it: await translate(await settings(), msg.text, msg.nomi) }),
    traduciPagina: async () => ({ its: await translatePage(await settings(), msg.texts, msg.context, msg.nomi) }), correggi: async () => ({ its: await revise(await settings(), msg) }), prova: test, modelli: async () => ({ modelli: await models(await settings()) }) }[msg.type];
  if (!run) return;
  if (!['pagina', 'traduci', 'traduciPagina', 'correggi'].includes(msg.type)) autoModel = null; // dopo un cambio di impostazioni riscelgo il modello
  run().then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});
