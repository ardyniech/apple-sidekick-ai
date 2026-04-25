// Aurora Agent Bridge — single-file HTTP daemon untuk dijalankan di server Anda.
//
// Build:   go build -o aurora-agent ./agent-bridge
// Run (Tailscale, recommended):
//          ./aurora-agent -addr :8787 -root /path/to/project
//          # Browser hits  http://<tailscale-name>:8787  — auth handled by Tailnet (WireGuard).
// Run (public/optional token):
//          AURORA_TOKEN="<long-random>" ./aurora-agent -addr :8787 -root /path/to/project
//
// Endpoint (auth = bearer token IF env AURORA_TOKEN is set; otherwise open — only do that on Tailnet):
//   GET  /health                              -> { ok, version, uptime }
//   GET  /metrics                             -> CPU, RAM, disk, load, uptime
//   GET  /services                            -> [{ name, active, sub, description }]   (systemd)
//   POST /service     { name, action }        -> { ok, stdout, code }                   (start/stop/restart/status)
//   GET  /processes?n=15                      -> top N processes by CPU
//   POST /journal     { unit?, lines? }       -> { content }                            (journalctl -u … -n …)
//   POST /exec        { cmd, timeout }        -> { stdout, stderr, code, durationMs }   ⚠ FREE EXEC
//   POST /read        { path }                -> { content, size }
//   POST /write       { path, content, commit?, message? } -> { bytes, commit? }        ⚠ AUTO-APPLY
//   POST /git         { args[], cwd? }        -> { stdout, stderr, code }
//   POST /tail        { path, lines }         -> { content }
//
// Semua aksi tertulis di stdout sebagai audit log (timestamp, ip, action, args).
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "0.1.0"

var (
	startedAt = time.Now()
	token     = ""
	rootDir   = ""

	corsHeaders = map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age":       "86400",
	}
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	root := flag.String("root", ".", "project root (file ops are scoped here)")
	flag.Parse()

	token = strings.TrimSpace(os.Getenv("AURORA_TOKEN"))
	if token == "" {
		log.Printf("⚠ AURORA_TOKEN not set — auth DISABLED. Only safe behind Tailscale / private network.")
	}
	abs, err := filepath.Abs(*root)
	if err != nil {
		log.Fatalf("resolve root: %v", err)
	}
	rootDir = abs

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withCORS(health))
	mux.HandleFunc("/metrics", withCORS(authed(metrics)))
	mux.HandleFunc("/exec", withCORS(authed(execCmd)))
	mux.HandleFunc("/read", withCORS(authed(readFile)))
	mux.HandleFunc("/write", withCORS(authed(writeFile)))
	mux.HandleFunc("/git", withCORS(authed(gitCmd)))
	mux.HandleFunc("/tail", withCORS(authed(tailFile)))

	log.Printf("aurora-agent v%s listening on %s (root=%s)", version, *addr, rootDir)
	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// ---------- middleware ----------

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for k, v := range corsHeaders {
			w.Header().Set(k, v)
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}

func authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// If no token configured (Tailscale mode), skip auth.
		if token == "" {
			h(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got == "" || got != token {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid token"})
			return
		}
		h(w, r)
	}
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func parseJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(dst) // 4MB cap
}

func audit(r *http.Request, action, detail string) {
	log.Printf("[audit] %s %s %s :: %s", r.RemoteAddr, action, time.Now().Format(time.RFC3339), detail)
}

// safePath rejects paths that escape rootDir.
func safePath(p string) (string, error) {
	if p == "" {
		return "", errors.New("path required")
	}
	clean := filepath.Clean(p)
	if !filepath.IsAbs(clean) {
		clean = filepath.Join(rootDir, clean)
	}
	rel, err := filepath.Rel(rootDir, clean)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", errors.New("path escapes root directory")
	}
	return clean, nil
}

