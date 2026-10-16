# Mercurio, traduttore di fumetti (prototipo 0.13)

App Android che legge i balloon in inglese (e il giapponese, kanji e kana) sullo schermo e ci disegna sopra la traduzione italiana. Gratis: lavora tutto sul telefono.

## Come funziona

1. Cattura lo schermo (permesso "registra/trasmetti schermo" di Android).
2. Quando la pagina smette di muoversi, riconosce il testo sul telefono con ML Kit di Google (gratis, offline), in più passate: immagine normale, immagine ad alto contrasto, e rilettura ingrandita dei pezzi incerti. Unisce le scritte vicine, corregge gli errori tipici del lettering (es. "!!" letti come "l", lettere allungate, lettere perse nelle scritte a contorno, parole attaccate) con un dizionario inglese di 20.000 parole e riconosce i suoni (WHOOSH, BOOM...) mostrando il significato tra parentesi. Una passata a parte legge il giapponese.
3. Lo traduce sul telefono con il traduttore offline di Google (gratis). La prima volta scarica il modello inglese-italiano, circa 30 MB (e quello giapponese-italiano la prima volta che trova del giapponese), poi funziona anche senza internet.
4. Disegna un riquadro bianco con l'italiano sopra ogni balloon. Puoi continuare a scorrere e girare pagina: le traduzioni spariscono e ricompaiono sulla pagina nuova dopo circa un secondo.

Per una traduzione più naturale puoi scegliere **LLM open source via Groq**: gratis, serve solo una chiave da https://console.groq.com (API Keys → Create API Key). Riceve solo il testo letto sul telefono, una richiesta per pagina; se finisci il limite giornaliero gratuito o manca internet, l'app torna da sola al traduttore offline di Google.

In più puoi scegliere Claude come traduttore, più fedele e naturale ma a pagamento (serve una chiave API Anthropic con credito prepagato, separata dall'abbonamento a Claude).

## Cosa ti serve

- Un telefono Android 8.0 o più recente, a 64 bit (quasi tutti quelli degli ultimi anni).
- Solo per Claude: una chiave API da https://console.anthropic.com.

## Come ottenere l'APK

L'APK si compila con Gradle, perché le librerie ML Kit si scaricano dai server di Google:
- **GitHub**: carica questa cartella in un repository (compresa la cartella nascosta `.github`). Nella scheda **Actions** parte da solo "Compila APK"; alla fine scarichi **TraduttoreFumetti-apk**, che contiene `app-debug.apk`. Lo stesso APK finisce anche nel ramo `apk` del repository.
- **Android Studio**: File → Open → questa cartella, poi Build → Build APK(s).

`apk/TraduttoreFumetti-0.12.apk` è la versione compilata su GitHub e firmata con la chiave in `.firma-traduttore`, così si installa sopra la vecchia. `apk/TraduttoreFumetti-0.2.apk` è una versione vecchia che usava solo Claude (a pagamento), compilata con `strumenti/compila-senza-gradle.sh` in un ambiente senza accesso a Google.

## Installazione e uso

1. Copia l'APK sul telefono e aprilo. Android chiederà di consentire l'installazione da questa fonte: accetta.
2. Apri **Mercurio** e lascia selezionato **Google offline (gratis)**.
3. Premi **1. Consenti di disegnare sopra le altre app** e attiva l'interruttore.
4. Premi **2. Avvia traduzione** e, quando Android chiede cosa condividere, scegli **schermo intero**.
5. Apri la tua app di fumetti. Per fermare: pulsante **Ferma** nella notifica.
6. Due pallini galleggianti (trascinabili) restano sullo schermo: **Mercurio** (toccalo per fermare tutto) e **fumetto** (nasconde o rimostra le traduzioni, per guardare la tavola pulita). Si possono togliere nelle impostazioni.
7. Nelle impostazioni scegli anche **dimensione del testo** e **opacità dei riquadri** (al massimo 80%: oltre, Android non lascia più passare il dito); le modifiche valgono subito.
8. Mentre Mercurio è attivo Android blocca gli screenshot normali: usa il pulsante **Screenshot** nella notifica, chiudi la tendina e dopo 3 secondi la schermata (con le traduzioni) finisce in Galleria, cartella Immagini/Mercurio.

## Limiti noti di questo prototipo

- La traduzione di Google offline è più letterale di quella di Claude, soprattutto con slang e giochi di parole.
- Le scritte a mano molto stilizzate possono sfuggire all'OCR, soprattutto i suoni giapponesi disegnati a mano.
- La traduzione dal giapponese di Google offline è meno precisa di quella dall'inglese.
- Traduce anche testo inglese che non sta nei balloon (menu dell'app, titoli).
- Un balloon molto grande può essere diviso in due pezzi, o due balloon vicini uniti in uno.
- I riquadri sono leggermente trasparenti: da Android 12 è l'unico modo perché il dito possa continuare a scorrere la pagina sotto.
- Se il telefono ruota, la traduzione riparte da capo su quella pagina.

## File principali

- `app/src/main/java/.../CaptureService.kt`: cattura, rilevamento del cambio pagina, OCR, overlay.
- `app/src/main/java/.../PageTranslator.kt`: scelta del traduttore e traduttore offline di Google.
- `app/src/main/java/.../ClaudeTranslator.kt`: traduzione con Claude (opzionale).
- `app/src/main/java/.../OverlayView.kt`: disegno dei riquadri tradotti.
- `app/src/main/java/.../MainActivity.kt`: schermata delle impostazioni.

## Icona

Coscia di pollo fritta in stile fumetto che sfreccia dentro un cerchio rosso; fuori dal cerchio è trasparente (disegno scelto da Pask, `strumenti/icona/originale.png`). `strumenti/icona/riempi_angoli.py` toglie gli angoli neri, `strumenti/icona/prepara.py` rende trasparente lo sfondo fuori dal cerchio, ruota il disegno di mezzo giro (osso in alto a sinistra) e crea le immagini in `app/src/main/res/mipmap-*`. L'icona piccola della notifica è `drawable/ic_notifica.xml`.

## Gemma sul telefono (sperimentale, dalla 0.13)

Traduce con Gemma, il modello aperto di Google, tutto sul telefono: gratis, offline, nessun testo esce dal telefono.
1. Da browser, accedi a Hugging Face, accetta la licenza Gemma e scarica un file `.task`:
   - `gemma-3n-E2B-it-int4.task` (google/gemma-3n-E2B-it-litert-preview, circa 3 GB): traduce meglio;
   - `Gemma3-1B-IT_multi-prefill-seq_q4_ekv2048.task` (litert-community/Gemma3-1B-IT, circa 550 MB): più veloce, italiano più debole.
2. In Mercurio: "Scegli il file del modello Gemma (.task)", poi scegli "Gemma sul telefono" e avvia.
Se il modello non parte, Mercurio usa da solo Google offline (lo dice la notifica).

La lettura delle scritte ora fa le passate extra solo quando la prima lettura è incerta; la lettura del giapponese si può spegnere per andare più veloci.
