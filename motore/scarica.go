package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var web = &http.Client{Timeout: 0}

func prendiJSON(url string, accept string, out any) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "MercurioMotore/"+versione)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	c := http.Client{Timeout: 60 * time.Second}
	r, err := c.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("%s risponde %d", url, r.StatusCode)
	}
	return json.NewDecoder(r.Body).Decode(out)
}

// scaricaFile scarica con una barra di avanzamento; se sha256 non è vuoto lo controlla.
func scaricaFile(url, dest, sha string) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "MercurioMotore/"+versione)
	r, err := web.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("download rifiutato (%d)", r.StatusCode)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	h := sha256.New()
	tot := r.ContentLength
	var fatto int64
	buf := make([]byte, 1<<20)
	t0, ultimo := time.Now(), time.Time{}
	for {
		n, err := r.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return werr
			}
			h.Write(buf[:n])
			fatto += int64(n)
			if time.Since(ultimo) > 500*time.Millisecond {
				ultimo = time.Now()
				vel := float64(fatto) / time.Since(t0).Seconds() / 1e6
				if tot > 0 {
					fmt.Printf("\r  %.2f / %.2f GB  (%.0f%%, %.1f MB/s)   ", float64(fatto)/1e9, float64(tot)/1e9, float64(fatto)*100/float64(tot), vel)
				} else {
					fmt.Printf("\r  %.2f GB  (%.1f MB/s)   ", float64(fatto)/1e9, vel)
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			f.Close()
			return err
		}
	}
	f.Close()
	fmt.Println()
	if tot > 0 && fatto != tot {
		return errors.New("download interrotto")
	}
	if sha != "" && hex.EncodeToString(h.Sum(nil)) != sha {
		os.Remove(tmp)
		return errors.New("il file scaricato è rovinato")
	}
	return os.Rename(tmp, dest)
}

// ---------- llama.cpp dalle release ufficiali su GitHub ----------

type releaseGH struct {
	Tag    string `json:"tag_name"`
	Assets []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

// scegliZip: i pacchetti di llama.cpp da scaricare per il backend, in ordine (prima la base, poi il resto sopra).
func scegliZip(rel releaseGH, backend string) ([]string, error) {
	trova := func(re string) string {
		r := regexp.MustCompile(re)
		var nomi []string
		for _, a := range rel.Assets {
			if r.MatchString(a.Name) {
				nomi = append(nomi, a.Name)
			}
		}
		sort.Strings(nomi)
		if len(nomi) == 0 {
			return ""
		}
		return nomi[len(nomi)-1] // la versione più alta (es. cuda 12.4 > 12.2)
	}
	base := trova(`^llama-.*bin-win-cpu-x64\.zip$`)
	var extra []string
	switch backend {
	case "cuda":
		z := trova(`^llama-.*bin-win-cuda-12\.\d+-x64\.zip$`)
		if z == "" {
			return nil, errors.New("nessun pacchetto CUDA 12 in questa versione di llama.cpp")
		}
		ver := regexp.MustCompile(`cuda-12\.\d+`).FindString(z)
		rt := trova(`^cudart-.*win-` + regexp.QuoteMeta(ver) + `-x64\.zip$`)
		extra = append(extra, z)
		if rt != "" {
			extra = append(extra, rt)
		}
	case "vulkan":
		z := trova(`^llama-.*bin-win-vulkan-x64\.zip$`)
		if z == "" {
			return nil, errors.New("nessun pacchetto Vulkan in questa versione di llama.cpp")
		}
		extra = append(extra, z)
	}
	if base == "" && len(extra) == 0 {
		return nil, errors.New("non trovo i pacchetti per Windows")
	}
	var out []string
	if base != "" {
		out = append(out, base)
	}
	return append(out, extra...), nil
}

func scaricaLlama(dir, backend string) (string, error) {
	fmt.Println()
	fmt.Println("Scarico llama.cpp (il motore che fa girare il modello)…")
	var rel releaseGH
	if err := prendiJSON("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", "application/vnd.github+json", &rel); err != nil {
		return "", err
	}
	nomi, err := scegliZip(rel, backend)
	if err != nil {
		return "", err
	}
	os.RemoveAll(dir)
	os.MkdirAll(dir, 0o755)
	for _, n := range nomi {
		for _, a := range rel.Assets {
			if a.Name != n {
				continue
			}
			fmt.Println(" ", n)
			z := filepath.Join(dir, n)
			if err := scaricaFile(a.URL, z, ""); err != nil {
				return "", err
			}
			if err := estraiPiatto(z, dir); err != nil {
				return "", err
			}
			os.Remove(z)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, nomeServer())); err != nil {
		return "", errors.New("nel pacchetto di llama.cpp manca llama-server")
	}
	os.WriteFile(filepath.Join(dir, "versione.txt"), []byte(rel.Tag+" "+backend), 0o644)
	return dir, nil
}

// estraiPiatto mette tutti i file dello zip direttamente nella cartella (le release cambiano struttura ogni tanto).
func estraiPiatto(zipPath, dir string) error {
	z, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer z.Close()
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		in, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(filepath.Join(dir, filepath.Base(f.Name)))
		if err != nil {
			in.Close()
			return err
		}
		_, err = io.Copy(out, in)
		in.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// ---------- Modello: da Ollama già installato ----------

type manifestOllama struct {
	Layers []struct {
		MediaType string `json:"mediaType"`
		Digest    string `json:"digest"`
		Size      int64  `json:"size"`
	} `json:"layers"`
}

func (m manifestOllama) modello() (digest string, size int64, ok bool) {
	for _, l := range m.Layers {
		if l.MediaType == "application/vnd.ollama.image.model" {
			return l.Digest, l.Size, true
		}
	}
	return "", 0, false
}

func copiaDaOllama(nome, dest string) error {
	root := os.Getenv("OLLAMA_MODELS")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".ollama", "models")
	}
	parti := strings.SplitN(nome, ":", 2)
	b, err := os.ReadFile(filepath.Join(root, "manifests", "registry.ollama.ai", "library", parti[0], parti[1]))
	if err != nil {
		return errors.New("non c'è")
	}
	var m manifestOllama
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	digest, _, ok := m.modello()
	if !ok {
		return errors.New("manifest senza modello")
	}
	blob := filepath.Join(root, "blobs", strings.Replace(digest, ":", "-", 1))
	fmt.Println("  trovato, lo copio (niente da scaricare)…")
	return copiaFile(blob, dest)
}

