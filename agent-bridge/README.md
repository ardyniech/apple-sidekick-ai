# Aurora Agent Bridge

Single-file Go daemon yang berjalan di **server Anda** dan diakses oleh web app
Aurora lewat **Tailscale** (WireGuard mesh VPN). Tanpa bridge ini, web app tidak
punya cara legal untuk eksekusi shell, baca/tulis file, atau ambil metrics nyata
— karena browser disandbox.

## Kenapa Tailscale (bukan Cloudflare Tunnel)?

- **Auth otomatis**: Tailnet sudah meng-authenticate device pakai SSO Anda. Tidak
  perlu generate / paste / rotate token.
- **End-to-end encrypted (WireGuard)**: Tidak ada proxy publik di tengah.
- **Zero config DNS**: MagicDNS kasih hostname stabil (`my-server.tail-scale.ts.net`).
- **Tidak terbuka ke internet**: Port 8787 hanya bisa diakses device di Tailnet
  yang sama. Aman secara default.

## One-shot installer (recommended)

Copy this folder to the server and run:

```bash
sudo bash agent-bridge/install.sh \
  --port 8787 \
  --root /home/you/my-project \
  --projects /home/you/projects     # optional, enables project switcher
```

Installs as a `systemd` service, persistent across reboots. Edit
`/etc/aurora-agent.env` and `systemctl restart aurora-agent` to change settings.

## Manual build

Butuh Go 1.21+.

```bash
cd agent-bridge
go build -o aurora-agent .
```

Hasil: binary tunggal `aurora-agent` (~6 MB), tanpa runtime dependency.

## Setup (Tailscale)

```bash
# 1. Install Tailscale di SERVER
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# login lewat browser, otorize device

# 2. Install Tailscale di DEVICE yang buka web app (laptop/desktop)
#    https://tailscale.com/download — login ke tailnet yang sama.

# 3. Jalankan agent di server (tanpa token)
./aurora-agent -addr :8787 -root /home/you/my-project

# 4. Cari nama tailnet server
tailscale status
# Contoh output:
#   100.101.102.103   my-server   you@   linux   -
#   → MagicDNS name: my-server.tail-scale.ts.net
```

Di web app **Settings → Agent Bridge**, paste:
```
Base URL: http://my-server.tail-scale.ts.net:8787
Token   : (kosongkan)
```

Klik **Test bridge** — kalau hijau, beres.

## Endpoint

Semua endpoint kecuali `/health` butuh auth **kalau** `AURORA_TOKEN` di-set.
Di mode Tailscale token kosong = auth disabled (aman karena cuma device tailnet
yang bisa connect).

| Method | Path       | Body                                                           | Fungsi                              |
|--------|------------|----------------------------------------------------------------|-------------------------------------|
| GET    | `/health`  | —                                                              | Cek hidup, return version + uptime  |
| GET    | `/metrics` | —                                                              | CPU%, RAM, load, disk (Linux/proc)  |
| POST   | `/exec`    | `{ "cmd": "git status", "timeout": 30, "cwd": "subdir" }`      | Jalankan shell command (sh -c)      |
| POST   | `/read`    | `{ "path": "src/App.tsx" }`                                    | Baca file (max 1 MB)                |
| POST   | `/write`   | `{ "path": "...", "content": "...", "commit": true }`          | Tulis + auto git commit (opsional)  |
| POST   | `/git`     | `{ "args": ["log", "--oneline", "-10"] }`                      | Jalankan git command                |
| POST   | `/tail`    | `{ "path": "/var/log/app.log", "lines": 200 }`                 | tail -n untuk log file              |

Setiap request tertulis ke stdout sebagai audit log:
```
[audit] 100.x.y.z:54321 exec 2026-04-24T10:15:30Z :: cwd=/home/you/my-project cmd="git status"
```

## Mode publik (opsional)

Kalau Anda *harus* expose agent ke internet (mis. tidak bisa pasang Tailscale di
device tertentu), set token + taruh di belakang reverse proxy / Cloudflare Access:

```bash
export AURORA_TOKEN="$(openssl rand -hex 32)"
./aurora-agent -addr 127.0.0.1:8787 -root /home/you/my-project
# lalu reverse-proxy via Caddy/Nginx + TLS, isi token di Settings.
```

## Keamanan — BACA INI

Anda memilih **free exec + auto-commit**, jadi:

- Jalankan agent sebagai **user terbatas**, bukan root.
- Path file di-scope ke `-root`. Path traversal (`../`) ditolak.
- Di Tailscale: jangan expose port 8787 ke `0.0.0.0` di NIC publik. Bind ke
  tailnet interface saja (default `:8787` listen ke semua interface — kalau
  server Anda public-facing, ganti ke `-addr 100.x.x.x:8787` pakai IP tailnet).
- `git commit` butuh `git config user.email` & `user.name` di repo target.

## Systemd unit (opsional)

```ini
# /etc/systemd/system/aurora-agent.service
[Unit]
Description=Aurora Agent Bridge
After=network.target tailscaled.service

[Service]
Type=simple
User=aurora
ExecStart=/usr/local/bin/aurora-agent -addr :8787 -root /home/aurora/projects/my-app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
