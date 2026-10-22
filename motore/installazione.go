package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ID fisso dell'estensione Mercurio (dalla "key" nel suo manifest).
const estensioneID = "hoenccjknnmmmmkjpkdbaedbeajnidnk"

// Dove i browser basati su Chromium cercano i programmi "native messaging" (Opera usa quella di Chrome).
var chiaviBrowser = []string{
	`HKCU\Software\Google\Chrome\NativeMessagingHosts\` + hostName,
	`HKCU\Software\Chromium\NativeMessagingHosts\` + hostName,
	`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\` + hostName,
	`HKCU\Software\Opera Software\NativeMessagingHosts\` + hostName,
}

type Modello struct {
	Nome   string
	Cerca  string // ricerca su Hugging Face
	Ollama string // nome su Ollama (per riusare quello già scaricato)
	Peso   string
}

var catalogo = []Modello{
	{"TranslateGemma 4B", "translategemma-4b", "translategemma:4b", "circa 3 GB, va bene su quasi tutti i PC (consigliato)"},
	{"TranslateGemma 12B", "translategemma-12b", "translategemma:12b", "circa 8 GB, traduce meglio ma serve una scheda video con almeno 8-10 GB"},
}

var tastiera = bufio.NewReader(os.Stdin)

func chiedi(domanda string) string {
	fmt.Print(domanda)
	s, _ := tastiera.ReadString('\n')
	return strings.TrimSpace(s)
}

func installazione() error {
	fmt.Println("=============================================")
	fmt.Println("  Mercurio Motore " + versione + " - traduttore sul tuo PC")
	fmt.Println("=============================================")
	fmt.Println()
	dir := cartella()
	if cfg, err := leggiConfig(); err == nil {
		fmt.Println("Già installato:", cfg.Nome, "("+cfg.Backend+")")
		fmt.Println()
		fmt.Println("  1) Prova la traduzione")
		fmt.Println("  2) Cambia modello o reinstalla")
		fmt.Println("  3) Disinstalla")
		fmt.Println("  4) Esci")
		switch chiedi("Scelta: ") {
		case "1":
			return prova(cfg)
		case "2":
		case "3":
			return disinstalla()
		default:
			return nil
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// 1. Il motore llama.cpp, nella versione giusta per la scheda video.
	backend := schedaVideo()
	fmt.Println()
	switch backend {
	case "cuda":
		fmt.Println("Scheda video NVIDIA trovata: uso CUDA.")
	default:
		fmt.Println("Nessuna scheda NVIDIA trovata: uso Vulkan (va con AMD, Intel e anche NVIDIA).")
	}
	llama, err := scaricaLlama(filepath.Join(dir, "llama"), backend)
	if err != nil && backend == "cuda" {
		fmt.Println("CUDA non disponibile (" + err.Error() + "), provo con Vulkan.")
		backend = "vulkan"
		llama, err = scaricaLlama(filepath.Join(dir, "llama"), backend)
	}
	if err != nil {
		return err
	}

	// 2. Il modello.
	cfg := &Config{Llama: llama, Backend: backend, Contesto: 4096}
	if err := scegliModello(cfg, dir); err != nil {
		return err
	}

	// 3. Mi registro nel browser.
	if err := registraBrowser(dir); err != nil {
		return err
	}
	if err := salvaConfig(cfg); err != nil {
		return err
	}

	// 4. Prova.
	if err := prova(cfg); err != nil {
		return err
	}
	fmt.Println()
	fmt.Println("Fatto! Ora in Opera apri Mercurio e scegli il motore \"Mercurio Motore\".")
	fmt.Println("Non devi più avviare niente: l'estensione accende il motore quando leggi e lo spegne dopo.")
	return nil
}

// schedaVideo: "cuda" se c'è una NVIDIA, altrimenti "vulkan".
func schedaVideo() string {
	out, err := exec.Command("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader").Output()
	if err == nil && len(strings.TrimSpace(string(out))) > 0 {
		fmt.Println("Scheda video:", strings.TrimSpace(string(out)))
		return "cuda"
	}
	return "vulkan"
}

func scegliModello(cfg *Config, dir string) error {
	fmt.Println()
	fmt.Println("Quale modello vuoi usare?")
	for i, m := range catalogo {
		fmt.Printf("  %d) %s - %s\n", i+1, m.Nome, m.Peso)
	}
	fmt.Printf("  %d) Ho già un file .gguf\n", len(catalogo)+1)
	scelta := chiedi("Scelta [1]: ")
	if scelta == "" {
		scelta = "1"
	}
	if scelta == fmt.Sprint(len(catalogo)+1) {
		p := strings.Trim(chiedi("Trascina qui il file .gguf e premi Invio: "), `"' `)
		if _, err := os.Stat(p); err != nil {
			return fmt.Errorf("non trovo il file %s", p)
		}
		cfg.Modello = p
		cfg.Nome = strings.TrimSuffix(filepath.Base(p), ".gguf")
		return nil
	}
	var m *Modello
	for i := range catalogo {
		if scelta == fmt.Sprint(i+1) {
			m = &catalogo[i]
		}
	}
	if m == nil {
		return errors.New("scelta non valida")
	}
	cfg.Nome = m.Nome
	dest := filepath.Join(dir, "modelli", strings.ReplaceAll(strings.ToLower(m.Nome), " ", "-")+".gguf")
	os.MkdirAll(filepath.Dir(dest), 0o755)
	if _, err := os.Stat(dest); err == nil {
		fmt.Println("Il modello è già scaricato.")
		cfg.Modello = dest
		return nil
	}

	// Prima provo a riusare quello di Ollama (niente da scaricare), poi Hugging Face, poi il sito di Ollama.
	fonti := []struct {
		nome string
		fn   func() error
	}{
		{"Ollama già installato", func() error { return copiaDaOllama(m.Ollama, dest) }},
		{"Hugging Face", func() error { return scaricaDaHF(m.Cerca, dest) }},
		{"registro di Ollama", func() error { return scaricaDaRegistroOllama(m.Ollama, dest) }},
	}
	for _, f := range fonti {
		fmt.Println()
		fmt.Println("Cerco il modello su:", f.nome)
		if err := f.fn(); err != nil {
			fmt.Println("  non va:", err)
			os.Remove(dest)
			continue
		}
		cfg.Modello = dest
		// Controllo che llama.cpp lo sappia aprire, sennò passo alla fonte dopo.
		fmt.Println("Controllo che il modello funzioni…")
		s := &Server{}
		os.MkdirAll(dir, 0o755)
		salvaConfig(cfg)
		if err := s.Avvia(func(string) {}); err != nil {
			fmt.Println("  questo file non va bene:", err)
			os.Remove(dest)
			continue
		}
		s.Ferma()
		return nil
	}
	return errors.New("non sono riuscito a procurarmi il modello: controlla la connessione, oppure scarica un .gguf e scegli l'ultima opzione")
}

