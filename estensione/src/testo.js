// Pulizia del testo letto e raggruppamento delle righe in balloon.
// È la stessa logica di TextCleaner.kt e ComicOcr.kt dell'app Android, riportata in JavaScript.

const SOUNDS = {
  whoosh: "spostamento d'aria", woosh: "spostamento d'aria", swoosh: 'fruscio veloce',
  fwoosh: 'fiammata', swish: 'fruscio', zoom: 'sfreccia', vroom: 'rombo di motore',
  boom: 'esplosione', kaboom: 'esplosione', bam: 'colpo', bang: 'sparo',
  pow: 'pugno', wham: 'colpo forte', whack: 'botta', bonk: 'botta in testa',
  smack: 'schiaffo', slap: 'schiaffo', punch: 'pugno', kick: 'calcio',
  crash: 'schianto', smash: 'fracasso', crack: 'crepa', snap: 'schiocco',
  thud: 'tonfo', thump: 'tonfo', slam: 'sbattuta', stomp: 'passo pesante',
  clang: 'clangore metallico', clank: 'rumore metallico', click: 'clic',
  creak: 'scricchiolio', crunch: 'scricchiolio', rumble: 'rombo', roar: 'ruggito',
  growl: 'ringhio', grr: 'ringhio', hiss: 'sibilo', buzz: 'ronzio', zap: 'scarica',
  splash: "schizzo d'acqua", drip: 'gocciolio', sizzle: 'sfrigolio', flash: 'lampo',
  slash: 'fendente', shing: 'lama sguainata', stab: 'pugnalata', slice: 'taglio',
  gasp: 'sussulto', sigh: 'sospiro', huff: 'sbuffo', hmph: 'sbuffo',
  pant: 'affanno', gulp: 'deglutisce', sniff: 'annusa', argh: 'urlo',
  aargh: 'urlo', ugh: 'disgusto', tch: 'schiocco di lingua', shh: 'silenzio',
  haha: 'risata', hahaha: 'risata', heh: 'risatina', hehe: 'risatina',
  boing: 'rimbalzo', poof: 'sparisce', pop: 'scoppio', ding: 'campanello',
  ring: 'squillo', knock: 'bussare', beep: 'bip', rustle: 'fruscio',
  flap: "battito d'ali", thwip: 'lancio', fwip: 'lancio', tremble: 'tremito',
  shake: 'scossa', grab: 'afferra', grip: 'stretta',
};

const COMMON = new Set(('room rush push wish fish dish bash cash wash pant bring thing king sing wing string boat boot ' +
  'book look took cook shock stuck luck back pack sack trick stick black slip stop shop drop crop top cap map rap grap ' +
  'this his miss kiss bus but mum hum ham bad ban bat pot pod now how cow row low slow show who why what when dash ' +
  'flesh fresh fang hang gang sang ding ring').split(' '));

const TWO_LETTER = new Set('of to in is it on be as at by we he or an my do if me up so no go us am oh'.split(' '));
const CJK = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
const MAX_RANK_FIX = 8000;
const MAX_RANK_SEGMENT = 15000;

/** Parole inglesi in ordine di frequenza: parola -> posizione. */
let words = new Map();

export function loadWords(text) {
  const m = new Map();
  text.split(/\r?\n/).forEach((w, i) => { w = w.trim(); if (w && !m.has(w)) m.set(w, i); });
  words = m;
}

export const isJapanese = t => CJK.test(t);

