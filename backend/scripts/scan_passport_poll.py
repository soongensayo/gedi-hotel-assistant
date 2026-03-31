#!/usr/bin/env python3
"""DEPRECATED: Legacy passport MRZ polling scanner (no OCR implementation).

This script previously captured frames from the camera in a loop and ran
Tesseract-based OCR on the MRZ region. The main scanner pipeline has since
been migrated to an EasyOCR-only engine (see scan_passport_easyocr_poll.py
and camera-and-nfc/Identification-and-payment-app/core/scanner.py).

If this script is invoked by mistake, it will immediately exit with a clear
JSON error so callers do not misinterpret its output as a successful scan.

Usage:
  python3 scan_passport_poll.py              # poll camera (default 60s timeout)
  python3 scan_passport_poll.py --timeout 90 # custom timeout in seconds

Output (stdout): JSON with keys passport_id, guest_name, passport_image_base64
Progress (stderr): attempt count updates
Exit code: 0 = success, 1 = failure/timeout
"""

import argparse
import base64
import json
import os
import re
import signal
import sys
import time
from typing import Dict, List, Optional, Tuple

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"error": "opencv-python and numpy are required"}), file=sys.stdout)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_camera: Optional[cv2.VideoCapture] = None
_shutdown = False

CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CAMERA_WIDTH = int(os.getenv("CAMERA_WIDTH", "1920"))
CAMERA_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "1080"))
POLL_INTERVAL = float(os.getenv("PASSPORT_POLL_INTERVAL", "1.0"))

# ---------------------------------------------------------------------------
# ICAO 9303 MRZ check-digit engine (7-3-1 weighting, modulus 10)
# ---------------------------------------------------------------------------

_MRZ_CHAR_VALUE: Dict[str, int] = {str(d): d for d in range(10)}
_MRZ_CHAR_VALUE.update({chr(ord("A") + i): 10 + i for i in range(26)})
_MRZ_CHAR_VALUE["<"] = 0
_MRZ_WEIGHTS = [7, 3, 1]


def _mrz_check_digit(field: str) -> int:
    total = 0
    for i, ch in enumerate(field):
        total += _MRZ_CHAR_VALUE.get(ch, 0) * _MRZ_WEIGHTS[i % 3]
    return total % 10

# Common OCR misreads at digit positions
_OCR_CORRECTIONS: Dict[str, str] = {
    "O": "0", "D": "0", "Q": "0",
    "I": "1", "L": "1",
    "Z": "2", "S": "5", "B": "8", "G": "6",
}


def _try_correct_check_digits(line: str) -> str:
    """Attempt single-char corrections on TD3 Line 2 check-digit positions."""
    if len(line) != 44:
        return line
    digit_positions = [9, 19, 27, 43]
    corrected = list(line)
    for pos in digit_positions:
        ch = corrected[pos]
        if not ch.isdigit() and ch in _OCR_CORRECTIONS:
            corrected[pos] = _OCR_CORRECTIONS[ch]
    return "".join(corrected)


def _verify_checksums(line2: str) -> int:
    """Return number of ICAO 9303 checksums that pass (0-4) for a 44-char TD3 Line 2."""
    if len(line2) < 44:
        return 0
    passed = 0
    # Doc number (positions 0-8, check digit at 9)
    if line2[9].isdigit() and _mrz_check_digit(line2[0:9]) == int(line2[9]):
        passed += 1
    # Date of birth (positions 13-18, check digit at 19)
    if line2[19].isdigit() and _mrz_check_digit(line2[13:19]) == int(line2[19]):
        passed += 1
    # Expiry date (positions 21-26, check digit at 27)
    if line2[27].isdigit() and _mrz_check_digit(line2[21:27]) == int(line2[27]):
        passed += 1
    # Final check digit (positions 0-9 + 13-19 + 21-42, check digit at 43)
    composite = line2[0:10] + line2[13:20] + line2[21:43]
    if line2[43].isdigit() and _mrz_check_digit(composite) == int(line2[43]):
        passed += 1
    return passed


# ---------------------------------------------------------------------------
# MRZ text normalisation and TD3 candidate extraction
# ---------------------------------------------------------------------------

def _normalize_mrz(text: str) -> str:
    """Uppercase, whitespace to '<', strip non-MRZ chars."""
    text = text.upper()
    text = re.sub(r"\s+", "<", text)
    return re.sub(r"[^A-Z0-9<]", "", text)


def _extract_td3_lines(normalized: str) -> List[str]:
    """Extract all 44-char windows that could be TD3 MRZ lines."""
    if len(normalized) < 44:
        return []
    candidates = []
    for i in range(len(normalized) - 43):
        window = normalized[i:i + 44]
        candidates.append(window)
    return candidates


def _is_line1(line: str) -> bool:
    """True if line looks like a TD3 Line 1 (starts with P + filler/letter)."""
    return len(line) >= 5 and line[0] == "P" and (line[1] == "<" or line[1].isalpha())


