#!/usr/bin/env python3
"""EasyOCR-based passport polling scanner.

Wraps the robust core/scanner.py pipeline (EasyOCR 6-variant
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
# Dark environments produce low Laplacian variance; lower this if frames are being
# skipped due to "blurry" rejection in dim lighting. Default 15 suits low-light USB cams.
SHARPNESS_THRESHOLD = float(os.getenv("SHARPNESS_THRESHOLD", "15"))
# Camera brightness/gain/exposure boosts (0 = off / use camera default).
# Increase CAMERA_BRIGHTNESS (0-255) or CAMERA_GAIN (0-255) for dark environments.
# CAMERA_EXPOSURE is backend-specific: positive values = manual ms, -1 = auto.
CAMERA_BRIGHTNESS = int(os.getenv("CAMERA_BRIGHTNESS", "0"))
CAMERA_GAIN = int(os.getenv("CAMERA_GAIN", "0"))
CAMERA_EXPOSURE = int(os.getenv("CAMERA_EXPOSURE", "0"))

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
    import sys
    import cv2
    # On Windows use DirectShow (CAP_DSHOW) for reliable USB camera support.
    # On Linux fall back to V4L2 then the default backend.
    indices_to_try = [CAMERA_INDEX] if CAMERA_INDEX == 0 else [CAMERA_INDEX, 0]
    api = getattr(cv2, "CAP_DSHOW", None) if sys.platform == "win32" else None
    for idx in indices_to_try:
        try:
            cap = cv2.VideoCapture(idx, api) if api is not None else cv2.VideoCapture(idx, cv2.CAP_V4L2)
            if not cap.isOpened():
                cap.release()
                cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
                # Optional low-light boosts (only applied when env vars are non-zero).
                if CAMERA_BRIGHTNESS > 0:
                    cap.set(cv2.CAP_PROP_BRIGHTNESS, CAMERA_BRIGHTNESS)
                if CAMERA_GAIN > 0:
                    cap.set(cv2.CAP_PROP_GAIN, CAMERA_GAIN)
                if CAMERA_EXPOSURE != 0:
                    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)  # switch to manual
                    cap.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
                for _ in range(5):
                    cap.read()
                _camera = cap
                return cap
            cap.release()
        except Exception:
            pass
    return None


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

def _clear_debug_images():
    """Delete all debug images from the previous scan so the folder is fresh."""
    import glob as _glob
    debug_dir = scanner_root / "debug"
    if debug_dir.exists():
        for img in _glob.glob(str(debug_dir / "**" / "*.png"), recursive=True):
            try:
                os.remove(img)
            except Exception:
                pass
        print(json.dumps({"status": "debug_cleared"}), file=sys.stderr, flush=True)


def poll(timeout: float = 120.0):
    global _shutdown

    signal.signal(signal.SIGTERM, _sigterm_handler)
    signal.signal(signal.SIGINT, _sigterm_handler)

    # Clear debug images from the previous scan session before starting a new one.
    _clear_debug_images()

    # Warm up EasyOCR reader before opening camera (model load can take 30-90s)
    print(json.dumps({"status": "warming_up", "message": "Loading EasyOCR models..."}), file=sys.stderr, flush=True)
    warmup_start = time.time()

    try:
        from core.scanner import (
            scan_passport_from_frame,
            reset_deskew_angle_cache,
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
        print(json.dumps({"status": "ready", "warmup_seconds": round(warmup_elapsed, 1), "warning": "EasyOCR unavailable, OCR disabled"}), file=sys.stderr, flush=True)

    if _shutdown:
        print(json.dumps({"error": "Cancelled during warmup"}), file=sys.stdout)
        sys.exit(1)

    import cv2

    cap = _open_camera()
    if cap is None:
        print(json.dumps({"error": "Could not open camera"}), file=sys.stdout)
        sys.exit(1)

    # First frame that reaches MRZ strip deskew measures tilt; cache reuses angle (passport_mrz) until reset.
    reset_deskew_angle_cache("passport")

    start_time = time.time()
    attempt = 0
    skipped = 0
    no_mrz_count = 0  # consecutive frames with no MRZ detected

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

            try:
                # require_detection=True: if EasyOCR finds no MRZ lines in this frame,
                # skip all recognition work entirely and grab the next frame.
                result = scan_passport_from_frame(frame, frame_index=attempt + 1, require_detection=True)
            except Exception as e:
                # Print error as plain text so Node.js logs it visibly, then as JSON for attempt tracking.
                print(f"[scan error] {e}", file=sys.stderr, flush=True)
                attempt += 1
                print(json.dumps({"attempt": attempt, "elapsed": round(elapsed, 1), "error": str(e)}), file=sys.stderr, flush=True)
                time.sleep(0.5)
                continue

            if result is None:
                # MRZ not detected in this frame — skip quietly until passport is in view.
                no_mrz_count += 1
                if no_mrz_count % 5 == 1:  # log every 5 misses to avoid noise
                    print(json.dumps({"status": "waiting", "elapsed": round(elapsed, 1), "no_mrz_frames": no_mrz_count}), file=sys.stderr, flush=True)
                time.sleep(0.1)
                continue

            # MRZ was detected and OCR ran — increment attempt counter and log.
            attempt += 1
            no_mrz_count = 0
            print(json.dumps({"attempt": attempt, "elapsed": round(elapsed, 1), "sharpness": round(sharpness, 1)}), file=sys.stderr, flush=True)

            if result.get("passport_id") or result.get("guest_name"):
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

            # MRZ was detected but OCR couldn't decode it — try next frame.
            # EasyOCR processing is slow enough to serve as the natural poll interval.

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
