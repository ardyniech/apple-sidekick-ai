# Aurora Agent Bridge

Single-file Go daemon yang berjalan di **server Anda** dan diakses oleh web app
Aurora lewat HTTPS (Cloudflare Tunnel). Tanpa bridge ini, web app tidak punya
cara legal untuk eksekusi shell, baca/tulis file, atau ambil metrics nyata —
karena browser disandbox.

## Build

Butuh Go 1.21+.

```bash
cd agent-bridge
go build -o aurora-agent .
```

Hasil: binary tunggal `aurora-agent` (~6 MB), tanpa runtime dependency.

## Jalankan

```bash
# 1. Generate token panjang (sekali saja, simpan baik-baik)
export AURORA_TOKEN="$(openssl rand -hex 32)"
echo $AURORA_TOKEN   # ← copy ke Settings → Agent Bridge → Token di web app

# 2. Jalankan, arahkan ke root project Anda
./aurora-agent -addr :8787 -root /home/you/my-project
```

Output:
```
aurora-agent v0.1.0 listening on :8787 (root=/home/you/my-project)
```

Setiap request tertulis ke stdout sebagai audit log:
```
[audit] 1.2.3.4:54321 exec 2026-04-24T10:15:30Z :: cwd=/home/you/my-project cmd="git status"
```

## Expose via Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:8787
```

Cloudflare akan kasih URL semacam `https://random-name.trycloudflare.com`.
Masukkan URL itu ke **Settings → Agent Bridge → Base URL** di web app.

Untuk produksi, lebih baik named tunnel dengan custom domain + Cloudflare
Access (zero-trust) di depannya.

## Endpoint

Semua endpoint kecuali `/health` butuh header
`Authorization: Bearer <AURORA_TOKEN>`.

| Method | Path       | Body                                                           | Fungsi                              |
|--------|------------|----------------------------------------------------------------|-------------------------------------|
| GET    | `/health`  | —                                                              | Cek hidup, return version + uptime  |
| GET    | `/metrics` | —                                                              | CPU%, RAM, load, disk (Linux/proc)  |
| POST   | `/exec`    | `{ "cmd": "git status", "timeout": 30, "cwd": "subdir" }`      | Jalankan shell command (sh -c)      |
| POST   | `/read`    | `{ "path": "src/App.tsx" }`                                    | Baca file (max 1 MB)                |
| POST   | `/write`   | `{ "path": "...", "content": "...", "commit": true }`          | Tulis + auto git commit (opsional)  |
| POST   | `/git`     | `{ "args": ["log", "--oneline", "-10"] }`                      | Jalankan git command                |
| POST   | `/tail`    | `{ "path": "/var/log/app.log", "lines": 200 }`                 | tail -n untuk log file              |

## Keamanan — BACA INI

Anda memilih **free exec + auto-commit**, jadi:

- Token = satu-satunya pertahanan. **Pakai 32+ random bytes**, jangan share.
- Path file di-scope ke `-root`. Path traversal (`../`) ditolak.
- Pertimbangkan pasang **Cloudflare Access** di depan tunnel (login Google/GitHub
  sebelum request masuk ke Aurora).
- Jalankan agent sebagai **user terbatas**, bukan root.
- `git commit` butuh `git config user.email` & `user.name` di repo target.

## Systemd unit (opsional)

```ini
# /etc/systemd/system/aurora-agent.service
[Unit]
Description=Aurora Agent Bridge
After=network.target

[Service]
Type=simple
User=aurora
Environment=AURORA_TOKEN=PASTE_TOKEN_HERE
ExecStart=/usr/local/bin/aurora-agent -addr 127.0.0.1:8787 -root /home/aurora/projects/my-app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
