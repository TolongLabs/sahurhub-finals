#!/usr/bin/env bash
# Provision a Raspberry Pi OS Bookworm device from a SahurHub clone. The server
# steps work on Debian-family systems; the SPI/labwc steps are Bookworm-primary.
# Usage: sudo ./scripts/setup-pi.sh [--ssid NAME --pass SECRET] [--ip ADDRESS[/PREFIX]] [--dry-run]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/cert"
SERVICE_PATH="/etc/systemd/system/sahurhub.service"
AVAHI_HOSTNAME="sahurhub"
HTTP_PORT="${PORT:-8080}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
DRY_RUN=false
WIFI_SSID=""
WIFI_PASS=""
STATIC_IP=""

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/setup-pi.sh [options]

Options:
  --ssid NAME             Phone hotspot SSID (or SAHURHUB_WIFI_SSID in .env.local)
  --pass SECRET           Phone hotspot password (or SAHURHUB_WIFI_PASS in .env.local)
  --ip ADDRESS[/PREFIX]   Static Wi-Fi address; bare addresses default to /24
  --dry-run               Print the provisioning actions without changing the device
  -h, --help              Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ssid)
      [ "$#" -ge 2 ] || { echo "ERROR: --ssid needs a value." >&2; exit 2; }
      WIFI_SSID="$2"
      shift 2
      ;;
    --pass)
      [ "$#" -ge 2 ] || { echo "ERROR: --pass needs a value." >&2; exit 2; }
      WIFI_PASS="$2"
      shift 2
      ;;
    --ip)
      [ "$#" -ge 2 ] || { echo "ERROR: --ip needs a value." >&2; exit 2; }
      STATIC_IP="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ok() { printf '✓ %s\n' "$*"; }
