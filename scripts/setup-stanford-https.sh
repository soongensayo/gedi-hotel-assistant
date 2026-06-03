#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/stanford/certs"
KEY_PATH="$CERT_DIR/dev-key.pem"
CERT_PATH="$CERT_DIR/dev-cert.pem"
OPENSSL_CONFIG="$CERT_DIR/dev-openssl.cnf"

detect_lan_ip() {
  local detected=""

  if command -v ipconfig >/dev/null 2>&1; then
    detected="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    if [[ -n "$detected" ]]; then
      echo "$detected"
      return
    fi
  fi

  if command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "$detected" ]]; then
      echo "$detected"
      return
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    detected="$(ifconfig 2>/dev/null | awk '
      /^[-a-zA-Z0-9]+:/ { candidate = "" }
      /inet / && $2 != "127.0.0.1" { candidate = $2 }
      /status: active/ && candidate != "" { print candidate; exit }
    ' || true)"
    if [[ -n "$detected" ]]; then
      echo "$detected"
    fi
  fi
}

LAN_IP="${1:-$(detect_lan_ip)}"

if [[ -z "${LAN_IP}" ]]; then
  echo "Could not auto-detect a LAN IP."
  echo "Run: npm run setup:stanford-https -- 192.168.x.x"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate the local HTTPS certificate."
  exit 1
fi

mkdir -p "$CERT_DIR"

cat > "$OPENSSL_CONFIG" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = PrimeDrive Stanford Dev

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = ${LAN_IP}
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days 14 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -config "$OPENSSL_CONFIG" >/dev/null 2>&1

echo "Generated Stanford HTTPS cert for:"
echo "  https://localhost:5174/"
echo "  https://${LAN_IP}:5174/"
echo
echo "Next demo command:"
echo "  npm run dev:stanford:https"
echo
echo "On the staff laptop, open:"
echo "  https://${LAN_IP}:5174/staff"
echo
echo "Because this is a local self-signed cert, the staff browser must accept/trust it once."
