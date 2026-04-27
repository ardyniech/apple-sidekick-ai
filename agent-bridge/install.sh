#!/usr/bin/env bash
# Aurora Agent Bridge — installer
#
# What it does:
#   1. Checks Go is installed (>=1.21). Offers to install via the OS pkg mgr.
#   2. Builds the bridge binary.
#   3. Writes a systemd unit file (aurora-agent.service).
#   4. Enables + starts the service.
#   5. Prints the URL to paste into the Aurora UI.
#
# Usage (run on the SERVER, not on your laptop):
#   sudo bash install.sh
#   sudo bash install.sh --port 8787 --root /home/me/myapp --projects /home/me/projects
#
# Re-run safely. Edit /etc/aurora-agent.env to change settings.

set -euo pipefail

# ---- defaults ----
PORT="${AURORA_PORT:-8787}"
ROOT="${AURORA_ROOT:-$PWD}"
PROJECTS="${AURORA_PROJECTS:-}"
EXEC_MODE="${AURORA_EXEC_MODE:-free}"
TOKEN="${AURORA_TOKEN:-}"
INSTALL_DIR="/opt/aurora-agent"
SERVICE_USER="${AURORA_USER:-root}"

# ---- args ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)     PORT="$2"; shift 2;;
    --root)     ROOT="$2"; shift 2;;
    --projects) PROJECTS="$2"; shift 2;;
    --token)    TOKEN="$2"; shift 2;;
    --safe)     EXEC_MODE="safe"; shift;;
    --user)     SERVICE_USER="$2"; shift 2;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

# ---- root check ----
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo)." >&2
  exit 1
fi

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

cyan "── Aurora Agent Bridge installer ──"
echo "port      : $PORT"
echo "root      : $ROOT"
echo "projects  : ${PROJECTS:-<disabled>}"
echo "exec mode : $EXEC_MODE"
echo "token set : $([[ -n "$TOKEN" ]] && echo yes || echo no)"
echo "user      : $SERVICE_USER"
echo

# ---- 1. ensure go ----
if ! command -v go >/dev/null 2>&1; then
  yellow "Go not found. Trying to install…"
  if command -v apt-get >/dev/null; then
    apt-get update && apt-get install -y golang-go
  elif command -v dnf >/dev/null; then
    dnf install -y golang
  elif command -v pacman >/dev/null; then
    pacman -Sy --noconfirm go
  else
    red "Couldn't auto-install Go. Install it manually (https://go.dev/dl) then re-run."
    exit 1
  fi
fi
green "✓ go: $(go version)"

# ---- 2. locate bridge source ----
SRC_DIR=""
for cand in "$(pwd)" "$(dirname "$0")" "$(dirname "$0")/.." "$(dirname "$0")/../.."; do
  if [[ -f "$cand/main.go" ]]; then SRC_DIR="$cand"; break; fi
  if [[ -f "$cand/agent-bridge/main.go" ]]; then SRC_DIR="$cand/agent-bridge"; break; fi
done
if [[ -z "$SRC_DIR" ]]; then
  red "Couldn't find agent-bridge/main.go. Run this from inside the repo, or copy main.go to the cwd."
  exit 1
fi
cyan "Source dir : $SRC_DIR"

# ---- 3. build ----
mkdir -p "$INSTALL_DIR"
cyan "Building binary…"
( cd "$SRC_DIR" && go build -o "$INSTALL_DIR/aurora-agent" . )
chmod +x "$INSTALL_DIR/aurora-agent"
green "✓ binary at $INSTALL_DIR/aurora-agent"

# ---- 4. env file ----
ENV_FILE="/etc/aurora-agent.env"
{
  echo "# Aurora Agent Bridge environment — edit then: systemctl restart aurora-agent"
  echo "AURORA_TOKEN=$TOKEN"
  echo "AURORA_EXEC_MODE=$EXEC_MODE"
  echo "AURORA_PROJECTS=$PROJECTS"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
green "✓ wrote $ENV_FILE"

# ---- 5. systemd unit ----
UNIT="/etc/systemd/system/aurora-agent.service"
cat > "$UNIT" <<EOF
[Unit]
Description=Aurora Agent Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/aurora-agent -addr :$PORT -root $ROOT
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
green "✓ wrote $UNIT"

systemctl daemon-reload
systemctl enable --now aurora-agent.service
sleep 1

if systemctl is-active --quiet aurora-agent; then
  green "✓ aurora-agent is running"
else
  red "✗ aurora-agent failed. journalctl -u aurora-agent -n 50"
  exit 1
fi

# ---- 6. show URLs ----
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
TS_NAME=""
if command -v tailscale >/dev/null; then
  TS_NAME=$(tailscale status --self --peers=false --json 2>/dev/null | grep -oE '"DNSName":"[^"]+"' | head -1 | cut -d'"' -f4 | sed 's/\.$//') || true
fi

echo
green "──────── Done ────────"
echo "Test it locally:"
echo "  curl -s http://127.0.0.1:$PORT/health | head"
[[ -n "$HOST_IP" ]] && echo "  curl -s http://$HOST_IP:$PORT/health | head"
[[ -n "$TS_NAME"   ]] && echo "  curl -s http://$TS_NAME:$PORT/health | head"
echo
cyan "Paste this URL into Aurora → Settings → Agent Bridge:"
if [[ -n "$TS_NAME" ]]; then
  echo "  http://$TS_NAME:$PORT          (Tailscale, recommended)"
elif [[ -n "$HOST_IP" ]]; then
  echo "  http://$HOST_IP:$PORT          (LAN — only works if reachable from Aurora's edge)"
fi
[[ -n "$TOKEN" ]] && echo "  Token: $TOKEN"
echo
echo "Manage the service:"
echo "  systemctl status aurora-agent"
echo "  systemctl restart aurora-agent"
echo "  journalctl -u aurora-agent -f"
echo "  Edit env: $ENV_FILE"