// ---------- handlers ----------

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":       true,
		"version":  version,
		"uptime":   int64(time.Since(startedAt).Seconds()),
		"hostname": hostname(),
		"os":       runtime.GOOS + "/" + runtime.GOARCH,
		"root":     rootDir,
	})
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}

// --- metrics ---

type cpuSample struct {
	idle, total uint64
}

var (
	prevCPU   cpuSample
	cpuMu     sync.Mutex
	haveProcCPU = runtime.GOOS == "linux"
)

func readCPUSample() (cpuSample, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuSample{}, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return cpuSample{}, errors.New("empty /proc/stat")
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuSample{}, errors.New("unexpected /proc/stat")
	}
	var total, idle uint64
	for i, v := range fields[1:] {
		n, _ := strconv.ParseUint(v, 10, 64)
		total += n
		if i == 3 { // idle
			idle = n
		}
	}
	return cpuSample{idle: idle, total: total}, nil
}

func cpuUsagePercent() float64 {
	if !haveProcCPU {
		return -1
	}
	cpuMu.Lock()
	defer cpuMu.Unlock()
	cur, err := readCPUSample()
	if err != nil {
		return -1
	}
	if prevCPU.total == 0 {
		prevCPU = cur
		time.Sleep(120 * time.Millisecond)
		cur, _ = readCPUSample()
	}
	dTotal := cur.total - prevCPU.total
	dIdle := cur.idle - prevCPU.idle
	prevCPU = cur
	if dTotal == 0 {
		return 0
	}
	return 100.0 * float64(dTotal-dIdle) / float64(dTotal)
}

func memInfo() (totalKB, availKB uint64, ok bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := s.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fmt.Sscanf(line, "MemTotal: %d kB", &totalKB)
		}
		if strings.HasPrefix(line, "MemAvailable:") {
			fmt.Sscanf(line, "MemAvailable: %d kB", &availKB)
		}
	}
	return totalKB, availKB, totalKB > 0
}

func loadAvg() (l1, l5, l15 float64, ok bool) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	parts := strings.Fields(string(b))
	if len(parts) < 3 {
		return 0, 0, 0, false
	}
	l1, _ = strconv.ParseFloat(parts[0], 64)
	l5, _ = strconv.ParseFloat(parts[1], 64)
	l15, _ = strconv.ParseFloat(parts[2], 64)
	return l1, l5, l15, true
}

func metrics(w http.ResponseWriter, _ *http.Request) {
	out := map[string]any{
		"hostname": hostname(),
		"os":       runtime.GOOS + "/" + runtime.GOARCH,
		"uptime":   int64(time.Since(startedAt).Seconds()),
	}
	out["cpuPercent"] = roundTo(cpuUsagePercent(), 1)
	if total, avail, ok := memInfo(); ok {
		used := total - avail
		out["memTotalMB"] = total / 1024
		out["memUsedMB"] = used / 1024
		out["memPercent"] = roundTo(100.0*float64(used)/float64(total), 1)
	}
	if l1, l5, l15, ok := loadAvg(); ok {
		out["load1"] = l1
		out["load5"] = l5
		out["load15"] = l15
	}
	if cmd := exec.Command("df", "-P", rootDir); cmd != nil {
		if b, err := cmd.Output(); err == nil {
			out["df"] = strings.TrimSpace(string(b))
		}
	}
	writeJSON(w, 200, out)
}

func roundTo(v float64, dec int) float64 {
	if v < 0 {
		return v
	}
	p := 1.0
	for i := 0; i < dec; i++ {
		p *= 10
	}
	return float64(int(v*p+0.5)) / p
}

// --- exec ---

type execReq struct {
	Cmd     string `json:"cmd"`
	Timeout int    `json:"timeout"` // seconds (default 30, max 300)
	Cwd     string `json:"cwd"`
}