export function clean(raw) {
  if (isJapanese(raw)) return raw.trim();
  let t = raw.replace(/\|/g, 'I').replace(/[’‘]/g, "'")
    .replace(/[^A-Za-z0-9 .,!?'"\-…:;()]/g, ' ');
  // Il lettore a volte attacca la punteggiatura e i numeri alle parole: "CENTER,SO", "FOR4DAYS".
  t = t.replace(/(\.\.\.|…|[,!?;:])(?=[A-Za-z])/g, '$1 ')
    .replace(/([A-Za-z]{2,})(\d+)(?=[A-Za-z]{2,}|\b)/g, '$1 $2')
    .replace(/(\d)([A-Za-z]{2,})/g, '$1 $2');
  t = fixDigits(t);
  t = t.replace(/([A-Za-z])\1+[lI1]+(?=[!?.]*(\s|$))/g, (_, c) => c + c + '!');
  t = t.replace(/!+[lI1]+(?=\s|$)/g, '!!');
  t = t.replace(/([A-Za-z])\1{2,}/g, '$1');
  t = t.replace(/([AaIiUuYyHhWw])\1(?=[!?.,]*(\s|$))/g, '$1');
  t = t.replace(/([!?])[!?]+/g, '$1$1').replace(/\s+/g, ' ').trim();
  t = fixWords(t);
  return sound(t) ?? t;
}

function fixDigits(t) {
  return t.replace(/[A-Za-z0-9]+/g, w => {
    const letters = [...w].filter(c => /[A-Za-z]/.test(c)).length;
    if (letters && /\d/.test(w) && letters >= w.length / 2) {
      return w.replace(/[015 84]/g, c => ({ 0: 'O', 1: 'I', 5: 'S', 8: 'B', 4: 'A' }[c] ?? c));
    }
    return w;
  });
}

function fixWords(text) {
  if (!words.size) return text;
  const re = /[A-Za-z]+/g;
  const tokens = [...text.matchAll(re)];
  let out = '', last = 0;
  tokens.forEach((m, idx) => {
    out += text.slice(last, m.index);
    const end = m.index + m[0].length;
    const isLast = idx === tokens.length - 1 && !/[A-Za-z0-9]/.test(text.slice(end));
    out += fixWord(m[0], isLast);
    last = end;
  });
  return out + text.slice(last);
}

/** Parola conosciuta, anche al plurale o con -ers/-ing/-ed (es. "rankers"). */
function rank(w) {
  if (words.has(w)) return words.get(w);
  for (const suf of ['s', 'es', 'ers', 'er', 'ing', 'ed', 'd']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      const r = words.get(w.slice(0, -suf.length));
      if (r !== undefined) return r + 2000;
    }
  }
  return undefined;
}

function fixWord(token, atEnd) {
  const low = token.toLowerCase();
  if (low.length < 4 || rank(low) !== undefined) return token;
  const fixed = repair(low);
  if (fixed) return styled(fixed, token);
  if (atEnd) {
    for (let cut = 3; cut >= 1; cut--) {
      if (low.length - cut < 3) continue;
      const tail = low.slice(-cut);
      if ([...tail].some(c => !'iel'.includes(c))) continue;
      const base = low.slice(0, -cut);
      const f = rank(base) !== undefined ? base : repair(base);
      if (f) return styled(f, token) + '!!';
    }
  }
  return token;
}

function repair(low) {
  // Le parole attaccate (manca lo spazio) sono il caso più comune con questo lettore.
  if (low.length >= 6) {
    const parts = segment(low);
    if (parts) return parts.join(' ');
  }
  let best = null, bestRank = MAX_RANK_FIX;
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(97 + i);
    for (const cand of [c + low, low + c]) {
      const r = words.get(cand);
      if (r !== undefined && r < bestRank) { best = cand; bestRank = r; }
    }
  }
  return best;
}

function segment(s) {
  const n = s.length;
  const cost = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(-1);
  cost[0] = 0;
  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - 20); start < end; start++) {
      if (cost[start] === Infinity) continue;
      const w = s.slice(start, end);
      let r;
      if (w.length === 1) { if (w !== 'a' && w !== 'i') continue; r = 5; }
      else if (w.length === 2) { if (!TWO_LETTER.has(w)) continue; r = 20; }
      else { r = rank(w); if (r === undefined || r >= MAX_RANK_SEGMENT) continue; }
      const c = cost[start] + 1 + Math.log(r + 2) / 4;
      if (c < cost[end]) { cost[end] = c; from[end] = start; }
    }
  }
  if (from[n] < 0) return null;
  const parts = [];
  for (let i = n; i > 0; i = from[i]) parts.unshift(s.slice(from[i], i));
  return parts.length >= 2 && n / parts.length >= 2.4 && parts[parts.length - 1] !== 'i' ? parts : null;
}

