// Nella pagina del fumetto: trova le tavole, chiede la traduzione e disegna i riquadri sopra le nuvolette.
import { PREDEFINITE } from './impostazioni.js';
import { stato } from './stato.js';
import { Novel } from './novel.js';

let cfg = { ...PREDEFINITE };
let on = false; // modalità fumetto: si accende solo dal popup, scheda per scheda
let novel = null; // modalità novel: traduce il testo della pagina
let mode = null;
const MIN_W = 300, MIN_H = 200, MIN_SHOWN = 250;

const done = new WeakMap();   // img -> { src, layer, result }
const shown = new Set(); // immagini con uno strato: se il sito le toglie (cambio capitolo) nascondo le loro traduzioni
const queue = [];
let lastTexts = []; // ultime battute tradotte: contesto per la pagina dopo
let busy = false;

const isCandidate = img =>
  img.naturalWidth >= MIN_W && img.naturalHeight >= MIN_H && img.getBoundingClientRect().width >= MIN_SHOWN;

const srcOf = img => img.currentSrc || img.src;

// ---------- Coda: una tavola alla volta, così il PC non si blocca ----------

function enqueue(img) {
  if (!on || !isCandidate(img)) return;
  const src = srcOf(img);
  if (!src) return;
  const d = done.get(img);
  if (d && d.src === src) return;
  // Pagina cambiata nella stessa immagine (lettori manga): via subito le traduzioni vecchie.
  d?.layer?.querySelectorAll('.mercurio-riquadro').forEach(e => e.remove());
  done.set(img, { src, layer: d?.layer, result: null });
  if (!queue.includes(img)) queue.push(img);
  pump();
}

export async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    const m = String(e?.message || e);
    return { error: /context invalidated/i.test(m) ? 'Mercurio è stato aggiornato: ricarica la pagina (F5)' : m };
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) await work();
  } finally {
    busy = false;
  }
}

async function work() {
  {
    // Prima quella più vicina a dove sta leggendo.
    queue.sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
    const img = queue.shift();
    const d = done.get(img);
    if (!d || !on) return;
    const layer = layerFor(img);
    badge(layer, 'Mercurio: leggo…', false);
    let res;
    try {
      // Immagini che esistono solo nella pagina (blob:): le passo io.
      const local = d.src.startsWith('blob:') || d.src.startsWith('data:');
      res = local
        ? await send({ to: 'background', type: 'pagina', src: d.src, data: await fromPage(d.src) })
        : await send({ to: 'background', type: 'pagina', src: d.src });
      if (!local && res?.error?.startsWith('il sito non mi dà')) {
        // Alcuni siti danno le immagini solo dalla loro pagina: la scarico da qui e la passo.
        const data = await fromPage(d.src);
        if (data) res = await send({ to: 'background', type: 'pagina', src: d.src, data });
      }
    } catch (e) {
      res = { error: String(e?.message || e) };
    }
    if (done.get(img) !== d) return; // l'immagine è cambiata nel frattempo
    if (res?.error) {
      badge(layer, 'Mercurio: ' + res.error, true);
      d.src = null; // si potrà riprovare
      return;
    }
    d.result = res;
    let n = 0;
    if (cfg.intera && res.balloons.length > 1) {
      // Tutta la pagina in una richiesta; se la risposta non torna, ripiego una alla volta.
      badge(layer, `Mercurio: traduco la pagina (${res.balloons.length})`, false);
      const t = await send({ to: 'background', type: 'traduciPagina', texts: res.balloons.map(b => b.text), context: lastTexts });
      if (done.get(img) !== d) return;
      if (t?.error) { badge(layer, 'Mercurio: ' + t.error, true); d.src = null; return; }
      if (t?.its) {
        res.balloons.forEach((b, i) => { b.it = t.its[i]; });
        n = res.balloons.length;
        draw(img);
      }
    }
    // Una nuvoletta alla volta, disegnata appena pronta.
    for (const b of n ? [] : res.balloons) {
      if (done.get(img) !== d || !on || !img.isConnected || img.getBoundingClientRect().width === 0) break;
      badge(layer, `Mercurio: traduco ${++n}/${res.balloons.length}`, false);
      const t = await send({ to: 'background', type: 'traduci', text: b.text });
      if (t?.error) { badge(layer, 'Mercurio: ' + t.error, true); break; }
      b.it = t.it;
      if (done.get(img) === d) draw(img);
    }
    if (res.balloons.length) lastTexts = res.balloons.slice(-3).map(b => b.text);
    if (done.get(img) === d && n === res.balloons.length) badge(layer, null);
    else if (done.get(img) === d) d.src = null; // interrotta: la riprendo quando torna visibile
  }
}

