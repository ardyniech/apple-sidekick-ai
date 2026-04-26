// Aurora Agent Bridge — single-file HTTP daemon untuk dijalankan di server Anda.
//
// Build:   go build -o aurora-agent ./agent-bridge
// Run:
//   ./aurora-agent -addr :8787 -root /path/to/project
//   AURORA_TOKEN=secret ./aurora-agent -addr :8787 -root /path/to/project
//   AURORA_EXEC_MODE=safe ./aurora-agent ...   # default: free
//   AURORA_PROJECTS=/home/me/projects ./aurora-agent ...   # enables project switcher
//
// Endpoints (auth = bearer token IF env AURORA_TOKEN is set; otherwise open):
//   GET  /health                              -> { ok, version, uptime, execMode, projectsRoot }
//   GET  /metrics                             -> CPU, RAM, disk, load, uptime
//   GET  /services                            -> [{ name, active, sub, description }]
//   POST /service     { name, action }        -> { ok, stdout, code }
//   GET  /processes?n=15                      -> top N processes by CPU
//   POST /journal     { unit?, lines? }       -> { content }
//   GET  /journal/stream?unit=…               -> SSE stream of new log lines
//   POST /exec        { cmd, timeout, cwd }   -> { stdout, stderr, code, durationMs, blocked? }
//   POST /read        { path }                -> { content, size }
//   POST /diff        { path, content }       -> { diff, before, after, exists }   (preview, no write)
//   POST /write       { path, content, commit?, message? } -> { bytes, commit? }
//   POST /rollback    { steps?: 1 }           -> git reset --hard HEAD~N  (destructive)
//   POST /git         { args[], cwd? }        -> { stdout, stderr, code }
//   POST /tail        { path, lines }         -> { content }
//   GET  /projects                            -> [{ name, path, hasGit }]
//   GET  /actions                             -> built-in 1-click action recipes
//
// Audit log (timestamp, ip, action, args) goes to stdout.
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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "0.2.0"

var (
	startedAt    = time.Now()
	token        = ""
	rootDir      = ""
	projectsDir  = ""
	execMode     = "free" // "free" or "safe"
	allowedProgs = map[string]bool{
		// read-only diagnostics
		"git": true, "ls": true, "cat": true, "head": true, "tail": true,
		"pwd": true, "echo": true, "df": true, "du": true, "free": true,
		"uname": true, "hostname": true, "whoami": true, "id": true,
		"ps": true, "top": true, "htop": true, "uptime": true, "date": true,
		"systemctl": true, "journalctl": true, "service": true,
		"docker": true, "docker-compose": true, "podman": true,
		"npm": true, "pnpm": true, "yarn": true, "bun": true, "node": true,
		"go": true, "python": true, "python3": true, "pip": true, "pip3": true,
		"curl": true, "wget": true, "ping": true, "dig": true, "nslookup": true,
		"ss": true, "netstat": true, "lsof": true,
		"grep": true, "find": true, "awk": true, "sed": true, "wc": true,
		"sort": true, "uniq": true, "cut": true, "xargs": true,
		"make": true, "cargo": true, "rustc": true,
	}

	corsHeaders = map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age":       "86400",
	}
)

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	root := flag.String("root", ".", "active project root (file ops are scoped here)")
	flag.Parse()

	token = strings.TrimSpace(os.Getenv("AURORA_TOKEN"))
	if token == "" {
		log.Printf("⚠ AURORA_TOKEN not set — auth DISABLED. Only safe behind Tailscale / private network.")
	}
	if m := strings.ToLower(strings.TrimSpace(os.Getenv("AURORA_EXEC_MODE"))); m == "safe" {
		execMode = "safe"
	}
	log.Printf("exec mode: %s", execMode)

	if pd := strings.TrimSpace(os.Getenv("AURORA_PROJECTS")); pd != "" {
		if abs, err := filepath.Abs(pd); err == nil {
			projectsDir = abs
			log.Printf("projects root: %s (project switcher enabled)", projectsDir)
		}
	}

	abs, err := filepath.Abs(*root)
	if err != nil {
		log.Fatalf("resolve root: %v", err)
	}
	rootDir = abs

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withCORS(health))
	mux.HandleFunc("/metrics", withCORS(authed(metrics)))
	mux.HandleFunc("/services", withCORS(authed(listServices)))
	mux.HandleFunc("/service", withCORS(authed(serviceAction)))
	mux.HandleFunc("/processes", withCORS(authed(processes)))
	mux.HandleFunc("/journal", withCORS(authed(journal)))
	mux.HandleFunc("/journal/stream", withCORS(authed(journalStream)))
	mux.HandleFunc("/exec", withCORS(authed(execCmd)))
	mux.HandleFunc("/read", withCORS(authed(readFile)))
	mux.HandleFunc("/diff", withCORS(authed(diffFile)))
	mux.HandleFunc("/write", withCORS(authed(writeFile)))
	mux.HandleFunc("/rollback", withCORS(authed(rollback)))
	mux.HandleFunc("/git", withCORS(authed(gitCmd)))
	mux.HandleFunc("/tail", withCORS(authed(tailFile)))
	mux.HandleFunc("/projects", withCORS(authed(listProjects)))
	mux.HandleFunc("/project", withCORS(authed(switchProject)))
	mux.HandleFunc("/actions", withCORS(authed(listActions)))

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
		if token == "" {
			h(w, r)
			return
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		// SSE / EventSource may send token in query (no headers support)
		if got == "" {
			got = r.URL.Query().Get("token")
		}
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
	return json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(dst)
}