skip() { printf '↷ %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
action() { printf '→ %s\n' "$*"; }

run() {
  if [ "$DRY_RUN" = true ]; then
    printf '  [dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

env_value() {
  local name="$1"
  local env_file="$ROOT_DIR/.env.local"

  [ -f "$env_file" ] || return 0
  awk -v name="$name" '
    index($0, name "=") == 1 {
      value = substr($0, length(name) + 2)
    }
    END { print value }
  ' "$env_file"
}

apt_package_available() {
  apt-cache show "$1" 2>/dev/null | grep -q '^Package:'
}

detect_lan_ip() {
  local ip=""
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1); exit}')"
  if [ -z "$ip" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$ip"
}

if [ "${EUID}" -ne 0 ]; then
  echo "ERROR: run this provisioning script with sudo." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "ERROR: scripts/setup-pi.sh supports Debian-family systems with apt only." >&2
  exit 1
fi

if [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = "root" ]; then
  if [ "$DRY_RUN" = true ]; then
    APP_USER="${USER:-pi}"
    warn "SUDO_USER is unavailable; dry run assumes app user $APP_USER. Run the real setup with sudo from the target user."
  else
    echo "ERROR: run via sudo from the user that should own and run SahurHub (SUDO_USER is required)." >&2
    exit 1
  fi
else
  APP_USER="$SUDO_USER"
fi

APP_HOME="$(getent passwd "$APP_USER" | awk -F: '{print $6}')"
if [ -z "$APP_HOME" ]; then
  if [ "$DRY_RUN" = true ]; then
    APP_HOME="/home/$APP_USER"
    warn "Could not find $APP_USER in passwd; dry run assumes $APP_HOME."
  else
    echo "ERROR: could not find the invoking user $APP_USER." >&2
    exit 1
  fi
fi

as_app_user() {
  if [ "$DRY_RUN" = true ]; then
    printf '  [dry-run as %s]' "$APP_USER"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$APP_HOME/.bun/bin:$PATH" "$@"
}

echo "== SahurHub Pi Provisioning =="
echo "Repository: $ROOT_DIR"
echo "App user: $APP_USER"

# --- System packages ---------------------------------------------------------
action "Installing required Debian packages"
APT_PACKAGES=(avahi-daemon ca-certificates curl libnss3-tools)
MISSING_APT_PACKAGES=()
for package in "${APT_PACKAGES[@]}"; do
  if ! dpkg -s "$package" >/dev/null 2>&1; then
    MISSING_APT_PACKAGES+=("$package")
  fi
done
if [ "${#MISSING_APT_PACKAGES[@]}" -gt 0 ]; then
  run apt-get update
  run apt-get install -y "${MISSING_APT_PACKAGES[@]}"
  ok "Installed missing system packages: ${MISSING_APT_PACKAGES[*]}"
else
  skip "avahi, mkcert trust support, and curl already installed"
fi

CHROMIUM_PACKAGE=""
if apt_package_available chromium; then
  CHROMIUM_PACKAGE="chromium"
elif apt_package_available chromium-browser; then
  CHROMIUM_PACKAGE="chromium-browser"
  if grep -qx 'ID=ubuntu' /etc/os-release 2>/dev/null; then
    warn "Ubuntu only exposes chromium-browser here; it is commonly a Snap transition package. Kiosk startup may need snapd."
  fi
fi

if [ -z "$CHROMIUM_PACKAGE" ]; then
  warn "No apt Chromium package found (checked chromium and chromium-browser); install a Chromium-compatible browser for kiosk mode."
elif command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
  skip "Chromium already available"
else
  action "Installing Chromium package: $CHROMIUM_PACKAGE"
  run apt-get update
  run apt-get install -y "$CHROMIUM_PACKAGE"
  ok "Installed $CHROMIUM_PACKAGE"
fi

# --- Bun and mkcert ----------------------------------------------------------
BUN_BIN="$APP_HOME/.bun/bin/bun"
BUNX_BIN="$APP_HOME/.bun/bin/bunx"
action "Checking Bun for $APP_USER"
if [ "$DRY_RUN" != true ] && [ -x "$BUN_BIN" ]; then
  skip "Bun already installed for $APP_USER"
else
  action "Installing Bun with the official installer ($(uname -m))"
  as_app_user bash -lc 'curl -fsSL https://bun.sh/install | bash'
  ok "Installed Bun for $APP_USER"
fi

if [ "$DRY_RUN" != true ] && { [ ! -x "$BUN_BIN" ] || [ ! -x "$BUNX_BIN" ]; }; then
  echo "ERROR: Bun or bunx was not found after installation." >&2
  exit 1
fi
action "Linking Bun for non-interactive builds"
run ln -sf "$BUN_BIN" /usr/local/bin/bun
run ln -sf "$BUNX_BIN" /usr/local/bin/bunx
ok "Linked bun and bunx into /usr/local/bin"

if command -v mkcert >/dev/null 2>&1; then
  skip "mkcert already installed: $(command -v mkcert)"
else
  case "$(uname -m)" in
    aarch64 | arm64) MKCERT_ARCH="arm64" ;;
    x86_64 | amd64) MKCERT_ARCH="amd64" ;;
    *)
      echo "ERROR: no static mkcert download is configured for $(uname -m); install mkcert manually." >&2
      exit 1
      ;;
  esac

  action "Installing static mkcert binary for linux/$MKCERT_ARCH"
  if [ "$DRY_RUN" = true ]; then
    MKCERT_TMP="/tmp/sahurhub-mkcert"
  else
    MKCERT_TMP="$(mktemp)"
  fi
  run curl -fsSL "https://dl.filippo.io/mkcert/latest?for=linux/$MKCERT_ARCH" -o "$MKCERT_TMP"
  run install -m 0755 "$MKCERT_TMP" /usr/local/bin/mkcert
  [ "$DRY_RUN" = true ] || rm -f "$MKCERT_TMP"
  ok "Installed mkcert"
fi

action "Installing the local mkcert trust root"
run mkcert -install
ok "mkcert trust root ready"

# --- Network, hostname, and certificate -------------------------------------
if [ -z "$WIFI_SSID" ]; then
  WIFI_SSID="$(env_value SAHURHUB_WIFI_SSID)"
fi
if [ -z "$WIFI_PASS" ]; then
  WIFI_PASS="$(env_value SAHURHUB_WIFI_PASS)"
fi
if [ -z "$STATIC_IP" ]; then
  STATIC_IP="$(env_value SAHURHUB_STATIC_IP)"
fi