async function fromPage(src) {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = ko;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ---------- Disegno ----------

function layerFor(img) {
  const d = done.get(img);
  if (d.layer?.isConnected) return d.layer;
  const layer = document.createElement('div');
  layer.className = 'mercurio-strato';
  document.body.appendChild(layer);
  d.layer = layer;
  shown.add(img);
  place(img);
  return layer;
}

function place(img) {
  const d = done.get(img);
  if (!d?.layer) return;
  const r = img.getBoundingClientRect();
  const s = d.layer.style;
  s.left = r.left + window.scrollX + 'px';
  s.top = r.top + window.scrollY + 'px';
  s.width = r.width + 'px';
  s.height = r.height + 'px';
  s.display = r.width > 0 && on ? '' : 'none';
  const k = d.result ? r.width / d.result.w : 0;
  if (k && Math.abs((d.k || 0) - k) > 0.001) draw(img);
}

function draw(img) {
  const d = done.get(img);
  if (!d?.result) return;
  const layer = layerFor(img);
  const r = img.getBoundingClientRect();
  const k = r.width / d.result.w;
  d.k = k;
  layer.querySelectorAll('.mercurio-riquadro').forEach(e => e.remove());
  for (const b of d.result.balloons) {
    if (!b.it) continue;
    const el = document.createElement('div');
    el.className = 'mercurio-riquadro';
    el.textContent = b.it;
    el.title = b.text;
    const pad = 4;
    Object.assign(el.style, {
      left: b.box.x * k - pad + 'px', top: b.box.y * k - pad + 'px',
      width: b.box.w * k + 2 * pad + 'px', height: b.box.h * k + 2 * pad + 'px',
      opacity: String(cfg.opacita / 100),
    });
    layer.appendChild(el);
    fit(el, b.box.h * k + 2 * pad);
  }
}

const MIN_FONT = 11; // sotto non si legge più

/**
 * Rimpicciolisce il testo finché entra nel riquadro. Se anche al minimo non entra,
 * allarga il riquadro (restando centrato e dentro la tavola) e poi lo allunga: il testo non si taglia mai.
 */
function fit(el, h) {
  let size = Math.max(MIN_FONT, Math.round(16 * cfg.testo / 100));
  const floor = Math.max(MIN_FONT, Math.round(size * 0.7)); // oltre, meglio allargare il riquadro
  const overflows = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > h + 1;
  el.style.fontSize = size + 'px';
  el.style.height = 'auto';
  el.style.minHeight = h + 'px';
  while (overflows() && size > floor) {
    size--;
    el.style.fontSize = size + 'px';
  }
  // Parole troppo lunghe per la larghezza: allargo quanto serve.
  const layerW = el.parentElement.clientWidth;
  let w = el.offsetWidth;
  while (el.scrollWidth > el.clientWidth + 1 && w < layerW) {
    const grow = Math.min(el.scrollWidth - el.clientWidth + 6, layerW - w);
    const left = Math.max(0, Math.min(layerW - w - grow, parseFloat(el.style.left) - grow / 2));
    w += grow;
    el.style.width = w + 'px';
    el.style.left = left + 'px';
  }
  // Se ancora non basta (tavola stretta), spezzo le parole piuttosto che tagliarle.
  if (el.scrollWidth > el.clientWidth + 1) el.style.overflowWrap = 'anywhere';
}

function badge(layer, text, error) {
  if (text) stato(text.replace(/^Mercurio: /, ''), error ? 'errore' : 'lavoro');
  else stato(queue.length ? 'passo alla tavola successiva…' : 'pagina tradotta', queue.length ? 'lavoro' : 'fatto');
  let b = layer.querySelector('.mercurio-stato');
  if (!text) { b?.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.className = 'mercurio-stato';
    layer.appendChild(b);
  }
  b.textContent = text;
  b.style.background = error ? 'rgba(200,30,30,.9)' : 'rgba(40,40,40,.75)';
  clearTimeout(b._t);
  if (error) b._t = setTimeout(() => b.remove(), 15000);
}

// ---------- Osservo le immagini (anche quelle caricate scorrendo) ----------

const watcher = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) enqueue(e.target);
}, { rootMargin: '1200px 0px' });