func audit(r *http.Request, action, detail string) {
	log.Printf("[audit] %s %s %s :: %s", r.RemoteAddr, action, time.Now().Format(time.RFC3339), detail)
}

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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…[truncated]"
}

// ---------- handlers ----------

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":           true,
		"version":      version,
		"uptime":       int64(time.Since(startedAt).Seconds()),
		"hostname":     hostname(),
		"os":           runtime.GOOS + "/" + runtime.GOARCH,
		"root":         rootDir,
		"execMode":     execMode,
		"projectsRoot": projectsDir,
	})
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}

// --- metrics ---

type cpuSample struct{ idle, total uint64 }

var (
	prevCPU     cpuSample
	cpuMu       sync.Mutex
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
		if i == 3 {
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

// --- exec (with safe-mode allow-list) ---

type execReq struct {
	Cmd     string `json:"cmd"`
	Timeout int    `json:"timeout"`
	Cwd     string `json:"cwd"`
}

// firstWord extracts the program name (handles "VAR=x cmd ..." prefixes).
func firstWord(cmd string) string {
	for _, tok := range strings.Fields(cmd) {
		if strings.Contains(tok, "=") && !strings.HasPrefix(tok, "-") {
			continue // env assignment
		}
		// strip path: /usr/bin/git -> git
		return filepath.Base(tok)
	}
	return ""
}

// safeModeBlocks returns "" if allowed, otherwise the reason.
func safeModeBlocks(cmd string) string {
	lower := strings.ToLower(cmd)
	// reject obvious destructive patterns even in free mode-friendly subsets
	bad := []string{"rm -rf /", ":(){:|:&};", "mkfs", "dd if=", "> /dev/sd"}
	for _, b := range bad {
		if strings.Contains(lower, b) {
			return "blocked: dangerous pattern detected (" + b + ")"
		}
	}
	if execMode != "safe" {
		return ""
	}
	// In safe mode: split on shell separators, every command head must be allow-listed
	parts := splitShellCommands(cmd)
	for _, p := range parts {
		head := firstWord(p)
		if head == "" {
			continue
		}
		if !allowedProgs[head] {
			return fmt.Sprintf("blocked: %q is not in safe-mode allow-list. Switch to free mode or add it to AURORA_ALLOW.", head)
		}
		// reject sudo + write flags within safe mode
		if head == "rm" || head == "mv" || head == "cp" || head == "chmod" || head == "chown" || head == "sudo" {
			return fmt.Sprintf("blocked: %q is destructive — not allowed in safe mode.", head)
		}
	}
	return ""
}

func splitShellCommands(cmd string) []string {
	// crude: split on ;  &&  ||  |
	repl := strings.NewReplacer("&&", "\x00", "||", "\x00", ";", "\x00", "|", "\x00")
	return strings.Split(repl.Replace(cmd), "\x00")
}

func execCmd(w http.ResponseWriter, r *http.Request) {
	var req execReq
	if err := parseJSON(r, &req); err != nil || strings.TrimSpace(req.Cmd) == "" {
		writeJSON(w, 400, map[string]any{"error": "cmd required"})
		return
	}
	if reason := safeModeBlocks(req.Cmd); reason != "" {
		audit(r, "exec-blocked", req.Cmd+" :: "+reason)
		writeJSON(w, 200, map[string]any{
			"stdout": "", "stderr": reason, "code": 126,
			"durationMs": 0, "blocked": true, "reason": reason,
		})
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

// --- diff (preview, NO write) ---

func diffFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := parseJSON(r, &req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid body"})
		return
	}
	p, err := safePath(req.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	audit(r, "diff", p)
	var before string
	exists := true
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			exists = false
		} else {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	} else {
		before = string(b)
	}
	d := unifiedDiff(before, req.Content, req.Path)
	writeJSON(w, 200, map[string]any{
		"diff":   d,
		"before": before,
		"after":  req.Content,
		"exists": exists,
	})
}

// unifiedDiff: minimal LCS-based unified-diff producer (no external deps).
// Good enough for code review previews; not byte-identical to GNU diff.
func unifiedDiff(a, b, label string) string {
	if a == b {
		return ""
	}
	la := strings.Split(a, "\n")
	lb := strings.Split(b, "\n")
	// Build LCS table (small files only — cap to avoid OOM)
	if len(la)*len(lb) > 4_000_000 {
		return fmt.Sprintf("--- %s (old)\n+++ %s (new)\n[diff too large to render]\n", label, label)
	}
	dp := make([][]int, len(la)+1)
	for i := range dp {
		dp[i] = make([]int, len(lb)+1)
	}
	for i := len(la) - 1; i >= 0; i-- {
		for j := len(lb) - 1; j >= 0; j-- {
			if la[i] == lb[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	var ops []string
	i, j := 0, 0
	for i < len(la) && j < len(lb) {
		if la[i] == lb[j] {
			ops = append(ops, " "+la[i])
			i++
			j++
		} else if dp[i+1][j] >= dp[i][j+1] {
			ops = append(ops, "-"+la[i])
			i++
		} else {
			ops = append(ops, "+"+lb[j])
			j++
		}
	}
	for ; i < len(la); i++ {
		ops = append(ops, "-"+la[i])
	}
	for ; j < len(lb); j++ {
		ops = append(ops, "+"+lb[j])
	}
	var out strings.Builder
	fmt.Fprintf(&out, "--- a/%s\n+++ b/%s\n", label, label)
	for _, line := range ops {
		out.WriteString(line)
		out.WriteString("\n")
	}
	return out.String()
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

// --- rollback ---

func rollback(w http.ResponseWriter, r *http.Request) {
	var req struct{ Steps int `json:"steps"` }
	_ = parseJSON(r, &req)
	if req.Steps <= 0 {
		req.Steps = 1
	}
	if req.Steps > 10 {
		req.Steps = 10
	}
	target := fmt.Sprintf("HEAD~%d", req.Steps)
	audit(r, "rollback", target)
	out, code := runGit([]string{"reset", "--hard", target}, rootDir)
	writeJSON(w, 200, map[string]any{"ok": code == 0, "stdout": out, "code": code, "target": target})
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

// --- services (systemd) ---

type serviceInfo struct {
	Name        string `json:"name"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
}

func listServices(w http.ResponseWriter, r *http.Request) {
	audit(r, "services", "list")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "systemctl", "list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend")
	out, err := cmd.Output()
	if err != nil {
		writeJSON(w, 200, map[string]any{"services": []serviceInfo{}, "error": "systemctl unavailable: " + err.Error()})
		return
	}
	var list []serviceInfo
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		desc := ""
		if len(fields) >= 5 {
			desc = strings.Join(fields[4:], " ")
		}
		list = append(list, serviceInfo{
			Name:        fields[0],
			Active:      fields[2],
			Sub:         fields[3],
			Description: desc,
		})
	}
	writeJSON(w, 200, map[string]any{"services": list})
}

func serviceAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string `json:"name"`
		Action string `json:"action"`
	}
	if err := parseJSON(r, &req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid body"})
		return
	}
	allowed := map[string]bool{"start": true, "stop": true, "restart": true, "status": true, "enable": true, "disable": true, "reload": true}
	if !allowed[req.Action] || strings.TrimSpace(req.Name) == "" {
		writeJSON(w, 400, map[string]any{"error": "invalid action or name"})
		return
	}
	if strings.ContainsAny(req.Name, " ;|&`$<>\n") {
		writeJSON(w, 400, map[string]any{"error": "invalid characters in name"})
		return
	}
	audit(r, "service", req.Action+" "+req.Name)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "systemctl", req.Action, req.Name)
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
	writeJSON(w, 200, map[string]any{"ok": code == 0, "stdout": truncate(buf.String(), 16384), "code": code})
}

func processes(w http.ResponseWriter, r *http.Request) {
	n := 15
	if v := r.URL.Query().Get("n"); v != "" {
		if k, err := strconv.Atoi(v); err == nil && k > 0 && k <= 100 {
			n = k
		}
	}
	audit(r, "processes", strconv.Itoa(n))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ps", "-eo", "pid,user,pcpu,pmem,comm,args", "--sort=-pcpu", "--no-headers")
	out, err := cmd.Output()
	if err != nil {
		writeJSON(w, 200, map[string]any{"processes": []any{}, "error": err.Error()})
		return
	}
	type p struct {
		Pid  int     `json:"pid"`
		User string  `json:"user"`
		Cpu  float64 `json:"cpu"`
		Mem  float64 `json:"mem"`
		Comm string  `json:"comm"`
		Args string  `json:"args"`
	}
	var list []p
	for i, line := range strings.Split(string(out), "\n") {
		if i >= n {
			break
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		pid, _ := strconv.Atoi(fields[0])
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		mem, _ := strconv.ParseFloat(fields[3], 64)
		args := strings.Join(fields[5:], " ")
		list = append(list, p{Pid: pid, User: fields[1], Cpu: cpu, Mem: mem, Comm: fields[4], Args: truncate(args, 200)})
	}
	writeJSON(w, 200, map[string]any{"processes": list})
}

func journal(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Unit  string `json:"unit"`
		Lines int    `json:"lines"`
	}
	_ = parseJSON(r, &req)
	if req.Lines <= 0 || req.Lines > 2000 {
		req.Lines = 200
	}
	args := []string{"-n", strconv.Itoa(req.Lines), "--no-pager", "--output=short-iso"}
	if strings.TrimSpace(req.Unit) != "" {
		if strings.ContainsAny(req.Unit, " ;|&`$<>\n") {
			writeJSON(w, 400, map[string]any{"error": "invalid unit"})
			return
		}
		args = append([]string{"-u", req.Unit}, args...)
	}
	audit(r, "journal", strings.Join(args, " "))
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		writeJSON(w, 200, map[string]any{"content": "", "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"content": truncate(string(out), 131072)})
}

// --- journal SSE stream ---

func journalStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	unit := r.URL.Query().Get("unit")
	if strings.ContainsAny(unit, " ;|&`$<>\n") {
		fmt.Fprintf(w, "event: error\ndata: invalid unit\n\n")
		flusher.Flush()
		return
	}
	args := []string{"-f", "-n", "50", "--no-pager", "--output=short-iso"}
	if unit != "" {
		args = append([]string{"-u", unit}, args...)
	}
	audit(r, "journal-stream", strings.Join(args, " "))
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		// Each SSE message: data: <line>\n\n
		fmt.Fprintf(w, "data: %s\n\n", strings.ReplaceAll(scanner.Text(), "\n", " "))
		flusher.Flush()
	}
}

// --- projects ---

type projectInfo struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	HasGit bool   `json:"hasGit"`
	Active bool   `json:"active"`
}

func listProjects(w http.ResponseWriter, r *http.Request) {
	audit(r, "projects", "list")
	if projectsDir == "" {
		// fall back: just return the active root
		writeJSON(w, 200, map[string]any{
			"projects": []projectInfo{{Name: filepath.Base(rootDir), Path: rootDir, HasGit: hasGitDir(rootDir), Active: true}},
			"note":     "AURORA_PROJECTS not set — switcher disabled. Set env var to a directory containing your projects.",
		})
		return
	}
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	var list []projectInfo
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(projectsDir, e.Name())
		list = append(list, projectInfo{
			Name:   e.Name(),
			Path:   p,
			HasGit: hasGitDir(p),
			Active: p == rootDir,
		})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	writeJSON(w, 200, map[string]any{"projects": list, "active": rootDir})
}

func hasGitDir(p string) bool {
	st, err := os.Stat(filepath.Join(p, ".git"))
	return err == nil && st.IsDir()
}

func switchProject(w http.ResponseWriter, r *http.Request) {
	var req struct{ Path string `json:"path"` }
	if err := parseJSON(r, &req); err != nil || req.Path == "" {
		writeJSON(w, 400, map[string]any{"error": "path required"})
		return
	}
	abs, err := filepath.Abs(req.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	// must be inside projectsDir if it's set
	if projectsDir != "" {
		rel, err := filepath.Rel(projectsDir, abs)
		if err != nil || strings.HasPrefix(rel, "..") {
			writeJSON(w, 400, map[string]any{"error": "path is outside AURORA_PROJECTS"})
			return
		}
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		writeJSON(w, 400, map[string]any{"error": "not a directory"})
		return
	}
	audit(r, "switch-project", abs)
	rootDir = abs
	writeJSON(w, 200, map[string]any{"ok": true, "active": rootDir})
}

// --- 1-click action recipes ---

type actionRecipe struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Cmd         string `json:"cmd"`
	Mutating    bool   `json:"mutating"`
}

func listActions(w http.ResponseWriter, _ *http.Request) {
	recipes := []actionRecipe{
		{ID: "disk-usage", Title: "Check disk space", Description: "df -h on root and project dir", Category: "diagnose", Cmd: "df -h"},
		{ID: "biggest-files", Title: "Find largest files", Description: "Top 20 biggest files in project", Category: "diagnose", Cmd: "du -ah . 2>/dev/null | sort -rh | head -n 20"},
		{ID: "git-status", Title: "Git status", Description: "Working tree status of active project", Category: "git", Cmd: "git status --short --branch"},
		{ID: "git-log", Title: "Recent commits", Description: "Last 10 commits", Category: "git", Cmd: "git log --oneline -n 10"},
		{ID: "ports-listening", Title: "Open ports", Description: "Sockets currently listening", Category: "network", Cmd: "ss -tulpen 2>/dev/null || netstat -tulpen"},
		{ID: "failed-services", Title: "Failed services", Description: "systemctl --failed", Category: "diagnose", Cmd: "systemctl --failed --no-pager"},
		{ID: "docker-ps", Title: "Docker containers", Description: "Running containers", Category: "docker", Cmd: "docker ps"},
		{ID: "node-modules-clean", Title: "Reinstall node_modules", Description: "Clean install (rm + install)", Category: "build", Cmd: "rm -rf node_modules && (test -f bun.lockb && bun install) || (test -f pnpm-lock.yaml && pnpm install) || npm install", Mutating: true},
		{ID: "git-pull", Title: "Pull latest", Description: "git pull --ff-only on active project", Category: "git", Cmd: "git pull --ff-only", Mutating: true},
		{ID: "build", Title: "Run build", Description: "npm/pnpm/bun build", Category: "build", Cmd: "(test -f bun.lockb && bun run build) || (test -f pnpm-lock.yaml && pnpm build) || npm run build", Mutating: true},
	}
	writeJSON(w, 200, map[string]any{"actions": recipes, "execMode": execMode})
}
