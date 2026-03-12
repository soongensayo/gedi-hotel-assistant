#!/usr/bin/env python3
"""EasyOCR-based passport polling scanner.

Wraps the robust core/scanner.py pipeline (EasyOCR + Tesseract, 6-variant
shotgun OCR, MRZ checksum gating, confidence-weighted voting) in an automated
camera polling loop — no user interaction required.

Called by the Node.js backend as a child process.
Handles SIGTERM gracefully for mid-scan cancellation.

Usage:
  python3 scan_passport_easyocr_poll.py              # poll camera (default 120s timeout)
  python3 scan_passport_easyocr_poll.py --timeout 90 # custom timeout in seconds

Output (stdout): JSON with keys passport_id, guest_name, passport_image_base64
Progress (stderr): attempt count updates + warmup status
Exit code: 0 = success, 1 = failure/timeout
"""

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Wire up core/scanner.py from the camera-and-nfc project
# ---------------------------------------------------------------------------

project_root = Path(__file__).resolve().parent.parent.parent
scanner_root = project_root / "camera-and-nfc" / "Identification-and-payment-app"

if str(scanner_root) not in sys.path:
    sys.path.insert(0, str(scanner_root))

env_path = scanner_root / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path)
    except ImportError:
        pass

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_camera = None  # type: Optional[object]
_shutdown = False

CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CAMERA_WIDTH = int(os.getenv("CAMERA_WIDTH", "1920"))
CAMERA_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "1080"))
SHARPNESS_THRESHOLD = float(os.getenv("SHARPNESS_THRESHOLD", "50"))

# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------

def _sigterm_handler(_signum, _frame):
    global _shutdown
    _shutdown = True

# ---------------------------------------------------------------------------
# Camera management
# ---------------------------------------------------------------------------

def _open_camera():
    global _camera
    import cv2
    cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_V4L2)
    if not cap.isOpened():
        cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
    for _ in range(5):
        cap.read()
    _camera = cap
    return cap


def _close_camera():
    global _camera
    if _camera is not None:
        try:
            _camera.release()
        except Exception:
            pass
        _camera = None

# ---------------------------------------------------------------------------
# Main polling loop
# ---------------------------------------------------------------------------

def poll(timeout: float = 120.0):
    global _shutdown

    signal.signal(signal.SIGTERM, _sigterm_handler)
    signal.signal(signal.SIGINT, _sigterm_handler)

    # Warm up EasyOCR reader before opening camera (model load can take 30-90s)
    print(json.dumps({"status": "warming_up", "message": "Loading EasyOCR models..."}), file=sys.stderr, flush=True)
    warmup_start = time.time()

    try:
        from core.scanner import (
            scan_passport_from_frame,
            _sharpness_score,
            _get_easyocr_reader,
            _passport_image_to_base64,
        )
    except ImportError as e:
        print(json.dumps({"error": f"Failed to import core.scanner: {e}"}), file=sys.stdout)
        sys.exit(1)

    reader = _get_easyocr_reader()
    warmup_elapsed = time.time() - warmup_start
    if reader is not None:
        print(json.dumps({"status": "ready", "warmup_seconds": round(warmup_elapsed, 1)}), file=sys.stderr, flush=True)
    else:
        print(json.dumps({"status": "ready", "warmup_seconds": round(warmup_elapsed, 1), "warning": "EasyOCR unavailable, using Tesseract-only fallback"}), file=sys.stderr, flush=True)

    if _shutdown:
        print(json.dumps({"error": "Cancelled during warmup"}), file=sys.stdout)
        sys.exit(1)

    import cv2

    cap = _open_camera()
    if cap is None:
        print(json.dumps({"error": "Could not open camera"}), file=sys.stdout)
        sys.exit(1)

    start_time = time.time()
    attempt = 0
    skipped = 0

    try:
        while not _shutdown:
            elapsed = time.time() - start_time
            if elapsed > timeout:
                print(json.dumps({"error": "Timeout: no passport detected", "attempts": attempt, "skipped_blurry": skipped}), file=sys.stdout)
                sys.exit(1)

            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.2)
                continue

            sharpness = _sharpness_score(frame, use_center_region=True)
            if sharpness < SHARPNESS_THRESHOLD:
                skipped += 1
                time.sleep(0.1)
                continue

            attempt += 1
            print(json.dumps({"attempt": attempt, "elapsed": round(elapsed, 1), "sharpness": round(sharpness, 1)}), file=sys.stderr, flush=True)

            try:
                result = scan_passport_from_frame(frame, frame_index=attempt)
            except Exception as e:
                print(json.dumps({"attempt": attempt, "error": str(e)}), file=sys.stderr, flush=True)
                time.sleep(0.5)
                continue

            if result and result.get("passport_id"):
                deskewed = result.get("deskewed_image")
                passport_image_base64 = ""
                if deskewed is not None:
                    passport_image_base64 = _passport_image_to_base64(deskewed)

                output = {
                    "passport_id": result.get("passport_id") or "",
                    "guest_name": result.get("guest_name") or "",
                    "passport_image_base64": passport_image_base64,
                }
                print(json.dumps(output), file=sys.stdout)
                sys.exit(0)

            # EasyOCR processing is slow enough to serve as the natural poll interval.
            # No explicit sleep needed after a full OCR attempt.

    finally:
        _close_camera()

    # Reached here only via SIGTERM/SIGINT
    print(json.dumps({"error": "Cancelled"}), file=sys.stdout)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="EasyOCR passport polling scanner")
    parser.add_argument("--timeout", type=float, default=120.0, help="Timeout in seconds (default: 120)")
    args = parser.parse_args()
    poll(timeout=args.timeout)


if __name__ == "__main__":
    main()
