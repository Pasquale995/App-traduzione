//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func nomeServer() string { return "llama-server.exe" }

// La console di Windows di base non mostra bene le lettere accentate: la metto in UTF-8.
func init() {
	syscall.NewLazyDLL("kernel32.dll").NewProc("SetConsoleOutputCP").Call(65001)
}

// llama-server parte senza aprire una finestra nera.
func nascondiFinestra(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

func registra(chiave, valore string) error {
	return exec.Command("reg", "add", chiave, "/ve", "/t", "REG_SZ", "/d", valore, "/f").Run()
}

func cancellaChiave(chiave string) {
	exec.Command("reg", "delete", chiave, "/f").Run()
}

// legaAlProcesso mette llama-server in un "job" di Windows che si chiude insieme a questo programma:
// se il browser chiude Mercurio Motore di colpo, llama-server si spegne lo stesso e libera la scheda video.
func legaAlProcesso(cmd *exec.Cmd) {
	k := syscall.NewLazyDLL("kernel32.dll")
	job, _, _ := k.NewProc("CreateJobObjectW").Call(0, 0)
	if job == 0 {
		return
	}
	var info [144]byte // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (64 bit)
	info[16+1] = 0x20  // LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)
	r, _, _ := k.NewProc("SetInformationJobObject").Call(job, 9, uintptr(unsafe.Pointer(&info[0])), uintptr(len(info)))
	if r == 0 {
		return
	}
	h, _, _ := k.NewProc("OpenProcess").Call(0x0101, 0, uintptr(cmd.Process.Pid)) // PROCESS_SET_QUOTA | PROCESS_TERMINATE
	if h == 0 {
		return
	}
	k.NewProc("AssignProcessToJobObject").Call(job, h)
	k.NewProc("CloseHandle").Call(h)
	// Il job resta aperto finché vive questo programma: non chiudo l'handle apposta.
}
