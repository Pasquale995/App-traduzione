package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// ---------- Native messaging: 4 byte di lunghezza + JSON, su stdin/stdout ----------

func leggiMessaggio(r io.Reader) (map[string]any, error) {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return nil, err
	}
	if n > 1<<20 {
		return nil, errors.New("messaggio troppo grande")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	m := map[string]any{}
	return m, json.Unmarshal(buf, &m)
}

var scrivi sync.Mutex

func mandaMessaggio(w io.Writer, m map[string]any) {
	b, _ := json.Marshal(m)
	scrivi.Lock()
	defer scrivi.Unlock()
	binary.Write(w, binary.LittleEndian, uint32(len(b)))
	w.Write(b)
}

// ---------- llama-server ----------

type Server struct {
	mu    sync.Mutex
	cmd   *exec.Cmd
	cfg   *Config
	log   *bytes.Buffer
	usato string // backend con cui è partito davvero
}

func (s *Server) pidFile() string { return filepath.Join(cartella(), "server.pid") }

func (s *Server) vivo() bool {
	c := http.Client{Timeout: 2 * time.Second}
	r, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/health", porta))
	if err != nil {
		return false
	}
	r.Body.Close()
	return r.StatusCode == 200
}

// Avvia accende llama-server (se non è già acceso) e aspetta che il modello sia caricato.
func (s *Server) Avvia(stato func(string)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil && s.vivo() {
		return nil
	}
	s.chiudiVecchio()
	cfg, err := leggiConfig()
	if err != nil {
		return errors.New("Mercurio Motore non è configurato: apri MercurioMotore.exe e fai l'installazione")
	}
	s.cfg = cfg
	stato("carico " + cfg.Nome)
	var ultimo error
	// Se la scheda video non va (driver, memoria), ripiego sul processore.
	for _, gpu := range []bool{cfg.Backend != "cpu", false} {
		if err := s.lancia(cfg, gpu); err != nil {
			ultimo = err
			if !gpu {
				break
			}
			stato("la scheda video non parte, provo col processore")
			continue
		}
		if gpu {
			s.usato = cfg.Backend
		} else {
			s.usato = "cpu"
		}
		return nil
	}
	return ultimo
}

func (s *Server) lancia(cfg *Config, gpu bool) error {
	exe := filepath.Join(cfg.Llama, nomeServer())
	args := []string{
		"-m", cfg.Modello,
		"--host", "127.0.0.1", "--port", strconv.Itoa(porta),
		"-c", strconv.Itoa(cfg.Contesto), "--parallel", "1",
	}
	if gpu {
		args = append(args, "-ngl", "999")
	} else {
		args = append(args, "-ngl", "0")
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = cfg.Llama
	s.log = &bytes.Buffer{}
	cmd.Stdout = s.log
	cmd.Stderr = s.log
	nascondiFinestra(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("non riesco ad avviare llama-server: %v", err)
	}
	legaAlProcesso(cmd)
	os.WriteFile(s.pidFile(), []byte(strconv.Itoa(cmd.Process.Pid)), 0o644)
	finito := make(chan error, 1)
	go func() { finito <- cmd.Wait() }()
	limite := time.After(5 * time.Minute)
	for {
		select {
		case <-finito:
			os.Remove(s.pidFile())
			return fmt.Errorf("llama-server si è chiuso: %s", ultimaRiga(s.log.String()))
		case <-limite:
			cmd.Process.Kill()
			return errors.New("il modello ci mette troppo a caricarsi")
		case <-time.After(400 * time.Millisecond):
			if s.vivo() {
				s.cmd = cmd
				go func() {
					<-finito
					s.mu.Lock()
					if s.cmd == cmd {
						s.cmd = nil
					}
					s.mu.Unlock()
				}()
				return nil
			}
		}
	}
}

// Ferma spegne llama-server e libera la memoria della scheda video.
func (s *Server) Ferma() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
	s.cmd = nil
	os.Remove(s.pidFile())
}

// Un llama-server rimasto acceso da una volta precedente (es. il browser si è chiuso di colpo).
func (s *Server) chiudiVecchio() {
	b, err := os.ReadFile(s.pidFile())
	if err != nil {
		return
	}
	if pid, err := strconv.Atoi(string(bytes.TrimSpace(b))); err == nil {
		if p, err := os.FindProcess(pid); err == nil {
			p.Kill()
		}
	}
	os.Remove(s.pidFile())
	time.Sleep(300 * time.Millisecond)
}

func ultimaRiga(log string) string {
	righe := bytes.Split(bytes.TrimSpace([]byte(log)), []byte("\n"))
	for i := len(righe) - 1; i >= 0; i-- {
		if r := bytes.TrimSpace(righe[i]); len(r) > 0 {
			if len(r) > 200 {
				r = r[len(r)-200:]
			}
			return string(r)
		}
	}
	return "nessun messaggio"
}

// ---------- Il programma quando lo apre il browser ----------

func host() {
	s := &Server{}
	in := bufio.NewReader(os.Stdin)
	out := os.Stdout
	defer s.Ferma() // il browser ha chiuso il collegamento: spengo tutto
	for {
		m, err := leggiMessaggio(in)
		if err != nil {
			return
		}
		id := m["id"]
		rispondi := func(r map[string]any) {
			r["id"] = id
			mandaMessaggio(out, r)
		}
		switch m["cmd"] {
		case "avvia":
			go func() {
				err := s.Avvia(func(t string) { mandaMessaggio(out, map[string]any{"evento": "stato", "testo": t}) })
				if err != nil {
					rispondi(map[string]any{"ok": false, "errore": err.Error()})
					return
				}
				rispondi(map[string]any{"ok": true, "porta": porta, "modello": s.cfg.Nome, "backend": s.usato, "versione": versione})
			}()
		case "ferma":
			s.Ferma()
			rispondi(map[string]any{"ok": true})
		case "stato":
			cfg, err := leggiConfig()
			r := map[string]any{"ok": err == nil, "acceso": s.vivo(), "versione": versione}
			if cfg != nil {
				r["modello"] = cfg.Nome
				r["backend"] = cfg.Backend
			}
			rispondi(r)
		default:
			rispondi(map[string]any{"ok": false, "errore": "comando sconosciuto"})
		}
	}
}