func execCmd(w http.ResponseWriter, r *http.Request) {
	var req execReq
	if err := parseJSON(r, &req); err != nil || strings.TrimSpace(req.Cmd) == "" {
		writeJSON(w, 400, map[string]any{"error": "cmd required"})
		return
	}
	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 30
	}
	if timeout > 300 {
		timeout = 300
	}
	cwd := rootDir
	if req.Cwd != "" {
		if p, err := safePath(req.Cwd); err == nil {
			cwd = p
		}
	}

	audit(r, "exec", fmt.Sprintf("cwd=%s cmd=%q", cwd, req.Cmd))
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", req.Cmd)
	cmd.Dir = cwd
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	dur := time.Since(start).Milliseconds()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	writeJSON(w, 200, map[string]any{
		"stdout":     truncate(stdout.String(), 65536),
		"stderr":     truncate(stderr.String(), 32768),
		"code":       code,
		"durationMs": dur,
		"timedOut":   ctx.Err() == context.DeadlineExceeded,
	})
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…[truncated]"
}

// --- read ---

func readFile(w http.ResponseWriter, r *http.Request) {
	var req struct{ Path string `json:"path"` }
	if err := parseJSON(r, &req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid body"})
		return
	}
	p, err := safePath(req.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	audit(r, "read", p)
	b, err := os.ReadFile(p)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": err.Error()})
		return
	}
	if len(b) > 1<<20 {
		b = append(b[:1<<20], []byte("\n…[truncated 1MB]")...)
	}
	writeJSON(w, 200, map[string]any{"content": string(b), "size": len(b)})
}

// --- write (auto-commit) ---

type writeReq struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Commit  bool   `json:"commit"`
	Message string `json:"message"`
}

func writeFile(w http.ResponseWriter, r *http.Request) {
	var req writeReq
	if err := parseJSON(r, &req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid body"})
		return
	}
	p, err := safePath(req.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	audit(r, "write", fmt.Sprintf("%s (%d bytes, commit=%v)", p, len(req.Content), req.Commit))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	if err := os.WriteFile(p, []byte(req.Content), 0o644); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	resp := map[string]any{"bytes": len(req.Content), "path": p}
	if req.Commit {
		msg := req.Message
		if msg == "" {
			msg = "aurora-agent: update " + filepath.Base(p)
		}
		out, code := runGit([]string{"add", p}, rootDir)
		resp["addStdout"] = out
		resp["addCode"] = code
		out, code = runGit([]string{"commit", "-m", msg}, rootDir)
		resp["commitStdout"] = out
		resp["commitCode"] = code
	}
	writeJSON(w, 200, resp)
}

// --- git ---

func runGit(args []string, cwd string) (string, int) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	return truncate(buf.String(), 32768), code
}

func gitCmd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Args []string `json:"args"`
		Cwd  string   `json:"cwd"`
	}
	if err := parseJSON(r, &req); err != nil || len(req.Args) == 0 {
		writeJSON(w, 400, map[string]any{"error": "args required"})
		return
	}
	cwd := rootDir
	if req.Cwd != "" {
		if p, err := safePath(req.Cwd); err == nil {
			cwd = p
		}
	}
	audit(r, "git", strings.Join(req.Args, " "))
	out, code := runGit(req.Args, cwd)
	writeJSON(w, 200, map[string]any{"stdout": out, "code": code})
}

// --- tail ---

func tailFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path  string `json:"path"`
		Lines int    `json:"lines"`
	}
	if err := parseJSON(r, &req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid body"})
		return
	}
	if req.Lines <= 0 || req.Lines > 2000 {
		req.Lines = 200
	}
	p, err := safePath(req.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	audit(r, "tail", fmt.Sprintf("%s (%d lines)", p, req.Lines))
	cmd := exec.Command("tail", "-n", strconv.Itoa(req.Lines), p)
	out, _ := cmd.CombinedOutput()
	writeJSON(w, 200, map[string]any{"content": truncate(string(out), 65536)})
}
