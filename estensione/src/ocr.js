// Lettura delle scritte con PaddleOCR (modelli ONNX), uguale nel browser e in Node per i test.
// L'immagine è { data: RGBA, width, height }. Tutte le coordinate restituite sono dell'immagine originale.

const DET_MAX_WIDTH = 960;   // larghezza massima per il rilevatore (come PaddleOCR)
const DET_TILE = 1280;       // altezza massima di un pezzo: i webtoon sono strisce lunghissime
const DET_OVERLAP = 160;
const DET_THRESH = 0.3;
const BOX_THRESH = 0.55;
const UNCLIP = 1.6;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 1600;

export class PaddleOcr {
  /** ort: modulo onnxruntime (web o node); det/rec: modelli già caricati come byte o percorso; keys: testo del dizionario. */
  static async create(ort, det, rec, keys, sessionOptions = {}) {
    const o = new PaddleOcr();
    o.ort = ort;
    o.det = await ort.InferenceSession.create(det, sessionOptions);
    o.rec = await ort.InferenceSession.create(rec, sessionOptions);
    o.chars = ['', ...keys.split(/\r?\n/).filter((l, i, a) => l.length > 0 || i < a.length - 1), ' '];
    return o;
  }

  /** Trova e legge tutte le righe di testo: [{ box: {x, y, w, h}, text, conf }]. */
  async read(img) {
    const boxes = await this.detect(img);
    const lines = [];
    for (const box of boxes) {
      const r = await this.recognize(img, box);
      if (r && r.text.trim()) lines.push({ box, text: r.text.trim(), conf: r.conf });
    }
    return lines;
  }

  // ---------- Rilevamento ----------

  async detect(img) {
    const scale = Math.min(1, DET_MAX_WIDTH / img.width);
    const tileSrc = Math.round(DET_TILE / scale);
    const overlapSrc = Math.round(DET_OVERLAP / scale);
    const all = [];
    for (let top = 0; top < img.height; top += tileSrc - overlapSrc) {
      const h = Math.min(tileSrc, img.height - top);
      const boxes = await this.detectTile(img, top, h, scale);
      for (const b of boxes) all.push(b);
      if (top + h >= img.height) break;
    }
    return dedupe(all);
  }

  async detectTile(img, top, srcH, scale) {
    const w = Math.max(32, Math.ceil((img.width * scale) / 32) * 32);
    const h = Math.max(32, Math.ceil((srcH * scale) / 32) * 32);
    const input = new Float32Array(3 * w * h);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    const sx = img.width / w, sy = srcH / h;
    for (let y = 0; y < h; y++) {
      const oy = Math.min(img.height - 1, top + Math.floor((y + 0.5) * sy));
      for (let x = 0; x < w; x++) {
        const ox = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
        const p = (oy * img.width + ox) * 4;
        for (let c = 0; c < 3; c++) input[c * w * h + y * w + x] = (img.data[p + c] / 255 - mean[c]) / std[c];
      }
    }
    const out = await this.det.run({ [this.det.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, h, w]) });
    const prob = out[this.det.outputNames[0]].data;
    return components(prob, w, h).map(b => {
      // Allargo il riquadro (le lettere escono dalla zona trovata) e lo riporto all'originale.
      const d = (b.w * b.h * UNCLIP) / (2 * (b.w + b.h));
      const x0 = Math.max(0, (b.x - d) * sx), y0 = Math.max(0, (b.y - d) * sy);
      const x1 = Math.min(img.width, (b.x + b.w + d) * sx), y1 = Math.min(srcH, (b.y + b.h + d) * sy);
      return { x: Math.round(x0), y: Math.round(top + y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    });
  }

  // ---------- Lettura ----------

  async recognize(img, box) {
    if (box.w < 4 || box.h < 4) return null;
    const vertical = box.h > box.w * 1.6;
    if (vertical) return null; // testo verticale (giapponese): non ancora gestito
    const h = REC_HEIGHT;
    const w = Math.min(REC_MAX_WIDTH, Math.max(16, Math.round((box.w * h) / box.h)));
    const input = new Float32Array(3 * w * h);
    const sx = box.w / w, sy = box.h / h;
    for (let y = 0; y < h; y++) {
      const oy = Math.min(img.height - 1, box.y + Math.floor((y + 0.5) * sy));
      for (let x = 0; x < w; x++) {
        const ox = Math.min(img.width - 1, box.x + Math.floor((x + 0.5) * sx));
        const p = (oy * img.width + ox) * 4;
        for (let c = 0; c < 3; c++) input[c * w * h + y * w + x] = (img.data[p + c] / 255 - 0.5) / 0.5;
      }
    }
    const out = await this.rec.run({ [this.rec.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, h, w]) });
    const t = out[this.rec.outputNames[0]];
    const [, steps, classes] = t.dims;
    let text = '', last = 0, sum = 0, n = 0;
    for (let s = 0; s < steps; s++) {
      let best = 0, bp = -1;
      for (let c = 0; c < classes; c++) {
        const v = t.data[s * classes + c];
        if (v > bp) { bp = v; best = c; }
      }
      if (best !== 0 && best !== last) {
        text += this.chars[best] ?? '';
        sum += bp; n++;
      }
      last = best;
    }
    return { text, conf: n ? sum / n : 0 };
  }
}

/** Zone collegate della mappa di probabilità -> riquadri (nelle coordinate della mappa). */
function components(prob, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || prob[i] <= DET_THRESH) continue;
    let sp = 0, minX = w, minY = h, maxX = 0, maxY = 0, sum = 0, count = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      sum += prob[p]; count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && !seen[p - 1] && prob[p - 1] > DET_THRESH) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && prob[p + 1] > DET_THRESH) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !seen[p - w] && prob[p - w] > DET_THRESH) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !seen[p + w] && prob[p + w] > DET_THRESH) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < 3 || bh < 3 || sum / count < BOX_THRESH) continue;
    boxes.push({ x: minX, y: minY, w: bw, h: bh });
  }
  return boxes;
}

/** Le zone di sovrapposizione tra pezzi trovano le stesse righe due volte: tengo la più grande. */
function dedupe(boxes) {
  const kept = [];
  for (const b of boxes.sort((a, c) => c.w * c.h - a.w * a.h)) {
    if (!kept.some(k => overlap(k, b) > 0.6)) kept.push(b);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const small = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  return (x * y) / small;
}