function watch(img) {
  if (img._mercurio) return;
  img._mercurio = true;
  watcher.observe(img);
  img.addEventListener('load', () => {
    watcher.unobserve(img);
    watcher.observe(img); // ricontrolla dopo il caricamento pigro
  });
}

function scan(root = document) {
  root.querySelectorAll?.('img').forEach(watch);
}

new MutationObserver(muts => {
  for (const m of muts) {
    if (m.type === 'attributes' && m.target.tagName === 'IMG') {
      const d = done.get(m.target);
      if (d && d.src !== srcOf(m.target)) { d.layer?.remove(); done.delete(m.target); }
      watcher.unobserve(m.target);
      watcher.observe(m.target);
    }
    for (const n of m.addedNodes) {
      if (n.tagName === 'IMG') watch(n);
      else if (n.nodeType === 1) scan(n);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });

function relayoutAll() {
  // Tavole tolte dalla pagina: place() nasconde lo strato (larghezza 0). Tengo le traduzioni: se tornano, ricompaiono.
  for (const img of shown) if (!img.isConnected) { place(img); if (!done.get(img)?.layer?.isConnected) shown.delete(img); }
  document.querySelectorAll('img').forEach(img => {
    const d = done.get(img);
    if (d?.layer) {
      if (!img.isConnected) { d.layer.remove(); done.delete(img); }
      else place(img);
    }
    // Alcuni lettori cambiano pagina senza toccare l'attributo src (srcset, <picture>): me ne accorgo qui.
    if (d && d.src && d.src !== srcOf(img) && img.complete) enqueue(img);
    else if (!img._mercurio) watch(img);
  });
}

let raf = 0;
const relayoutSoon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(relayoutAll); };
window.addEventListener('resize', relayoutSoon);
setInterval(relayoutAll, 1500); // i siti spostano le tavole mentre caricano

// ---------- Impostazioni ----------

function redrawAll() {
  document.querySelectorAll('.mercurio-strato').forEach(l => { l.style.display = on ? '' : 'none'; });
  document.querySelectorAll('img').forEach(img => { if (done.get(img)?.result) draw(img); });
}

function retranslateAll() {
  document.querySelectorAll('.mercurio-strato').forEach(l => l.remove());
  document.querySelectorAll('img').forEach(img => { done.delete(img); watcher.unobserve(img); watcher.observe(img); });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [k, v] of Object.entries(changes)) cfg[k] = v.newValue ?? PREDEFINITE[k];
  if (changes.modello || changes.ollama) retranslateAll();
  else redrawAll();
});

function setOn(value) {
  if (on === value) return;
  on = value;
  if (on) {
    scan(); retranslateAll();
    // Se tra qualche secondo non ho trovato tavole, lo dico: magari è una novel.
    setTimeout(() => {
      if (on && !document.querySelector('.mercurio-strato')) stato('nessuna tavola trovata: se è testo, usa "Leggi novel"', 'errore');
    }, 4000);
  } else { queue.length = 0; redrawAll(); }
}

function setMode(m) {
  mode = m;
  setOn(mode === 'fumetto');
  if (mode === 'novel') { novel ??= new Novel(send, () => cfg); novel.start(); }
  else novel?.stop();
  if (!mode) stato(null);
  else stato(mode === 'fumetto' ? 'acceso: cerco le tavole…' : 'acceso: cerco il testo…', 'lavoro');
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.to !== 'pagina') return;
  if (msg.type === 'ritraduci') { if (on) retranslateAll(); if (mode === 'novel') novel?.restart(); }
  if (msg.type === 'acceso') setMode(msg.mode);
});

chrome.storage.sync.get(PREDEFINITE).then(async v => {
  cfg = { ...PREDEFINITE, ...v };
  scan();
  // Se in questa scheda l'avevi già avviato (es. capitolo successivo), riparte da solo.
  const r = await send({ to: 'background', type: 'stato' });
  if (r?.mode) setMode(r.mode);
});
