# Mercurio per Opera GX / Chrome

Estensione che traduce in italiano i fumetti in inglese e giapponese mentre li leggi sul PC.
Legge le scritte con PaddleOCR direttamente nel browser e traduce con Ollama (TranslateGemma) sul tuo PC.

## Installare
1. Ollama aperto con il modello: `ollama pull translategemma:4b`
2. Estrai lo zip in una cartella che non cancelli.
3. Opera GX: `opera://extensions` (Chrome: `chrome://extensions`), attiva "Modalità sviluppatore",
   "Carica estensione non pacchettizzata" e scegli la cartella estratta.
4. Apri un capitolo: sopra le nuvolette compaiono i riquadri tradotti (passa col mouse per vedere sotto).

Se Ollama rifiuta l'estensione (errore 403): variabile d'ambiente `OLLAMA_ORIGINS=chrome-extension://*`, poi riavvia Ollama.

## Compilare
`npm install && npm run build` crea `dist/`.