// ---------- Modello: dal registro di Ollama ----------

func scaricaDaRegistroOllama(nome, dest string) error {
	parti := strings.SplitN(nome, ":", 2)
	var m manifestOllama
	url := "https://registry.ollama.ai/v2/library/" + parti[0] + "/manifests/" + parti[1]
	if err := prendiJSON(url, "application/vnd.docker.distribution.manifest.v2+json", &m); err != nil {
		return err
	}
	digest, _, ok := m.modello()
	if !ok {
		return errors.New("manifest senza modello")
	}
	return scaricaFile("https://registry.ollama.ai/v2/library/"+parti[0]+"/blobs/"+digest, dest, strings.TrimPrefix(digest, "sha256:"))
}

// ---------- Modello: da Hugging Face (versioni GGUF fatte dalla comunità) ----------

type fileHF struct {
	Path string `json:"path"`
	Type string `json:"type"`
	Size int64  `json:"size"`
	LFS  *struct {
		Oid string `json:"oid"`
	} `json:"lfs"`
}

// sceltaGGUF: il file da prendere tra quelli del repository (Q4_K_M se c'è, mai il proiettore per le immagini).
func sceltaGGUF(files []fileHF) *fileHF {
	for _, q := range []string{"q4_k_m", "q4_k_s", "q5_k_m", "q4_0", "q8_0"} {
		for i := range files {
			p := strings.ToLower(files[i].Path)
			if files[i].Type == "file" && strings.HasSuffix(p, ".gguf") && strings.Contains(p, q) && !strings.Contains(p, "mmproj") {
				return &files[i]
			}
		}
	}
	return nil
}

func scaricaDaHF(cerca, dest string) error {
	var repos []struct {
		ID string `json:"id"`
	}
	if err := prendiJSON("https://huggingface.co/api/models?search="+cerca+"&sort=downloads&direction=-1&limit=30", "", &repos); err != nil {
		return err
	}
	for _, r := range repos {
		if !strings.Contains(strings.ToLower(r.ID), "gguf") {
			continue
		}
		var files []fileHF
		if err := prendiJSON("https://huggingface.co/api/models/"+r.ID+"/tree/main", "", &files); err != nil {
			continue
		}
		f := sceltaGGUF(files)
		if f == nil {
			continue
		}
		fmt.Printf("  %s/%s (%.1f GB)\n", r.ID, f.Path, float64(f.Size)/1e9)
		sha := ""
		if f.LFS != nil {
			sha = f.LFS.Oid
		}
		err := scaricaFile("https://huggingface.co/"+r.ID+"/resolve/main/"+f.Path, dest, sha)
		if err == nil {
			return nil
		}
		fmt.Println("  non va:", err)
	}
	return errors.New("nessuna versione GGUF trovata")
}

// ---------- Traduzione (per la prova dall'installazione) ----------

func traduci(testo, nome string) (string, error) {
	prompt := "<start_of_turn>user\nYou are a professional English (en) to Italian (it) translator. Your goal is to accurately convey " +
		"the meaning and nuances of the original English text while adhering to Italian grammar, vocabulary, and " +
		"cultural sensitivities.\nProduce only the Italian translation, without any additional explanations or " +
		"commentary. Please translate the following English text into Italian:\n\n\n" + testo + "<end_of_turn>\n<start_of_turn>model\n"
	body, _ := json.Marshal(map[string]any{"prompt": prompt, "n_predict": 256, "temperature": 0.2, "stop": []string{"<end_of_turn>"}})
	c := http.Client{Timeout: 5 * time.Minute}
	r, err := c.Post(fmt.Sprintf("http://127.0.0.1:%d/completion", porta), "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	var out struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&out); err != nil {
		return "", err
	}
	return strings.TrimSpace(out.Content), nil
}
