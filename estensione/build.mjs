// Prepara la cartella dist/ da caricare in Opera GX o Chrome ("Carica estensione non pacchettizzata").
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const dist = 'dist';
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync('static', dist, { recursive: true });

await build({
  entryPoints: ['src/background.js', 'src/offscreen.js', 'src/content.js', 'src/popup.js'],
  outdir: dist, bundle: true, format: 'esm', target: 'chrome116', minify: false, logLevel: 'info',
  // Lo script della pagina non può essere un modulo.
  plugins: [],
}).catch(() => process.exit(1));

// content.js e popup.js: niente "export"/"import" rimasti, quindi vanno bene anche come script normali.
for (const f of ['content.js', 'popup.js']) {
  await build({ entryPoints: ['src/' + f], outfile: path.join(dist, f), bundle: true, format: 'iife', target: 'chrome116', allowOverwrite: true });
}

const models = 'node_modules/@gutenye/ocr-models/assets/';
fs.mkdirSync(path.join(dist, 'modelli'));
fs.copyFileSync(models + 'ch_PP-OCRv4_det_infer.onnx', path.join(dist, 'modelli/det.onnx'));
// PP-OCRv5: cinese, inglese e giapponese (kana compresi) nello stesso modello.
const v5 = 'node_modules/pdfmarkdown-ppocrv5-models/recognition/';
fs.copyFileSync(v5 + 'PP-OCRv5_mobile_rec_infer.onnx', path.join(dist, 'modelli/rec.onnx'));
fs.copyFileSync(v5 + 'ppocrv5_dict.txt', path.join(dist, 'modelli/chiavi.txt'));
fs.copyFileSync('../app/src/main/assets/parole_en.txt', path.join(dist, 'parole_en.txt'));

// Il motore di onnxruntime (WebAssembly) va accanto, non dentro il bundle.
const ort = 'node_modules/onnxruntime-web/dist/';
fs.mkdirSync(path.join(dist, 'ort'));
for (const f of fs.readdirSync(ort)) {
  if (/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f)) fs.copyFileSync(ort + f, path.join(dist, 'ort', f));
}
console.log('Pronto in', dist);
