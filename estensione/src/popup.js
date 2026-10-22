// Finestrella dell'icona: impostazioni e prova di Ollama.
import { PREDEFINITE } from './impostazioni.js';

const $ = id => document.getElementById(id);
const esito = t => { $('esito').textContent = t; };
const ask = msg => chrome.runtime.sendMessage({ to: 'background', ...msg });

async function loadModels(current) {
  const r = await ask({ type: 'modelli' });
  const sel = $('modello');
  sel.length = 1;
  if (r?.error) { esito(r.error); return; }
  for (const m of r.modelli) sel.add(new Option(m, m));
  if (current && !r.modelli.includes(current)) sel.add(new Option(current + ' (non trovato)', current));
  sel.value = current;
}

async function init() {
  const cfg = { ...PREDEFINITE, ...(await chrome.storage.sync.get(PREDEFINITE)) };
  $('ollama').value = cfg.ollama;
  $('intera').checked = cfg.intera;
  $('intera').onchange = () => chrome.storage.sync.set({ intera: $('intera').checked });
  for (const k of ['opacita', 'testo']) { $(k).value = cfg[k]; $(k + 'V').textContent = cfg[k]; }
  loadModels(cfg.modello);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let on = !!(await ask({ type: 'stato', tabId: tab?.id }))?.on;
  const showOn = () => {
    $('avvia').textContent = on ? 'Ferma su questa scheda' : 'Avvia su questa scheda';
    $('avvia').classList.toggle('acceso', on);
  };
  showOn();
  $('avvia').onclick = async () => {
    if (!tab) return;
    on = !on;
    await ask({ type: on ? 'avvia' : 'ferma', tabId: tab.id });
    showOn();
    if (on) window.close();
  };
  $('ollama').onchange = async () => {
    await chrome.storage.sync.set({ ollama: $('ollama').value.trim() || PREDEFINITE.ollama });
    loadModels($('modello').value);
  };
  $('modello').onchange = () => chrome.storage.sync.set({ modello: $('modello').value });
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
