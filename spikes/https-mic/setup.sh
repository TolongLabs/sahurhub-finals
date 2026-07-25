#!/usr/bin/env bash
# Idempotent setup for the https-mic spike: installs mkcert if missing,
# generates a LAN-trusted cert (localhost + this machine's LAN IP), and
# installs the spike's own zero-to-one dependency (qrcode-terminal).
#
# Usage: ./setup.sh
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SPIKE_DIR/cert"

echo "== https-mic spike setup =="

# --- 1. mkcert -------------------------------------------------------------
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
  echo "Re-run ./setup.sh once mkcert is on PATH."
  exit 1
fi
echo "mkcert found: $(mkcert -version 2>&1 || true)"

# Installs (or confirms) the local CA in the OS/browser trust stores. Safe to re-run.
mkcert -install

# --- 2. LAN IP ---------------------------------------------------------------
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
if [ -z "${LAN_IP:-}" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "${LAN_IP:-}" ]; then
  echo "Could not auto-detect a LAN IP. Pass one explicitly:"
  echo "  LAN_IP=192.168.x.x ./setup.sh"
  exit 1
fi
echo "Detected LAN IP: $LAN_IP"

# --- 3. Certificate (idempotent) --------------------------------------------
mkdir -p "$CERT_DIR"
if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
  echo "Cert already exists at $CERT_DIR (delete cert/ to force regeneration for a new LAN IP)."
else
  mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" \
    localhost 127.0.0.1 ::1 "$LAN_IP"
  echo "Generated cert for localhost, 127.0.0.1, ::1, $LAN_IP"
fi

# --- 4. Dependencies ---------------------------------------------------------
echo "Installing spike dependencies (qrcode-terminal — console ASCII QR, zero transitive deps)..."
(cd "$SPIKE_DIR" && bun install)

echo
echo "Setup complete. Run the server with:"
echo "  bun run $SPIKE_DIR/server.ts"
echo "Then open https://$LAN_IP:8443 on a phone joined to the same hotspot/LAN."
