#!/usr/bin/env python3
"""Download EasyOCR English models into project easyocr_models/ for offline/edge use.

Run once on a machine with internet (and working SSL). Then ship the project
including the easyocr_models/ folder to edge devices so they never need to download.

Usage:
  python download_easyocr_models.py
  On Windows if progress bar crashes with Unicode: set PYTHONIOENCODING=utf-8 then run again.

Requires: pip install certifi easyocr
On Windows if you see SSL errors: pip install python-certifi-win32
"""

import os
import sys
from pathlib import Path

# Avoid progress-bar Unicode errors on Windows (e.g. \u2588)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent
MODEL_DIR = PROJECT_ROOT / "easyocr_models"


def _ensure_ssl():
    """Point Python to certifi's CA bundle so HTTPS downloads work (avoids CERTIFICATE_VERIFY_FAILED)."""
    try:
        import certifi
        cafile = certifi.where()
        os.environ["SSL_CERT_FILE"] = cafile
        os.environ["REQUESTS_CA_BUNDLE"] = cafile
        return True
    except ImportError:
        print("Warning: certifi not installed. Install with: pip install certifi", file=sys.stderr)
        return False


def main():
    _ensure_ssl()
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading EasyOCR English models into: {MODEL_DIR}")
    print("This may take a few minutes (detection + recognition models)...")

    try:
        import easyocr
        reader = easyocr.Reader(
            ["en"],
            model_storage_directory=str(MODEL_DIR),
            download_enabled=True,
        )
        print("Done. Models are in:", MODEL_DIR)
        required = ["craft_mlt_25k.pth", "english_g2.pth"]
        for f in required:
            p = MODEL_DIR / f
            print(f"  {'OK' if p.is_file() else 'MISSING'}: {f}")
        return 0
    except Exception as e:
        print("Error:", e, file=sys.stderr)
        if "CERTIFICATE_VERIFY_FAILED" in str(e) or "SSL" in str(e):
            print("On Windows try: pip install python-certifi-win32", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
