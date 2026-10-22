// L'etichetta fissa in basso a destra che dice cosa sta facendo Mercurio.
let el = null;
let timer = 0;

/** kind: 'lavoro' (grigia), 'fatto' (grigia, sparisce da sola), 'errore' (rossa, sparisce dopo un po'). */
export function stato(text, kind = 'lavoro') {
  clearTimeout(timer);
  if (!text) { el?.remove(); el = null; return; }
  if (!el?.isConnected) {
    el = document.createElement('div');
    el.className = 'mercurio-etichetta';
    document.documentElement.appendChild(el);
  }
  el.textContent = 'Mercurio: ' + text;
  el.classList.toggle('errore', kind === 'errore');
  if (kind !== 'lavoro') timer = setTimeout(() => { el?.remove(); el = null; }, kind === 'fatto' ? 3000 : 15000);
}
