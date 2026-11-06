// Finestrella dell'icona: impostazioni e prova di Ollama.
import { PREDEFINITE } from './impostazioni.js';

const $ = id => document.getElementById(id);
const esito = t => { $('esito').textContent = t; };
const ask = msg => chrome.runtime.sendMessage({ to: 'background', ...msg });

async function loadModels(current, correttore) {
  const r = await ask({ type: 'modelli' });
  for (const [id, val] of [['modello', current], ['correttore', correttore]]) {
    const sel = $(id);
    sel.length = 1;
    if (r?.error) continue;
    for (const m of r.modelli) sel.add(new Option(m, m));
    if (val && !r.modelli.includes(val)) sel.add(new Option(val + ' (non trovato)', val));
    sel.value = val;
  }
  if (r?.error) esito(r.error);
}

/** La scheda della serie aperta in questa scheda del browser (la chiedo alla pagina). */
async function loadSerie(tab) {
  const r = await chrome.tabs.sendMessage(tab.id, { to: 'pagina', type: 'serie' }).catch(() => null);
  if (!r) return;
  $('serie').hidden = false;
  $('titolo').textContent = r.titolo || 'questo sito';
  $('scheda').value = r.scheda;
  $('nomiV').textContent = r.nomi.length ? 'Nomi trovati leggendo: ' + r.nomi.slice(0, 30).join(', ') : '';
  $('salvaScheda').onclick = async () => {
    await chrome.tabs.sendMessage(tab.id, { to: 'pagina', type: 'salvaScheda', scheda: $('scheda').value });
    esito('Scheda salvata: vale da questa pagina in poi.');
  };
}

async function init() {
  const cfg = { ...PREDEFINITE, ...(await chrome.storage.sync.get(PREDEFINITE)) };
  $('ollama').value = cfg.ollama;
  $('intera').checked = cfg.intera;
  $('intera').onchange = () => chrome.storage.sync.set({ intera: $('intera').checked });
  for (const k of ['opacita', 'testo']) { $(k).value = cfg[k]; $(k + 'V').textContent = cfg[k]; }
  loadModels(cfg.modello, cfg.correttore);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let mode = (await ask({ type: 'stato', tabId: tab?.id }))?.mode || null;
  if (tab) loadSerie(tab);
  const NOMI = { fumetto: 'Leggi fumetto', novel: 'Leggi novel' };
  const show = () => {
    for (const k of ['fumetto', 'novel']) {
      $(k).textContent = mode === k ? 'Ferma' : NOMI[k];
      $(k).classList.toggle('acceso', mode === k);
    }
  };
  show();
  for (const k of ['fumetto', 'novel']) {
    $(k).onclick = async () => {
      if (!tab) return;
      mode = mode === k ? null : k;
      await ask(mode ? { type: 'avvia', mode, tabId: tab.id } : { type: 'ferma', tabId: tab.id });
      show();
      if (mode) window.close();
    };
  }
  $('ollama').onchange = async () => {
    await chrome.storage.sync.set({ ollama: $('ollama').value.trim() || PREDEFINITE.ollama });
    loadModels($('modello').value, $('correttore').value);
  };
  $('modello').onchange = () => chrome.storage.sync.set({ modello: $('modello').value });
  $('correttore').onchange = () => chrome.storage.sync.set({ correttore: $('correttore').value });
  for (const k of ['opacita', 'testo']) {
    $(k).oninput = () => { $(k + 'V').textContent = $(k).value; chrome.storage.sync.set({ [k]: Number($(k).value) }); };
  }
  $('prova').onclick = async () => {
    esito('Provo… la prima volta Ollama carica il modello, può volerci un po\'.');
    const r = await ask({ type: 'prova' });
    esito(r?.error ? r.error : `${r.model} in ${r.secondi}s:\n«${r.it}»`);
  };
  $('ritraduci').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.sendMessage(tab.id, { to: 'pagina', type: 'ritraduci' }).catch(() => esito('Ricarica la pagina e riprova.'));
    window.close();
  };
}

init();