if command -v nmcli >/dev/null 2>&1; then
  if [ -n "$WIFI_SSID" ] && [ -n "$WIFI_PASS" ]; then
    PROFILE_NAME="SahurHub Phone AP"
    if nmcli -t -f NAME connection show | grep -Fxq "$PROFILE_NAME"; then
      skip "NetworkManager profile already exists for the phone AP"
    else
      action "Creating NetworkManager profile for the supplied phone AP"
      run nmcli connection add type wifi ifname '*' con-name "$PROFILE_NAME" ssid "$WIFI_SSID"
      ok "Created NetworkManager profile"
    fi
    action "Applying the supplied phone AP credentials"
    run nmcli connection modify "$PROFILE_NAME" 802-11-wireless.ssid "$WIFI_SSID" wifi-sec.key-mgmt wpa-psk \
      wifi-sec.psk "$WIFI_PASS" connection.autoconnect yes
    ok "Phone AP credentials configured"

    if [ -n "$STATIC_IP" ]; then
      if [[ "$STATIC_IP" != */* ]]; then
        STATIC_IP="$STATIC_IP/24"
        warn "--ip omitted a prefix; using $STATIC_IP. Pass ADDRESS/PREFIX to override the /24 default."
      fi
      STATIC_HOST="${STATIC_IP%%/*}"
      STATIC_GATEWAY="$(awk -F. '{print $1 "." $2 "." $3 ".1"}' <<<"$STATIC_HOST")"
      action "Configuring static Wi-Fi address $STATIC_IP (gateway $STATIC_GATEWAY)"
      run nmcli connection modify "$PROFILE_NAME" ipv4.method manual ipv4.addresses "$STATIC_IP" ipv4.gateway "$STATIC_GATEWAY" ipv4.never-default no
      ok "Configured static Wi-Fi address"
    else
      skip "No --ip / SAHURHUB_STATIC_IP supplied; NetworkManager will use DHCP"
    fi

    action "Bringing up the phone AP connection"
    run nmcli connection up "$PROFILE_NAME"
    ok "Requested phone AP connection"
  else
    warn "Wi-Fi credentials absent; skip AP join. Supply --ssid/--pass or set SAHURHUB_WIFI_SSID/SAHURHUB_WIFI_PASS in .env.local."
  fi
else
  warn "nmcli is unavailable; skip Wi-Fi provisioning. Configure the phone AP manually."
fi

if command -v hostnamectl >/dev/null 2>&1; then
  if [ "$(hostname)" = "$AVAHI_HOSTNAME" ]; then
    skip "Hostname already $AVAHI_HOSTNAME"
  else
    action "Setting mDNS hostname to $AVAHI_HOSTNAME"
    run hostnamectl set-hostname "$AVAHI_HOSTNAME"
    ok "Hostname set to $AVAHI_HOSTNAME"
  fi
else
  warn "hostnamectl is unavailable; set hostname to $AVAHI_HOSTNAME manually for sahurhub.local."
fi

if command -v systemctl >/dev/null 2>&1; then
  action "Restarting Avahi for sahurhub.local"
  run systemctl enable --now avahi-daemon
  run systemctl restart avahi-daemon
  ok "Avahi is enabled"
else
  warn "systemctl is unavailable; start avahi-daemon manually."
fi

LAN_IP="${STATIC_IP%%/*}"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(detect_lan_ip)"
fi

if [ -z "$LAN_IP" ]; then
  warn "Could not detect a LAN IP; skipping cert generation. Re-run after joining the phone AP."
else
  action "Ensuring cert SANs include localhost, $LAN_IP, and sahurhub.local"
  if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ] \
    && openssl x509 -in "$CERT_DIR/cert.pem" -noout -text 2>/dev/null | grep -Fq "$LAN_IP" \
    && openssl x509 -in "$CERT_DIR/cert.pem" -noout -text 2>/dev/null | grep -Fq 'sahurhub.local'; then
    skip "Existing certificate already covers $LAN_IP and sahurhub.local"
  else
    run mkdir -p "$CERT_DIR"
    run mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" \
      localhost 127.0.0.1 ::1 "$LAN_IP" sahurhub.local
    run chown -R "$APP_USER:$APP_USER" "$CERT_DIR"
    ok "Generated certificate with both IP and mDNS SANs"
  fi
fi

# --- App, boot service, and kiosk -------------------------------------------
action "Installing SahurHub dependencies and building the browser apps"
as_app_user bash -lc "cd $(printf '%q' "$ROOT_DIR") && bun install && bun run build:remote && bun run build:kiosk"
ok "Built SahurHub remote and kiosk apps"

action "Installing sahurhub.service"
if [ "$DRY_RUN" = true ]; then
  printf '  [dry-run] write %s (User=%s, WorkingDirectory=%s)\n' "$SERVICE_PATH" "$APP_USER" "$ROOT_DIR"
else
  SERVICE_TMP="$(mktemp)"
  cat >"$SERVICE_TMP" <<EOF
[Unit]
Description=SahurHub server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$ROOT_DIR
Environment=PATH=$APP_HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-$ROOT_DIR/.env.local
ExecStart=$BUN_BIN run src/server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  if [ -f "$SERVICE_PATH" ] && cmp -s "$SERVICE_TMP" "$SERVICE_PATH"; then
    skip "sahurhub.service already matches the provisioning template"
  else
    install -m 0644 "$SERVICE_TMP" "$SERVICE_PATH"
    ok "Installed updated sahurhub.service"
  fi
  rm -f "$SERVICE_TMP"
fi
run systemctl daemon-reload
run systemctl enable --now sahurhub.service
ok "sahurhub.service enabled for boot"

CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || true)"
CHROMIUM_COMMAND="${CHROMIUM_BIN:-chromium}"
LABWC_AUTOSTART="$APP_HOME/.config/labwc/autostart"
if [ -n "$CHROMIUM_BIN" ] && { [ -d "$APP_HOME/.config/labwc" ] || command -v labwc >/dev/null 2>&1; }; then
  if [ -f "$LABWC_AUTOSTART" ] && grep -Fq '# SahurHub kiosk' "$LABWC_AUTOSTART"; then
    skip "labwc kiosk autostart already configured"
  else
    action "Configuring Raspberry Pi OS Bookworm labwc kiosk autostart"
    run mkdir -p "$(dirname "$LABWC_AUTOSTART")"
    if [ "$DRY_RUN" = true ]; then
      printf '  [dry-run] append Chromium kiosk command to %s\n' "$LABWC_AUTOSTART"
    else
      cat >>"$LABWC_AUTOSTART" <<EOF

# SahurHub kiosk
# Other desktops: add the following command to their own session autostart file.
$CHROMIUM_BIN --kiosk --app=http://localhost:$HTTP_PORT --noerrdialogs --disable-session-crashed-bubble &
EOF
      chown -R "$APP_USER:$APP_USER" "$APP_HOME/.config/labwc"
    fi
    ok "Configured labwc kiosk autostart"
  fi
else
  warn "labwc/Chromium path not detected; kiosk autostart was not installed. On another desktop, add '$CHROMIUM_COMMAND --kiosk --app=http://localhost:$HTTP_PORT' to its autostart file."
fi

BOOT_CONFIG="/boot/firmware/config.txt"
if [ -f "$BOOT_CONFIG" ]; then
  if grep -Fxq 'dtoverlay=piscreen,drm,speed=18000000,rotate=90' "$BOOT_CONFIG"; then
    skip "SPI DRM overlay already present"
  else
    action "Adding the confirmed PiScreen DRM overlay (reboot required)"
    if [ "$DRY_RUN" = true ]; then
      printf '  [dry-run] append confirmed PiScreen overlay to %s\n' "$BOOT_CONFIG"
    else
      cat >>"$BOOT_CONFIG" <<'EOF'

# SahurHub SPI panel: stock Bookworm has no waveshare35a,drm overlay. Do not use goodtft/LCD-show.
# Waveshare 3.5inch RPi LCD (A) Rev4.0: confirmed upright portrait orientation.
dtoverlay=piscreen,drm,speed=18000000,rotate=90
EOF
    fi
    ok "Added SPI DRM overlay; reboot to apply it"
  fi
else
  warn "$BOOT_CONFIG is absent; SPI overlay skipped (expected on non-Raspberry-Pi-OS layouts)."
fi

echo
echo "== Provisioning Summary =="
if [ -n "$LAN_IP" ]; then
  echo "Phone (QR target): https://$LAN_IP:$HTTPS_PORT"
else
  echo "Phone (QR target): unavailable until the Pi receives a LAN IP"
fi
echo "mDNS fallback: https://sahurhub.local:$HTTPS_PORT"
echo "Kiosk: http://localhost:$HTTP_PORT"
echo "Reboot once to apply the SPI overlay and confirm unattended kiosk startup."
