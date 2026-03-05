#!/usr/bin/env bash
# Setup script for AI Hotel Check-in Kiosk
# Installs both Node.js and Python dependencies.
#
# Usage:
#   ./scripts/setup.sh          # install everything
#   ./scripts/setup.sh --node   # Node.js only
#   ./scripts/setup.sh --python # Python only

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER_DIR="$ROOT_DIR/camera-and-nfc/Identification-and-payment-app"

install_node() {
  echo "=== Installing Node.js dependencies ==="
  cd "$ROOT_DIR/backend"
  npm install
  cd "$ROOT_DIR/frontend"
  npm install
  echo "=== Node.js dependencies installed ==="
}

install_python() {
  echo "=== Installing Python dependencies (passport scanner + NFC) ==="
  if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 not found. Please install Python 3.8+ first."
    exit 1
  fi

  if [ -f "$SCANNER_DIR/requirements.txt" ]; then
    python3 -m pip install -r "$SCANNER_DIR/requirements.txt"
  else
    echo "WARNING: $SCANNER_DIR/requirements.txt not found, skipping pip install."
  fi

  # Download EasyOCR models if the download script exists
  if [ -f "$SCANNER_DIR/download_easyocr_models.py" ]; then
    echo "=== Downloading EasyOCR models (if not already present) ==="
    cd "$SCANNER_DIR"
    python3 download_easyocr_models.py || echo "WARNING: EasyOCR model download failed (may already exist)."
  fi

  echo "=== Python dependencies installed ==="
}

setup_env() {
  if [ ! -f "$ROOT_DIR/.env" ]; then
    echo "=== Creating .env from .env.example ==="
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    echo "Created .env — please edit it with your API keys and config."
  else
    echo ".env already exists, skipping."
  fi
}

case "${1:-}" in
  --node)
    install_node
    ;;
  --python)
    install_python
    ;;
  *)
    setup_env
    install_node
    install_python
    echo ""
    echo "=== Setup complete! ==="
    echo "  1. Edit .env with your API keys"
    echo "  2. Run: npm run dev (from project root, or cd backend && npm run dev)"
    echo ""
    echo "To enable live hardware:"
    echo "  - Passport scanner: set PASSPORT_SCANNER_MODE=live in .env"
    echo "  - NFC reader: set NFC_SHARED_SECRET_KEY and ESP32_WIFI_START_URL in .env"
    ;;
esac
