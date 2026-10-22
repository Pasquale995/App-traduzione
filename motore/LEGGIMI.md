# Mercurio Motore

Programma per Windows che fa girare il modello di traduzione (TranslateGemma) sul PC al posto di Ollama.
L'estensione Mercurio lo accende quando leggi e lo spegne quando hai finito (5 minuti senza traduzioni, o chiudendo il browser).

## Installare
1. Scarica `MercurioMotore.exe` e aprilo (Windows può avvisare "app non riconosciuta": Ulteriori informazioni → Esegui comunque).
2. Scegli il modello. Se hai già TranslateGemma in Ollama lo riusa senza riscaricarlo.
3. Alla fine fa una prova di traduzione. In Mercurio scegli il motore "Mercurio Motore".

Riaprendo il programma puoi provarlo, cambiare modello o disinstallarlo.

## Come funziona
- `llama.cpp` (release ufficiale da GitHub, CUDA se c'è una NVIDIA, altrimenti Vulkan) in `%LOCALAPPDATA%\MercurioMotore\llama`.
- Modello `.gguf` in `%LOCALAPPDATA%\MercurioMotore\modelli`.
- Si registra nel browser come "native messaging host" `it.pask.mercurio`; l'estensione (ID fisso `hoenccjknnmmmmkjpkdbaedbeajnidnk`) gli chiede di avviare `llama-server` sulla porta 11435.

## Compilare
`GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o MercurioMotore.exe .`
