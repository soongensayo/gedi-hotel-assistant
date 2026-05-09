#!/usr/bin/env python3
"""Passport scanner — live camera preview, SPACE to capture.

Runs entirely on the local laptop. No external APIs, no servers.

Modes:
  python scripts/scan_passport.py                   # live preview, SPACE to scan, Q/ESC to quit
  python scripts/scan_passport.py --auto            # automatic poll (no window) until passport detected
  python scripts/scan_passport.py --auto --timeout 60
  python scripts/scan_passport.py path/to/image.jpg # OCR a static image
  python scripts/scan_passport.py --json            # also dump full JSON (incl. image base64) at end

Output:
  - Human-readable lines: "Passport No: ..." and "Name: ..."
  - The cropped passport image is saved next to the script as `last_passport_capture.png`
"""

import argparse
import json
import os
import signal
import sys
import time
import warnings

# Silence torch / easyocr DeprecationWarnings before they're imported
warnings.filterwarnings("ignore", category=DeprecationWarning)
os.environ.setdefault("PYTHONWARNINGS", "ignore::DeprecationWarning")

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCANNER_ROOT = PROJECT_ROOT / "camera-and-nfc" / "Identification-and-payment-app"
SAVE_PATH    = PROJECT_ROOT / "last_passport_capture.png"

if str(SCANNER_ROOT) not in sys.path:
    sys.path.insert(0, str(SCANNER_ROOT))

env_path = SCANNER_ROOT / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

# Camera tuning (read from .env, with sensible defaults)
CAMERA_INDEX        = int(os.getenv("CAMERA_INDEX", "0"))
CAMERA_WIDTH        = int(os.getenv("CAMERA_WIDTH", "1920"))
CAMERA_HEIGHT       = int(os.getenv("CAMERA_HEIGHT", "1080"))
SHARPNESS_THRESHOLD = float(os.getenv("SHARPNESS_THRESHOLD", "15"))

_shutdown = False


def _sigterm_handler(_sig, _frame):
    global _shutdown
    _shutdown = True


# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------
def _open_camera():
    import cv2
    api = getattr(cv2, "CAP_DSHOW", None) if sys.platform == "win32" else None
    indices = [CAMERA_INDEX] if CAMERA_INDEX == 0 else [CAMERA_INDEX, 0]
    for idx in indices:
        try:
            cap = cv2.VideoCapture(idx, api) if api else cv2.VideoCapture(idx)
            if not cap.isOpened():
                cap.release()
                cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
                for _ in range(5):
                    cap.read()  # discard stale buffered frames
                return cap
            cap.release()
        except Exception:
            pass
    return None


# ---------------------------------------------------------------------------
# Result formatting
# ---------------------------------------------------------------------------
def _print_result(passport_id: str, guest_name: str, saved_path: Path | None, dump_json: bool, full_result: dict | None = None):
    """Print clean human-readable lines (no base64 spam)."""
    print()
    print("=" * 60)
    print(" PASSPORT READ SUCCESS")
    print("=" * 60)
    print(f" Passport No : {passport_id or '(not detected)'}")
    print(f" Name        : {guest_name or '(not detected)'}")
    if saved_path and saved_path.exists():
        print(f" Image saved : {saved_path}")
    print("=" * 60)
    if dump_json and full_result is not None:
        # Strip base64 from the visible printout but keep it valid JSON for piping
        print(json.dumps(full_result))


