// Mercurio Motore: fa girare il modello di traduzione sul PC al posto di Ollama.
//
// Aperto con un doppio clic fa l'installazione (scarica llama.cpp e il modello, si registra nel browser).
// Aperto dal browser (native messaging) accende llama-server quando l'estensione lo chiede
// e lo spegne quando l'estensione si scollega.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	hostName = "it.pask.mercurio"
	porta    = 11435
	versione = "0.1"
)

// Config è salvata accanto al programma installato.
type Config struct {
	Llama    string `json:"llama"`   // cartella con llama-server.exe
	Backend  string `json:"backend"` // cuda, vulkan o cpu
	Modello  string `json:"modello"` // percorso del file .gguf
	Nome     string `json:"nome"`    // nome leggibile, es. "TranslateGemma 4B"
	Contesto int    `json:"contesto"`
}

func cartella() string {
	if d := os.Getenv("MERCURIO_CARTELLA"); d != "" { // per le prove
		return d
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserHomeDir()
	}
	return filepath.Join(base, "MercurioMotore")
}

func leggiConfig() (*Config, error) {
	b, err := os.ReadFile(filepath.Join(cartella(), "config.json"))
	if err != nil {
		return nil, err
	}
	c := &Config{}
	if err := json.Unmarshal(b, c); err != nil {
		return nil, err
	}
	if c.Contesto == 0 {
		c.Contesto = 4096
	}
	return c, nil
}

func salvaConfig(c *Config) error {
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(filepath.Join(cartella(), "config.json"), b, 0o644)
}

func main() {
	// Il browser avvia il programma passando l'origine dell'estensione: "chrome-extension://…/".
	for _, a := range os.Args[1:] {
		if strings.HasPrefix(a, "chrome-extension://") {
			host()
			return
		}
	}
	if len(os.Args) > 1 && os.Args[1] == "--host" {
		host()
		return
	}
	if err := installazione(); err != nil {
		fmt.Println()
		fmt.Println("ERRORE:", err)
	}
	fmt.Println()
	fmt.Print("Premi Invio per chiudere.")
	fmt.Scanln()
}