def _parse_td3(line1: str, line2: str) -> Tuple[Optional[str], Optional[str]]:
    """Parse passport_id and guest_name from TD3 MRZ Line 1 + Line 2."""
    if len(line1) < 44 or len(line2) < 44:
        return None, None

    # Name from Line 1 positions 5-43
    name_field = line1[5:44].rstrip("<")
    parts = name_field.split("<<", 1)
    surname = parts[0].replace("<", " ").strip()
    given = (parts[1] if len(parts) > 1 else "").replace("<", " ").strip()
    surname = re.sub(r"\s+", " ", surname).strip()
    given = re.sub(r"\s+", " ", given).strip()
    guest_name = f"{given} {surname}".strip() if given else surname
    if not guest_name:
        guest_name = None

    # Passport number from Line 2 positions 0-8
    passport_id = line2[0:9].replace("<", "").strip() or None
    return passport_id, guest_name


# ---------------------------------------------------------------------------
# Frame processing: extract MRZ from a single camera frame
# ---------------------------------------------------------------------------

def _process_frame(frame: np.ndarray) -> Optional[dict]:
    """Try to read MRZ from a single frame. Returns parsed result or None."""
    if frame is None or frame.size == 0:
        return None

    h, w = frame.shape[:2]

    # The MRZ is in the bottom ~40% of a passport data page.
    # Try multiple vertical bands to be robust to positioning.
    band_starts = [0.55, 0.60, 0.65, 0.70]
    band_height = 0.35

    best_result: Optional[dict] = None
    best_checks = 0

    for band_start in band_starts:
        y1 = int(h * band_start)
        y2 = min(h, int(h * (band_start + band_height)))
        crop = frame[y1:y2, 0:w]
        if crop.size == 0:
            continue

        result, checks = _ocr_mrz_region(crop)
        if result and checks > best_checks:
            best_result = result
            best_checks = checks
            if checks >= 3:
                break

    return best_result


def _ocr_mrz_region(crop: np.ndarray) -> Tuple[Optional[dict], int]:
    """Run OCR on a cropped MRZ region and try to extract TD3 lines.
    Returns (result_dict, checksums_passed) or (None, 0)."""

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop

    # Build multiple image variants for robustness
    variants = [gray]

    # CLAHE enhanced
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    variants.append(clahe.apply(gray))

    # Otsu binary threshold
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(binary)

    # Sharpened
    kernel = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
    sharpened = cv2.filter2D(gray, -1, kernel)
    variants.append(sharpened)

    all_text_lines: List[str] = []

    for variant in variants:
        # NOTE: This legacy script previously used Tesseract here. To keep it
        # functional without Tesseract, wire it up to EasyOCR or remove this
        # script entirely in favor of scan_passport_easyocr_poll.py.
        normalized = _normalize_mrz("")
        if normalized:
            all_text_lines.append(normalized)

    # Try to find valid TD3 line pairs from all OCR output
    best_result: Optional[dict] = None
    best_checks = 0

    for normalized in all_text_lines:
        candidates = _extract_td3_lines(normalized)

        line1_cands = [c for c in candidates if _is_line1(c)]
        line2_cands = [c for c in candidates if not _is_line1(c)]

        for l2_raw in line2_cands:
            l2 = _try_correct_check_digits(l2_raw)
            checks = _verify_checksums(l2)

            # Need at least doc-number checksum to pass
            doc_ok = (
                len(l2) >= 10
                and l2[9].isdigit()
                and _mrz_check_digit(l2[0:9]) == int(l2[9])
            )
            if not doc_ok:
                continue

            passport_id = l2[0:9].replace("<", "").strip()
            if not passport_id or len(passport_id) < 5:
                continue

            # Try to pair with a Line 1 for the name
            guest_name = None
            for l1 in line1_cands:
                pid, name = _parse_td3(l1, l2)
                if name:
                    guest_name = name
                    break

            if checks > best_checks or (checks == best_checks and guest_name and best_result and not best_result.get("guest_name")):
                best_checks = checks
                best_result = {
                    "passport_id": passport_id,
                    "guest_name": guest_name,
                }

    return best_result, best_checks


# ---------------------------------------------------------------------------
# Image encoding
# ---------------------------------------------------------------------------

def _image_to_base64(image: np.ndarray) -> str:
    try:
        _, buf = cv2.imencode(".png", image)
        return base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Camera management
# ---------------------------------------------------------------------------

def _open_camera() -> Optional[cv2.VideoCapture]:
    global _camera
    # Try V4L2 backend first (required on Jetson where GStreamer fails for UVC cameras)
    cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_V4L2)
    if not cap.isOpened():
        cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
    # Let the camera warm up
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
# Signal handling
# ---------------------------------------------------------------------------

def _sigterm_handler(_signum, _frame):
    global _shutdown
    _shutdown = True


# ---------------------------------------------------------------------------
# Main polling loop
# ---------------------------------------------------------------------------

def poll(timeout: float = 60.0):
    """Entry point for the legacy poll script.

    This script is deprecated and no longer performs OCR. It exits immediately
    with a JSON error so callers do not rely on it for production scanning.
    """
    print(json.dumps({
        "error": "scan_passport_poll.py is deprecated. Use scan_passport_easyocr_poll.py (EasyOCR-only pipeline) instead."
    }), file=sys.stdout)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Passport MRZ polling scanner")
    parser.add_argument("--timeout", type=float, default=60.0, help="Timeout in seconds (default: 60)")
    args = parser.parse_args()
    poll(timeout=args.timeout)


if __name__ == "__main__":
    main()
