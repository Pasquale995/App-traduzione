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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.to !== 'background') return;
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
