"""Run the passport scan pipeline using a JPG/PNG or a live camera grab.

**Resolution:** Frames are passed through at **native pixel size** (no resize to 1060×660).
The scanner applies the same steps as production: center alignment crop **1040×640** from each
frame inside ``scan_passport_from_frames`` (unless ``SCAN_FULL_FRAME=1`` in ``.env``).

Use a full camera frame (e.g. 1920×1080) so the alignment crop keeps maximum detail on the MRZ.

Capture mode (--capture): SPACE saves ``test_images/last_capture.png`` (raw frame) then runs the pipeline.

Usage:
  python run_test_image.py
  python run_test_image.py [path_to_image.jpg]
  python run_test_image.py --capture
"""

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

_PROJECT_ROOT = Path(__file__).resolve().parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(_PROJECT_ROOT / ".env")

import cv2
from core.scanner import (
    CAMERA_HEIGHT,
    CAMERA_WIDTH,
    HAS_OPENCV,
    _OCR_TIMING,
    _capture_fresh_frame,
    _esp32_flash_off,
    _esp32_guide_off,
    _esp32_guide_on,
    _esp32_prepare_passport_flash,
    _esp32_passport_flash_enabled,
    _open_camera,
    scan_passport_from_frames,
)

if _OCR_TIMING:
    logging.basicConfig(level=logging.INFO)

_PASSPORT_TEST_CANDIDATES = [
    _PROJECT_ROOT / "test_images" / "test.jpg",
    _PROJECT_ROOT / "test_images" / "test.png",
]
_LAST_CAPTURE_PATH = _PROJECT_ROOT / "test_images" / "last_capture.png"


def _pick_default_passport_image():
    for p in _PASSPORT_TEST_CANDIDATES:
        if p.exists():
            return p
    return _PASSPORT_TEST_CANDIDATES[0]


TEST_IMAGES = [
    (_pick_default_passport_image(), "Passport"),
]
# Mirror passport camera flow: one selected frame enters MRZ OCR.
NUM_FRAMES = 1
# If a single side exceeds this, downscale with INTER_AREA first (memory / speed). Does not affect normal 1080p.
_MAX_PASSPORT_INPUT_EDGE = 3200
def _capture_frame_from_camera() -> Tuple[Optional[np.ndarray], Optional[str]]:
    if not HAS_OPENCV:
        return None, "OpenCV not available"
    cap, _idx = _open_camera()
    if cap is None:
        return None, "Could not open camera (check CAMERA_INDEX in .env)"
    try:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
    except Exception:
        pass
    window = "Capture — SPACE: grab frame | Q: quit"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    print("\n--- Camera capture ---")
    print("Preprocessing is controlled by .env (see .env.example). Align document, SPACE to capture, Q to quit.\n")
    last_ok: Optional[np.ndarray] = None
    _esp32_guide_on()
    try:
        while True:
            ok, frame = cap.read()
            if ok and frame is not None:
                last_ok = frame
                cv2.imshow(window, frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord(" ") and last_ok is not None:
                if _esp32_passport_flash_enabled():
                    _esp32_prepare_passport_flash()
                    fresh = _capture_fresh_frame(cap, discard_frames=3, interval_ms=30)
                    shot = fresh if fresh is not None else last_ok.copy()
                else:
                    shot = last_ok.copy()
                try:
                    _LAST_CAPTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(_LAST_CAPTURE_PATH), shot)
                    print(f"Saved raw frame to {_LAST_CAPTURE_PATH}\n")
                except Exception as e:
                    print(f"(Could not save last_capture.png: {e})\n")
                return shot, None
            if key in (ord("q"), ord("Q")):
                return None, "Capture cancelled"
    finally:
        try:
            cap.release()
        except Exception:
            pass
        _esp32_flash_off()
        _esp32_guide_off()
        try:
            cv2.destroyWindow(window)
        except Exception:
            cv2.destroyAllWindows()


def load_image(path: Path):
    path = Path(path).resolve()
    if not path.exists():
        return None, f"File not found: {path}"
    try:
        img = cv2.imread(str(path))
    except Exception:
        img = None
    if img is None:
        try:
            buf = path.read_bytes()
            arr = np.frombuffer(buf, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception as e:
            return None, str(e)
    if img is None or img.size == 0:
        return None, "Could not decode image (is it a valid JPG/PNG?)."
    return img, None


def _clamp_large_input(img: np.ndarray) -> np.ndarray:
    """Only shrink enormous inputs; keep 1080p/4K webcams at full resolution."""
    h, w = img.shape[:2]
    m = max(h, w)
    if m <= _MAX_PASSPORT_INPUT_EDGE:
        return img
    scale = _MAX_PASSPORT_INPUT_EDGE / float(m)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)


def run_pipeline_for_image(path: Path, label: str):
    print("Loading image:", path)
    img, err = load_image(path)
    if err:
        print("Error:", err)
        return False
    return _run_pipeline_for_bgr(img, label)


def _run_pipeline_for_bgr(img: np.ndarray, label: str) -> bool:
    del label  # same path for default test image, CLI path, and --capture
    img_p = _clamp_large_input(img)
    h, w = img_p.shape[:2]
    print(
        f"Passport pipeline input: {w}×{h} px ({NUM_FRAMES} identical frame(s)). "
        "Scanner applies center crop 1040×640 unless SCAN_FULL_FRAME=1.\n"
    )
    print("--- Passport pipeline ---")
    passport_frames = [img_p.copy() for _ in range(NUM_FRAMES)]
    passport_data = scan_passport_from_frames(passport_frames)
    if passport_data:
        print("Passport ID:", passport_data.get("passport_id"))
        print("Guest name:", passport_data.get("guest_name"))
    else:
        print("Passport: no result (image may not contain a passport MRZ or crop failed).")
    return True


def main():
    ap = argparse.ArgumentParser(description="Run the passport OCR pipeline on test images or camera capture.")
    ap.add_argument("--capture", "-c", "--camera", action="store_true", help="Grab one frame from camera (SPACE) then run the passport pipeline")
    ap.add_argument("image", nargs="?", default=None, help="Image path (runs the passport pipeline at the correct size)")
    args = ap.parse_args()

    if args.capture:
        shot, err = _capture_frame_from_camera()
        if err:
            print(err)
            sys.exit(1)
        print("[Camera capture] Running passport pipeline only (preprocessing from .env).\n")
        if not _run_pipeline_for_bgr(shot, "Custom"):
            sys.exit(1)
        print("\nDebug outputs: debug/variants/passport/")
        return

    if args.image:
        paths_to_run = [(Path(args.image).resolve(), "Custom")]
    else:
        paths_to_run = TEST_IMAGES

    ran_any = False
    for i, (path, label) in enumerate(paths_to_run):
        if i > 0:
            print("\n" + "=" * 60)
        print(f"[{label}] {path.name}")
        if run_pipeline_for_image(path, label):
            ran_any = True

    if not ran_any:
        print("No image could be loaded.")
        print("Add test images or run: python run_test_image.py <image.jpg> or python run_test_image.py --capture")
        sys.exit(1)

    print("\nDebug outputs: debug/variants/passport/")


if __name__ == "__main__":
    main()
