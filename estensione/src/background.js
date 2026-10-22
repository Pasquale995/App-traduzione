import { PREDEFINITE } from './impostazioni.js';

// Fa da ponte: le pagine chiedono, il documento nascosto (offscreen) legge e traduce.
const OFFSCREEN = 'offscreen.html';
let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['WORKERS'],
    justification: 'Legge le scritte dei fumetti con PaddleOCR e le traduce con Ollama',
  }).finally(() => { creating = null; });
  await creating;
}

// ---------- Acceso / spento, scheda per scheda ----------

// Per ogni scheda accesa: 'fumetto' oppure 'novel'.
async function modes() {
  return (await chrome.storage.session.get({ modi: {} })).modi;
}

async function setTab(tabId, mode) {
  const m = await modes();
  if (mode) m[tabId] = mode; else delete m[tabId];
  await chrome.storage.session.set({ modi: m });
  await chrome.action.setBadgeText({ tabId, text: mode ? 'ON' : '' });
  if (mode) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#fa1e4e' });
  chrome.tabs.sendMessage(tabId, { to: 'pagina', type: 'acceso', mode: mode || null }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(async tabId => {
  const m = await modes();
  if (m[tabId]) { delete m[tabId]; await chrome.storage.session.set({ modi: m }); }
});

// Cambiando pagina il badge si azzera: lo rimetto se la scheda è accesa.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && (await modes())[tabId]) chrome.action.setBadgeText({ tabId, text: 'ON' });
});

// ---------- Mercurio Motore: il programma sul PC, acceso solo mentre si legge ----------

const HOST = 'it.pask.mercurio';
const SPEGNI_DOPO = 5 * 60 * 1000; // 5 minuti senza traduzioni: spengo e libero la scheda video
let port = null;
let ready = null;
let nextId = 1;
const waiting = new Map();
let stopTimer = 0;

function friendly(err = '') {
  if (/not found/i.test(err)) return 'Mercurio Motore non è installato: scarica e apri MercurioMotore.exe';
  if (/forbidden/i.test(err)) return 'Mercurio Motore non riconosce questa estensione: riapri MercurioMotore.exe e reinstalla';
  if (/exited/i.test(err)) return 'Mercurio Motore si è chiuso: riapri MercurioMotore.exe e fai "Prova la traduzione"';
  return 'Mercurio Motore: ' + (err || 'collegamento perso');
}

function call(cmd, onEvent) {
  if (!port) {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(m => {
      if (m.evento) { for (const w of waiting.values()) w.onEvent?.(m.testo); return; }
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      w?.resolve(m);
    });
    port.onDisconnect.addListener(() => {
      const err = friendly(chrome.runtime.lastError?.message);
      port = null;
      ready = null;
      for (const w of waiting.values()) w.resolve({ ok: false, errore: err });
      waiting.clear();
    });
  }
  return new Promise(resolve => {
    const id = nextId++;
    waiting.set(id, { resolve, onEvent });
    port.postMessage({ cmd, id });
  });
}

/** Accende il motore se serve e restituisce { modello, backend }. */
function avviaMotore(onEvent) {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(spegniMotore, SPEGNI_DOPO);
  ready ??= call('avvia', onEvent).then(r => {
    if (!r.ok) { ready = null; throw new Error(r.errore || 'Mercurio Motore non parte'); }
    return r;
  });
  return ready;
}

function spegniMotore() {
  clearTimeout(stopTimer);
  if (!port) return;
  call('ferma').finally(() => { port?.disconnect(); port = null; ready = null; });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.to !== 'background') return;
  if (msg.type === 'motore') {
    // Dal popup: stato del motore (lo accende per provarlo).
    avviaMotore().then(r => reply(r), e => reply({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'stato') {
    const tabId = msg.tabId ?? sender.tab?.id;
    modes().then(m => reply({ mode: m[tabId] || null }));
    return true;
  }
  if (msg.type === 'avvia' || msg.type === 'ferma') {
    setTab(msg.tabId, msg.type === 'avvia' ? msg.mode || 'fumetto' : null).then(() => reply({ ok: true }), e => reply({ error: String(e?.message || e) }));
    return true;
  }
  (async () => {
    // Il documento nascosto non vede chrome.storage: gli passo io le impostazioni.
    const cfg = { ...PREDEFINITE, ...(await chrome.storage.sync.get(PREDEFINITE)) };
    if (cfg.motore === 'mercurio' && ['traduci', 'traduciPagina', 'prova', 'modelli'].includes(msg.type)) {
      let avvisato = false;
      const avvisa = testo => sender.tab && chrome.tabs.sendMessage(sender.tab.id, { to: 'pagina', type: 'stato', testo }).catch(() => {});
      const t = setTimeout(() => { avvisato = true; avvisa('accendo Mercurio Motore…'); }, 300);
      let r;
      try {
        r = await avviaMotore(testo => avvisa(testo));
      } finally {
        clearTimeout(t); // sennò l'avviso "accendo…" coprirebbe l'errore
      }
      if (avvisato) avvisa('motore acceso, traduco…');
      cfg.motoreModello = r.modello;
      cfg.motorePorta = r.porta;
    }
    await ensureOffscreen();
    // Appena creato, il documento nascosto può non essere ancora in ascolto: riprovo un attimo.
    for (let i = 0; ; i++) {
      try {
        return await chrome.runtime.sendMessage({ ...msg, cfg, to: 'offscreen' });
      } catch (e) {
        if (i >= 20 || !String(e?.message).includes('Receiving end')) throw e;
        await new Promise(r => setTimeout(r, 150));
      }
    }
  })().then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});