def _save_crop(deskewed, save_path: Path) -> Path | None:
    """Save the cropped passport image to disk so we don't dump base64 to stdout."""
    if deskewed is None:
        return None
    try:
        import cv2
        save_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(save_path), deskewed)
        return save_path
    except Exception as e:
        print(f"  (could not save crop: {e})", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Live preview mode (default) — SPACE to capture
# ---------------------------------------------------------------------------
# Sharpness "looks good" threshold for the focus bar (visual hint only — does NOT
# block SPACE). Typical readings: <30 = blurry, 30-80 = ok, >80 = sharp.
GOOD_SHARPNESS = float(os.getenv("GOOD_SHARPNESS", "60"))


def scan_with_preview() -> tuple[dict | None, str | None]:
    """Show live camera with focus indicator, capture on SPACE, OCR, return result."""
    import cv2
    from core.scanner import (
        _get_easyocr_reader,
        _passport_image_to_base64,
        _sharpness_score,
        reset_deskew_angle_cache,
        scan_passport_from_frame,
    )

    print("Loading EasyOCR models (first run can take ~30s)...", file=sys.stderr, flush=True)
    _get_easyocr_reader()

    cap = _open_camera()
    if cap is None:
        return None, "Could not open camera (check CAMERA_INDEX in .env)"

    # Try to disable webcam autofocus hunting (helps macro shots; ignored if unsupported)
    try:
        cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)  # let it auto-focus once...
        time.sleep(0.5)
    except Exception:
        pass

    reset_deskew_angle_cache("passport")
    print(
        "Ready. Hold passport in the green box and press SPACE to scan. Q/ESC = quit.",
        file=sys.stderr, flush=True,
    )

    window_name = "Passport Scanner — SPACE to capture | Q/ESC to quit"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    status_text = ""
    status_color = (255, 255, 255)
    last_message_until = 0.0  # show transient error/info messages briefly

    try:
        while not _shutdown:
            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            display = frame.copy()
            h, w = display.shape[:2]

            # --- live sharpness on center region (visual hint only) ---
            sharpness = _sharpness_score(frame, use_center_region=True)
            if sharpness >= GOOD_SHARPNESS:
                focus_color = (0, 255, 0)         # green = sharp
                focus_label = "FOCUS: GOOD"
            elif sharpness >= GOOD_SHARPNESS * 0.5:
                focus_color = (0, 200, 255)       # yellow = marginal
                focus_label = "FOCUS: BORDERLINE"
            else:
                focus_color = (0, 0, 255)         # red = blurry
                focus_label = "FOCUS: BLURRY (try better lighting / hold farther)"

            # Centered passport-aspect guide box
            box_w = int(w * 0.7)
            box_h = int(box_w / 1.55)
            x1 = (w - box_w) // 2
            y1 = (h - box_h) // 2
            cv2.rectangle(display, (x1, y1), (x1 + box_w, y1 + box_h), focus_color, 3)

            # Focus bar (top-right): width scales with sharpness up to 4× threshold
            bar_max = GOOD_SHARPNESS * 4
            fill = max(0.0, min(1.0, sharpness / bar_max))
            bar_x, bar_y, bar_w, bar_h = w - 320, 20, 300, 22
            cv2.rectangle(display, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (60, 60, 60), -1)
            cv2.rectangle(display, (bar_x, bar_y),
                          (bar_x + int(bar_w * fill), bar_y + bar_h), focus_color, -1)
            cv2.putText(display, f"sharpness {sharpness:.0f}", (bar_x, bar_y - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

            # Top-left status
            cv2.putText(display, focus_label, (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, focus_color, 2, cv2.LINE_AA)
            if status_text and time.time() < last_message_until:
                cv2.putText(display, status_text, (20, 80),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, status_color, 2, cv2.LINE_AA)
            cv2.putText(display, "SPACE = scan   |   Q/ESC = quit", (20, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)

            cv2.imshow(window_name, display)
            key = cv2.waitKey(1) & 0xFF

            if key in (ord('q'), ord('Q'), 27):
                return None, "Cancelled by user"

            if key == 32:  # SPACE — always run OCR, regardless of sharpness
                print(f"  SPACE pressed (sharpness={sharpness:.0f}) — scanning...",
                      file=sys.stderr, flush=True)

                # Show "Scanning..." overlay for one frame so user gets feedback
                status_text = "Scanning..."
                status_color = (0, 200, 255)
                last_message_until = time.time() + 2.0
                cv2.imshow(window_name, display)
                cv2.waitKey(1)

                try:
                    result = scan_passport_from_frame(frame, frame_index=1, require_detection=True)
                except Exception as e:
                    print(f"  OCR error: {e}", file=sys.stderr, flush=True)
                    status_text = f"OCR error: {e}"
                    status_color = (0, 0, 255)
                    last_message_until = time.time() + 3.0
                    continue

                if result is None or not (result.get("passport_id") or result.get("guest_name")):
                    hint = " (frame is blurry, try improving focus)" if sharpness < GOOD_SHARPNESS else ""
                    print(f"  No MRZ detected{hint}", file=sys.stderr, flush=True)
                    status_text = "No MRZ detected — try again" + hint
                    status_color = (0, 0, 255)
                    last_message_until = time.time() + 3.0
                    continue

                deskewed = result.get("deskewed_image")
                saved = _save_crop(deskewed, SAVE_PATH)
                b64 = _passport_image_to_base64(deskewed) if deskewed is not None else ""

                return {
                    "passport_id":           result.get("passport_id") or "",
                    "guest_name":            result.get("guest_name") or "",
                    "passport_image_base64": b64,
                    "saved_crop_path":       str(saved) if saved else "",
                }, None
    finally:
        try:
            cap.release()
            cv2.destroyAllWindows()
        except Exception:
            pass

    return None, "Cancelled"


# ---------------------------------------------------------------------------
# Auto poll mode (--auto) — no window
# ---------------------------------------------------------------------------
def scan_auto(timeout: float = 120.0) -> tuple[dict | None, str | None]:
    from core.scanner import (
        _get_easyocr_reader,
        _passport_image_to_base64,
        _sharpness_score,
        reset_deskew_angle_cache,
        scan_passport_from_frame,
    )

    print("Loading EasyOCR models...", file=sys.stderr, flush=True)
    _get_easyocr_reader()

    cap = _open_camera()
    if cap is None:
        return None, "Could not open camera"

    reset_deskew_angle_cache("passport")
    print(f"Scanning for up to {timeout:.0f}s. Hold passport in front of camera...",
          file=sys.stderr, flush=True)

    start, attempt, no_mrz = time.time(), 0, 0
    try:
        while not _shutdown:
            elapsed = time.time() - start
            if elapsed > timeout:
                return None, f"Timeout after {timeout:.0f}s"

            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.2)
                continue

            if _sharpness_score(frame, use_center_region=True) < SHARPNESS_THRESHOLD:
                time.sleep(0.1)
                continue

            try:
                result = scan_passport_from_frame(frame, frame_index=attempt + 1, require_detection=True)
            except Exception:
                attempt += 1
                continue

            if result is None:
                no_mrz += 1
                if no_mrz % 10 == 1:
                    print(f"  ...waiting for passport ({elapsed:.0f}s elapsed)",
                          file=sys.stderr, flush=True)
                continue

            attempt += 1
            if result.get("passport_id") or result.get("guest_name"):
                deskewed = result.get("deskewed_image")
                saved = _save_crop(deskewed, SAVE_PATH)
                b64 = _passport_image_to_base64(deskewed) if deskewed is not None else ""
                return {
                    "passport_id":           result.get("passport_id") or "",
                    "guest_name":            result.get("guest_name") or "",
                    "passport_image_base64": b64,
                    "saved_crop_path":       str(saved) if saved else "",
                }, None
    finally:
        try:
            cap.release()
        except Exception:
            pass

    return None, "Cancelled"


# ---------------------------------------------------------------------------
# Static image mode — useful for testing
# ---------------------------------------------------------------------------
def scan_image(image_path: str) -> tuple[dict | None, str | None]:
    import cv2
    import numpy as np
    from core.scanner import scan_passport_from_frames

    path = Path(image_path).resolve()
    if not path.exists():
        return None, f"File not found: {path}"

    img = cv2.imread(str(path))
    if img is None:
        buf = path.read_bytes()
        arr = np.frombuffer(buf, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None, "Could not decode image"

    passport_w, passport_h = 1040, 640
    margin = 20
    frame_w, frame_h = passport_w + margin, passport_h + margin
    h, w = img.shape[:2]
    if (w, h) != (frame_w, frame_h):
        img = cv2.resize(img, (frame_w, frame_h), interpolation=cv2.INTER_AREA)

    result = scan_passport_from_frames([img.copy() for _ in range(2)])
    if not result:
        return None, "No passport detected"

    return {
        "passport_id":           result.get("passport_id") or "",
        "guest_name":            result.get("guest_name") or "",
        "passport_image_base64": result.get("passport_image_base64") or "",
        "saved_crop_path":       "",
    }, None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    signal.signal(signal.SIGTERM, _sigterm_handler)
    signal.signal(signal.SIGINT,  _sigterm_handler)

    parser = argparse.ArgumentParser(description="Passport scanner — live preview, SPACE to capture")
    parser.add_argument("image",     nargs="?", help="Optional path to a static image (skips the camera)")
    parser.add_argument("--auto",    action="store_true",
                        help="No preview window — automatic polling until a passport is detected")
    parser.add_argument("--timeout", type=float, default=120.0,
                        help="Auto-mode timeout in seconds (default: 120)")
    parser.add_argument("--json",    action="store_true",
                        help="Also dump the full JSON result (including base64 image) at the end")
    args = parser.parse_args()

    try:
        if args.image:
            result, err = scan_image(args.image)
        elif args.auto:
            result, err = scan_auto(timeout=args.timeout)
        else:
            result, err = scan_with_preview()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)

    if not result:
        print(f"\n{err or 'No passport detected'}")
        sys.exit(1)

    saved = Path(result["saved_crop_path"]) if result.get("saved_crop_path") else None
    _print_result(
        passport_id=result.get("passport_id", ""),
        guest_name=result.get("guest_name", ""),
        saved_path=saved,
        dump_json=args.json,
        full_result=result,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