function styled(fixed, original) {
  const letters = [...original].filter(c => /[A-Za-z]/.test(c));
  if (letters.length > 1 && letters.filter(c => c === c.toUpperCase()).length >= letters.length * 0.7) return fixed.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

function sound(t) {
  const ws = t.split(' ').map(w => w.replace(/^[!?.,\-'"…]+|[!?.,\-'"…]+$/g, '')).filter(Boolean);
  if (!ws.length || ws.length > 2) return null;
  const found = [];
  for (const w of ws) { const s = matchSound(w); if (!s) return null; found.push(s); }
  const meaning = [...new Set(found.map(f => SOUNDS[f]))].join(', ');
  return found.map(f => f.toUpperCase()).join(' ') + (t.includes('!') ? '!' : '') + ` (${meaning})`;
}

function matchSound(word) {
  const base = word.toLowerCase().replace(/[lir1]+$/, '');
  const cands = [...new Set([word.toLowerCase(), base])].filter(c => c.length >= 2);
  for (const c of cands) {
    if (COMMON.has(c)) return null;
    if (SOUNDS[c]) return c;
  }
  for (const c of cands) {
    if (c.length < 5) continue;
    const limit = c.length >= 7 ? 2 : 1;
    let best = null, bd = Infinity;
    for (const k of Object.keys(SOUNDS)) {
      if (k.length < 5) continue;
      const d = distance(c, k);
      if (d < bd) { bd = d; best = k; }
    }
    if (best && bd <= limit) return best;
  }
  return null;
}

const SIMILAR = new Set(['mw', 'wm', 'nh', 'hn', 'oa', 'ao', 'ce', 'ec', 'il', 'li', 'uv', 'vu', 'rn']);

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const sub = a[i - 1] === b[j - 1] ? 0 : SIMILAR.has(a[i - 1] + b[j - 1]) ? 0.5 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
  }
  return Math.ceil(d[a.length][b.length]);
}

// ---------- Raggruppamento ----------

/** Unisce le righe una sotto l'altra e vicine: di solito sono lo stesso balloon. */
export function group(lines) {
  const pieces = lines.map(l => ({ ...l, lh: Math.max(1, l.box.h) }));
  const parent = pieces.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i]; return i; };
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    if (close(pieces[i], pieces[j])) parent[find(i)] = find(j);
  }
  const groups = new Map();
  pieces.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].map(members => {
    members.sort((a, b) => a.box.y - b.box.y);
    const x0 = Math.min(...members.map(m => m.box.x)), y0 = Math.min(...members.map(m => m.box.y));
    const x1 = Math.max(...members.map(m => m.box.x + m.box.w)), y1 = Math.max(...members.map(m => m.box.y + m.box.h));
    return {
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      text: joinLines(members.map(m => m.text)),
      conf: members.reduce((s, m) => s + m.conf, 0) / members.length,
    };
  }).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

function close(a, b) {
  const lh = Math.min(a.lh, b.lh);
  const vGap = Math.max(a.box.y, b.box.y) - Math.min(a.box.y + a.box.h, b.box.y + b.box.h);
  const hOverlap = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
  const narrow = Math.min(a.box.w, b.box.w);
  return Math.max(a.lh, b.lh) <= 2.5 * lh && vGap < 0.9 * lh && hOverlap > 0.3 * narrow;
}

function joinLines(lines) {
  let s = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (s) {
      if (s.length > 1 && s.endsWith('-') && /[A-Za-z]/.test(s[s.length - 2])) s = s.slice(0, -1);
      else s += ' ';
    }
    s += line;
  }
  return s;
}

/** Dalla lettura grezza ai balloon da tradurre: righe affidabili, raggruppate e ripulite. */
export function balloons(lines) {
  const good = lines.filter(l => l.conf >= 0.6 && ((isJapanese(l.text) && l.text.length >= 2) || (l.text.match(/[A-Za-z]/g) || []).length >= 2));
  return group(good)
    .map(b => ({ ...b, text: clean(b.text) }))
    .filter(b => isJapanese(b.text) || (b.text.match(/[A-Za-z]/g) || []).length >= 2);
}

/** "TUTTO MAIUSCOLO" -> "Tutto maiuscolo": i traduttori lo gestiscono meglio. */
export function sentenceCase(text) {
  const letters = [...text].filter(c => /[A-Za-z]/.test(c));
  if (!letters.length || letters.filter(c => c === c.toUpperCase()).length < letters.length * 0.7) return text;
  let cap = true, out = '';
  for (const c of text.toLowerCase()) {
    if (cap && /[a-z]/.test(c)) { out += c.toUpperCase(); cap = false; }
    else { out += c; if ('.!?'.includes(c)) cap = true; }
  }
  return out.replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'");
}
