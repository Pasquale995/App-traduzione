# Traduttore Fumetti (prototipo 0.4)

App Android che legge i balloon in inglese sullo schermo e ci disegna sopra la traduzione italiana. Gratis: lavora tutto sul telefono.

## Come funziona

1. Cattura lo schermo (permesso "registra/trasmetti schermo" di Android).
2. Quando la pagina smette di muoversi, riconosce il testo dei balloon sul telefono con ML Kit di Google (gratis, offline).
3. Lo traduce sul telefono con il traduttore offline di Google (gratis). La prima volta scarica il modello inglese-italiano, circa 30 MB, poi funziona anche senza internet.
4. Disegna un riquadro bianco con l'italiano sopra ogni balloon. Puoi continuare a scorrere e girare pagina: le traduzioni spariscono e ricompaiono sulla pagina nuova dopo circa un secondo.

In più puoi scegliere Claude come traduttore, più fedele e naturale ma a pagamento (serve una chiave API Anthropic con credito prepagato, separata dall'abbonamento a Claude).

## Cosa ti serve

- Un telefono Android 8.0 o più recente, a 64 bit (quasi tutti quelli degli ultimi anni).
- Solo per Claude: una chiave API da https://console.anthropic.com.

## Come ottenere l'APK

L'APK si compila con Gradle, perché le librerie ML Kit si scaricano dai server di Google:
- **GitHub**: carica questa cartella in un repository (compresa la cartella nascosta `.github`). Nella scheda **Actions** parte da solo "Compila APK"; alla fine scarichi **TraduttoreFumetti-apk**, che contiene `app-debug.apk`. Lo stesso APK finisce anche nel ramo `apk` del repository.
- **Android Studio**: File → Open → questa cartella, poi Build → Build APK(s).

`apk/TraduttoreFumetti-0.4.apk` è la versione compilata su GitHub e firmata con la chiave in `.firma-traduttore`, così si installa sopra la vecchia. `apk/TraduttoreFumetti-0.2.apk` è una versione vecchia che usava solo Claude (a pagamento), compilata con `strumenti/compila-senza-gradle.sh` in un ambiente senza accesso a Google.

## Installazione e uso

1. Copia l'APK sul telefono e aprilo. Android chiederà di consentire l'installazione da questa fonte: accetta.
2. Apri **Traduttore Fumetti** e lascia selezionato **Google offline (gratis)**.
3. Premi **1. Consenti di disegnare sopra le altre app** e attiva l'interruttore.
4. Premi **2. Avvia traduzione** e, quando Android chiede cosa condividere, scegli **schermo intero**.
5. Apri la tua app di fumetti. Per fermare: pulsante **Ferma** nella notifica.

## Limiti noti di questo prototipo

- La traduzione di Google offline è più letterale di quella di Claude, soprattutto con slang e giochi di parole.
- Le scritte a mano molto stilizzate possono sfuggire all'OCR.
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
