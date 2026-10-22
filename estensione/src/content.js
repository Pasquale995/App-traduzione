// Nella pagina del fumetto: trova le tavole, chiede la traduzione e disegna i riquadri sopra le nuvolette.
import { PREDEFINITE } from './impostazioni.js';

let cfg = { ...PREDEFINITE };
const MIN_W = 300, MIN_H = 200, MIN_SHOWN = 250;

const done = new WeakMap();   // img -> { src, layer, result }
const queue = [];
let busy = false;

const isCandidate = img =>
  img.naturalWidth >= MIN_W && img.naturalHeight >= MIN_H && img.getBoundingClientRect().width >= MIN_SHOWN;

const srcOf = img => img.currentSrc || img.src;

// ---------- Coda: una tavola alla volta, così il PC non si blocca ----------

function enqueue(img) {
  if (!cfg.attivo || !isCandidate(img)) return;
  const src = srcOf(img);
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
  const d = done.get(img);
  if (d && d.src === src) return;
  done.set(img, { src, layer: d?.layer, result: null });
  if (!queue.includes(img)) queue.push(img);
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    // Prima quella più vicina a dove sta leggendo.
    queue.sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
    const img = queue.shift();
    const d = done.get(img);
    if (!d || !cfg.attivo) continue;
    const layer = layerFor(img);
    badge(layer, 'Mercurio: leggo…', false);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ to: 'background', type: 'pagina', src: d.src });
      if (res?.error?.startsWith('il sito non mi dà')) {
        // Alcuni siti danno le immagini solo dalla loro pagina: la scarico da qui e la passo.
        const data = await fromPage(d.src);
        if (data) res = await chrome.runtime.sendMessage({ to: 'background', type: 'pagina', src: d.src, data });
      }
    } catch (e) {
      res = { error: String(e?.message || e) };
    }
    if (done.get(img) !== d) continue; // l'immagine è cambiata nel frattempo
    if (res?.error) {
      badge(layer, 'Mercurio: ' + res.error, true);
      d.src = null; // si potrà riprovare
      continue;
    }
    d.result = res;
    badge(layer, null);
    draw(img);
  }
  busy = false;
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
  s.display = r.width > 0 && cfg.attivo ? '' : 'none';
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

/** Rimpicciolisce il testo finché entra nel riquadro; se non basta, allunga il riquadro. */
function fit(el, h) {
  let size = Math.round(16 * cfg.testo / 100);
  el.style.fontSize = size + 'px';
  el.style.height = 'auto';
  el.style.minHeight = h + 'px';
  while (el.scrollHeight > h + 1 && size > 8) {
    size--;
    el.style.fontSize = size + 'px';
  }
}

function badge(layer, text, error) {
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
  document.querySelectorAll('img').forEach(img => {
    const d = done.get(img);
    if (d?.layer) {
      if (!img.isConnected) { d.layer.remove(); done.delete(img); }
      else place(img);
    }
  });
}

let raf = 0;
const relayoutSoon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(relayoutAll); };
window.addEventListener('resize', relayoutSoon);
setInterval(relayoutAll, 1500); // i siti spostano le tavole mentre caricano

// ---------- Impostazioni ----------

function redrawAll() {
  document.querySelectorAll('.mercurio-strato').forEach(l => { l.style.display = cfg.attivo ? '' : 'none'; });
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
  else if (changes.attivo?.newValue) { redrawAll(); scan(); retranslateAll(); }
  else redrawAll();
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.to === 'pagina' && msg.type === 'ritraduci') retranslateAll();
});

chrome.storage.sync.get(PREDEFINITE).then(v => {
  cfg = { ...PREDEFINITE, ...v };
  scan();
});
