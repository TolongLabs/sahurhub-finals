#!/usr/bin/env bash
# One-command bootstrap for SahurHub: bun install, a build of the remote
# webapp (apps/remote -> dist), an mkcert cert for the phone's HTTPS listener
# (same cert layout/convention as spikes/https-mic, SANs cover the LAN IP +
# sahurhub.local), and an .env.local scaffold. Idempotent — safe to re-run.
#
# Usage: ./scripts/setup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/cert"

echo "== SahurHub setup =="

# --- 1. Dependencies ---------------------------------------------------------
echo "Installing dependencies..."
(cd "$ROOT_DIR" && bun install)

# --- 2. Browser app builds (served by the Bun server) -------------------------
echo "Building the remote app..."
(cd "$ROOT_DIR" && bun run build:remote)
echo "Building the kiosk app..."
(cd "$ROOT_DIR" && bun run build:kiosk)

# --- 3. mkcert (phone HTTPS listener) ----------------------------------------
if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert not found. Install it with one of:"
  echo
  echo "  Dev machine (Debian/Ubuntu, incl. WSL):"
  echo "    sudo apt update && sudo apt install -y libnss3-tools"
  echo "    curl -JLO https://dl.filippo.io/mkcert/latest?for=linux/amd64"
  echo "    chmod +x mkcert-v*-linux-amd64 && sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert"
  echo
  echo "  Dev machine (macOS, Homebrew):"
  echo "    brew install mkcert nss"
  echo
  echo "  Raspberry Pi OS / Debian arm64 (Pi 5, Bookworm):"
  echo "    sudo apt update && sudo apt install -y libnss3-tools"
  echo "    curl -JLO https://dl.filippo.io/mkcert/latest?for=linux/arm64"
  echo "    chmod +x mkcert-v*-linux-arm64 && sudo mv mkcert-v*-linux-arm64 /usr/local/bin/mkcert"
  echo
  echo "Re-run ./scripts/setup.sh once mkcert is on PATH — the kiosk page still"
  echo "works over plain HTTP without it; only the phone's HTTPS listener waits."
else
  echo "mkcert found: $(mkcert -version 2>&1 || true)"
  mkcert -install

  LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
  if [ -z "${LAN_IP:-}" ]; then
    LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi

  mkdir -p "$CERT_DIR"
  if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    echo "Cert already exists at $CERT_DIR (delete cert/ to force regeneration for a new LAN IP)."
  elif [ -z "${LAN_IP:-}" ]; then
    echo "Could not auto-detect a LAN IP. Pass one explicitly:"
    echo "  LAN_IP=192.168.x.x ./scripts/setup.sh"
  else
    mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" \
      localhost 127.0.0.1 ::1 "$LAN_IP" sahurhub.local
    echo "Generated cert for localhost, 127.0.0.1, ::1, $LAN_IP, sahurhub.local"
  fi
fi

# --- 4. Env bootstrap ---------------------------------------------------------
if [ ! -f "$ROOT_DIR/.env.local" ]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env.local"
  echo "Created .env.local from .env.example — fill in DASHSCOPE_API_KEY."
else
  echo ".env.local already exists — leaving it untouched."
fi

echo
echo "Setup complete. Run the server with:"
echo "  bun run src/server/index.ts"
echo "Kiosk (local):  http://localhost:8080"
echo "Phone (LAN, if mkcert ran): https://<lan-ip>:8443"
