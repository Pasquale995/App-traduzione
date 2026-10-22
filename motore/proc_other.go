//go:build !windows

package main

import (
	"fmt"
	"os/exec"
)

// Solo per provare il programma su Linux: il vero bersaglio è Windows.
func nomeServer() string { return "llama-server" }

func nascondiFinestra(cmd *exec.Cmd) {}

func registra(chiave, valore string) error {
	fmt.Println("  (registro di Windows)", chiave, "=", valore)
	return nil
}

func cancellaChiave(chiave string) {}

func legaAlProcesso(cmd *exec.Cmd) {}
