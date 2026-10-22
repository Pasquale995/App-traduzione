package main

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestScegliZip(t *testing.T) {
	var rel releaseGH
	for _, n := range []string{
		"llama-b6800-bin-win-cpu-x64.zip", "llama-b6800-bin-win-cpu-arm64.zip",
		"llama-b6800-bin-win-cuda-12.4-x64.zip", "llama-b6800-bin-win-cuda-13.1-x64.zip",
		"cudart-llama-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-13.1-x64.zip",
		"llama-b6800-bin-win-vulkan-x64.zip", "llama-b6800-bin-ubuntu-x64.tar.gz",
	} {
		rel.Assets = append(rel.Assets, struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		}{n, "u/" + n})
	}
	c, err := scegliZip(rel, "cuda")
	if err != nil || len(c) != 3 || c[1] != "llama-b6800-bin-win-cuda-12.4-x64.zip" || c[2] != "cudart-llama-bin-win-cuda-12.4-x64.zip" {
		t.Fatal(c, err)
	}
	v, _ := scegliZip(rel, "vulkan")
	if len(v) != 2 || v[1] != "llama-b6800-bin-win-vulkan-x64.zip" {
		t.Fatal(v)
	}
}

func TestSceltaGGUF(t *testing.T) {
	f := sceltaGGUF([]fileHF{{Path: "mmproj-translategemma-Q4_K_M.gguf", Type: "file"}, {Path: "translategemma-4b-it.Q8_0.gguf", Type: "file"}, {Path: "translategemma-4b-it.Q4_K_M.gguf", Type: "file"}})
	if f == nil || f.Path != "translategemma-4b-it.Q4_K_M.gguf" {
		t.Fatal(f)
	}
}

// Il browser parla al programma: avvia, traduce con il (finto) llama-server, si scollega e il server si spegne.
func TestHost(t *testing.T) {
	dir := t.TempDir()
	os.Setenv("MERCURIO_CARTELLA", dir)
	llama := filepath.Join(dir, "llama")
	os.MkdirAll(llama, 0o755)
	os.WriteFile(filepath.Join(llama, "llama-server"), []byte(`#!/usr/bin/env python3
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(200); self.end_headers()
        self.wfile.write(json.dumps({"content": "Cavolo... " + str(len(b["prompt"]))}).encode())
port = int(sys.argv[sys.argv.index("--port") + 1])
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
`), 0o755)
	modello := filepath.Join(dir, "m.gguf")
	os.WriteFile(modello, []byte("x"), 0o644)
	salvaConfig(&Config{Llama: llama, Backend: "cuda", Modello: modello, Nome: "Finto"})

	exe, _ := os.Executable()
	cmd := exec.Command(exe, "-test.run=TestFaiIlHost")
	cmd.Env = append(os.Environ(), "MERCURIO_HOST=1")
	in, _ := cmd.StdinPipe()
	outp, _ := cmd.StdoutPipe()
	cmd.Start()
	out := bufio.NewReader(outp)
	var b bytes.Buffer
	manda := func(m map[string]any) { b.Reset(); mandaMessaggio(&b, m); in.Write(b.Bytes()) }
	ricevi := func() map[string]any {
		for {
			m, err := leggiMessaggio(out)
			if err != nil {
				t.Fatal(err)
			}
			if m["evento"] == nil {
				return m
			}
			t.Log("evento:", m["testo"])
		}
	}
	manda(map[string]any{"cmd": "avvia", "id": 1})
	r := ricevi()
	if r["ok"] != true || r["id"].(float64) != 1 {
		t.Fatal(r)
	}
	it, err := traduci("DAMN", "Finto")
	if err != nil || it == "" {
		t.Fatal(it, err)
	}
	t.Log("risposta:", r, it)
	in.Close() // il browser si scollega
	io.Copy(io.Discard, outp)
	cmd.Wait()
	time.Sleep(300 * time.Millisecond)
	if (&Server{}).vivo() {
		t.Fatal("llama-server è rimasto acceso")
	}
}

func TestFaiIlHost(t *testing.T) {
	if os.Getenv("MERCURIO_HOST") == "1" {
		host()
	}
}