func registraBrowser(dir string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// Mi copio nella cartella di installazione, così il file scaricato si può cancellare.
	dest := filepath.Join(dir, "MercurioMotore.exe")
	if !strings.EqualFold(exe, dest) {
		if err := copiaFile(exe, dest); err != nil {
			return fmt.Errorf("non riesco a copiare il programma: %v", err)
		}
	}
	manifest := map[string]any{
		"name":            hostName,
		"description":     "Mercurio Motore",
		"path":            dest,
		"type":            "stdio",
		"allowed_origins": []string{"chrome-extension://" + estensioneID + "/"},
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")
	mpath := filepath.Join(dir, hostName+".json")
	if err := os.WriteFile(mpath, b, 0o644); err != nil {
		return err
	}
	for _, k := range chiaviBrowser {
		if err := registra(k, mpath); err != nil {
			return fmt.Errorf("non riesco a registrarmi nel browser: %v", err)
		}
	}
	fmt.Println()
	fmt.Println("Registrato in Opera, Chrome ed Edge.")
	return nil
}

func prova(cfg *Config) error {
	fmt.Println()
	fmt.Println("Accendo il motore e provo una frase…")
	s := &Server{}
	t0 := time.Now()
	if err := s.Avvia(func(t string) { fmt.Println(" ", t) }); err != nil {
		return err
	}
	defer s.Ferma()
	fmt.Printf("Motore acceso in %.1fs (%s).\n", time.Since(t0).Seconds(), s.usato)
	t1 := time.Now()
	it, err := traduci("DAMN... TOP RANKERS HAVE CONNECTIONS WITH GOVERNMENTS TOO.", cfg.Nome)
	if err != nil {
		return err
	}
	fmt.Printf("Tradotto in %.1fs: %s\n", time.Since(t1).Seconds(), it)
	return nil
}

func disinstalla() error {
	for _, k := range chiaviBrowser {
		cancellaChiave(k)
	}
	dir := cartella()
	fmt.Println("Tolgo la registrazione dal browser e cancello", dir)
	// Il programma stesso è in uso: lo cancello per ultimo, dopo il resto.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.EqualFold(e.Name(), "MercurioMotore.exe") {
			continue
		}
		os.RemoveAll(filepath.Join(dir, e.Name()))
	}
	fmt.Println("Fatto. Puoi cancellare a mano", filepath.Join(dir, "MercurioMotore.exe"))
	return nil
}

func copiaFile(da, a string) error {
	in, err := os.Open(da)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(a + ".tmp")
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	out.Close()
	return os.Rename(a+".tmp", a)
}
