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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.to !== 'background') return;
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
