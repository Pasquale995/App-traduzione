// Modalità novel: il testo è già nella pagina, niente OCR. Traduco i paragrafi man mano che ci arrivi
// e metto l'italiano sotto ognuno.
import { stato } from './stato.js';

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,dt,td,th,figcaption,div';
const LETTERS = /[A-Za-z぀-ヿ㐀-䶿一-鿿]/g;
const BATCH_ITEMS = 12;
const BATCH_CHARS = 2000;

/** Testo del paragrafo senza furigana (<rt>) e senza le traduzioni già messe. */
function textOf(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('rt, rp, .mercurio-novel, script, style').forEach(e => e.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}

function isParagraph(el) {
  if (el.closest('.mercurio-novel, .mercurio-etichetta, script, style, noscript, textarea, [contenteditable=""], [contenteditable="true"]')) return false;
  // Un div conta solo se non contiene altri blocchi (altrimenti lo traduco pezzo per pezzo).
  if (el.tagName === 'DIV' && el.querySelector(BLOCKS)) return false;
  if (el.tagName !== 'DIV' && el.querySelector('p,div,li,blockquote')) return false;
  const t = textOf(el);
  return (t.match(LETTERS) || []).length >= 2;
}

export class Novel {
  constructor(send, cfg) {
    this.send = send;
    this.cfg = cfg;
    this.seen = new WeakSet();     // paragrafi già presi in carico
    this.pending = new Set();      // visibili (o quasi) e non ancora tradotti
    this.busy = false;
    this.running = false;
    this.count = 0;
    this.last = []; // ultimi paragrafi tradotti: contesto per il gruppo dopo
    this.watcher = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting || this.seen.has(e.target)) continue;
        this.pending.add(e.target);
      }
      this.pump();
    }, { rootMargin: '1500px 0px' });
    this.mutations = new MutationObserver(() => {
      clearTimeout(this.rescan);
      this.rescan = setTimeout(() => this.scan(), 500);
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.count = 0;
    this.scan();
    this.mutations.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      if (this.running && !this.count && !this.pending.size && !this.busy) stato('non trovo testo da tradurre in questa pagina', 'errore');
    }, 3000);
  }

  stop() {
    this.running = false;
    this.watcher.disconnect();
    this.mutations.disconnect();
    this.pending.clear();
    document.querySelectorAll('.mercurio-novel').forEach(e => e.remove());
    this.seen = new WeakSet();
  }

  restart() {
    this.stop();
    this.start();
  }

  scan() {
    if (!this.running) return;
    for (const el of document.body.querySelectorAll(BLOCKS)) {
      if (el._mercurioNovel || !isParagraph(el)) continue;
      el._mercurioNovel = true;
      this.watcher.observe(el);
    }
  }

  async pump() {
    if (this.busy || !this.running) return;
    this.busy = true;
    try {
      while (this.running && this.pending.size) {
        // In ordine di pagina, a gruppi: una richiesta per gruppo.
        const all = [...this.pending].filter(e => e.isConnected)
          .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        this.pending.clear();
        while (all.length && this.running) {
          const batch = [];
          let chars = 0;
          while (all.length && batch.length < BATCH_ITEMS && (chars < BATCH_CHARS || !batch.length)) {
            const el = all.shift();
            const text = textOf(el);
            chars += text.length;
            batch.push({ el, text, out: this.placeholder(el) });
            this.seen.add(el);
          }
          await this.translate(batch);
          // Arrivati nuovi paragrafi mentre traducevo: li rimetto in fila con gli altri.
          for (const e of this.pending) if (!all.includes(e)) all.push(e);
          this.pending.clear();
        }
      }
      if (this.running) stato(`testo tradotto (${this.count} paragrafi)`, 'fatto');
    } finally {
      this.busy = false;
    }
  }

  placeholder(el) {
    const out = document.createElement('span');
    out.className = 'mercurio-novel attesa';
    out.textContent = '…';
    el.appendChild(out);
    return out;
  }

  async translate(batch) {
    stato(`traduco ${batch.length} paragrafi… (${this.count} fatti)`, 'lavoro');
    let its = null;
    if (batch.length > 1) {
      const r = await this.send({ to: 'background', type: 'traduciPagina', texts: batch.map(b => b.text), context: this.last });
      if (r?.error) return this.fail(batch, r.error);
      its = r?.its;
    }
    // Uno alla volta se la richiesta unica non è tornata con i numeri giusti.
    for (let i = 0; i < batch.length; i++) {
      if (!this.running) return;
      let it = its?.[i];
      if (it == null) {
        const r = await this.send({ to: 'background', type: 'traduci', text: batch[i].text });
        if (r?.error) return this.fail(batch.slice(i), r.error);
        it = r.it;
      }
      batch[i].out.textContent = it;
      batch[i].out.classList.remove('attesa');
      this.count++;
    }
    this.last = batch.slice(-2).map(b => b.text);
  }

  fail(batch, error) {
    stato(error, 'errore');
    for (const b of batch) {
      b.out.remove();
      this.seen.delete(b.el); // si riprova quando ci torni sopra
      this.watcher.unobserve(b.el);
      this.watcher.observe(b.el);
    }
    this.running = false; // fermo tutto finché non si risolve, sennò ripete l'errore a raffica
  }
}
