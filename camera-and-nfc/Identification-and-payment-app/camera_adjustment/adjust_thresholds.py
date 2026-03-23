#!/usr/bin/env python3
"""
Interactive camera tuning — **alignment crop + detection master + frame sharp gate**.

Sliders follow ``.env.example`` (same order as the real pipeline):

**Alignment crop** (passport): gamma → brightness → contrast → saturation → denoise → pre-unsharp,
then this tool shows the **detection master** (grayscale + SCAN_CLAHE_MASTER_CLIP).

**Deskew / detection:** ``SCAN_CLAHE_MASTER_CLIP``

**Polling (blur reject):** ``SHARPNESS_THRESHOLD``

Does not write ``.env``; on **q** quit, a copy-paste block is printed. For the v1–v6 variant
grid, use ``adjust_variants.py``.

Usage::

    cd camera-and-nfc/Identification-and-payment-app
    python camera_adjustment/adjust_thresholds.py

Keys: **c** capture, **q** quit (prints ``.env`` snippet).
"""

import os
import sys
from typing import Optional

import cv2
import numpy as np

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# Try to import crop and gamma helpers so the tuning matches the real scanner.
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT))  # camera_adjustment/
APP_ROOT = os.path.dirname(PROJECT_ROOT)  # Identification-and-payment-app
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from camera_adjustment._tuner_preproc import (
    apply_contrast_linear,
    apply_denoise_bilateral,
    apply_saturation_hsv,
    apply_sharpen_unsharp,
)
from camera_adjustment._tuner_trackbars import (
    TB_BRIGHT,
    TB_CONTRAST,
    TB_DENOISE,
    TB_GAMMA,
    TB_MST_CLAHE,
    TB_PRE_SHARP,
    TB_SAT,
    TB_SHRP_THR,
)

_HAS_SCANNER_HELPERS = False
try:
    from core.scanner import (  # type: ignore[attr-defined]
        _get_camera_index,
        _crop_passport_alignment_region,
        _gamma_correct,
        CAMERA_WIDTH,
        CAMERA_HEIGHT,
    )
    _HAS_SCANNER_HELPERS = True
except Exception:
    # Fallbacks if scanner internals cannot be imported for any reason.
    CAMERA_WIDTH = 1920
    CAMERA_HEIGHT = 1080

    def _get_camera_index() -> int:
        try:
            return int(os.getenv("CAMERA_INDEX", "0").strip())
        except ValueError:
            return 0

    def _crop_passport_alignment_region(frame: "np.ndarray") -> "np.ndarray":  # type: ignore[name-defined]
        h, w = frame.shape[:2]
        rect_w = min(1040, w - 20)
        rect_h = min(640, h - 20)
        x1 = (w - rect_w) // 2
        y1 = (h - rect_h) // 2
        return frame[y1 : y1 + rect_h, x1 : x1 + rect_w]

    def _gamma_correct(image: "np.ndarray", gamma: float = 1.0) -> "np.ndarray":  # type: ignore[name-defined]
        if image is None or image.size == 0 or abs(gamma - 1.0) < 0.01:
            return image
        inv_gamma = 1.0 / max(gamma, 0.01)
        lut = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)], dtype=np.uint8)
        return cv2.LUT(image, lut)


def _load_env_defaults() -> tuple[float, float, int, int, int, int, int, int]:
    """Read SCAN_GAMMA, master CLAHE, frame sharpness threshold, tuner preproc defaults from .env."""
    if load_dotenv is not None:
        env_path = os.path.join(APP_ROOT, ".env")
        if os.path.isfile(env_path):
            try:
                load_dotenv(env_path)
            except Exception:
                pass

    gamma_env = os.getenv("SCAN_GAMMA", "0.7").strip()
    try:
        gamma_default = float(gamma_env)
    except ValueError:
        gamma_default = 0.7

    master_clahe_env = os.getenv("SCAN_CLAHE_MASTER_CLIP", "3.0").strip()
    try:
        master_clahe_default = float(master_clahe_env)
    except ValueError:
        master_clahe_default = 3.0

    sharp_env = os.getenv("SHARPNESS_THRESHOLD", "15").strip()
    try:
        sharp_default = int(float(sharp_env))
    except ValueError:
        sharp_default = 15

    # Same keys as core/scanner.py (first non-empty wins).
    bright_env = (
        os.getenv("SCAN_GLOBAL_BRIGHTNESS")
        or os.getenv("SCAN_BRIGHTNESS")
        or os.getenv("ADJUST_BRIGHTNESS", "125")
    ).strip()
    try:
        brightness_default = int(float(bright_env))
    except ValueError:
        brightness_default = 128
    brightness_default = max(0, min(255, brightness_default))

    try:
        denoise_default = int(
            float((os.getenv("SCAN_PRE_DENOISE") or os.getenv("SCAN_DENOISE") or os.getenv("ADJUST_DENOISE", "0")).strip())
        )
    except ValueError:
        denoise_default = 0
    denoise_default = max(0, min(50, denoise_default))

    try:
        sharpen_default = int(float((os.getenv("SCAN_PRE_SHARPNESS") or os.getenv("SCAN_PREPROCESS_SHARPNESS", "50")).strip()))
    except ValueError:
        sharpen_default = 50
    sharpen_default = max(0, min(100, sharpen_default))

    try:
        contrast_default = int(
            float(
                (
                    os.getenv("SCAN_GLOBAL_CONTRAST")
                    or os.getenv("SCAN_CONTRAST")
                    or os.getenv("ADJUST_CONTRAST", "160")
                ).strip()
            )
        )
    except ValueError:
        contrast_default = 160
    contrast_default = max(50, min(200, contrast_default))

    try:
        saturation_default = int(
            float(
                (os.getenv("SCAN_PRE_SATURATION") or os.getenv("SCAN_SATURATION") or os.getenv("ADJUST_SATURATION", "100")).strip()
            )
        )
    except ValueError:
        saturation_default = 100
    saturation_default = max(0, min(200, saturation_default))

    return (
        gamma_default,
        master_clahe_default,
        sharp_default,
        brightness_default,
        denoise_default,
        sharpen_default,
        contrast_default,
        saturation_default,
    )


def _open_camera() -> Optional["cv2.VideoCapture"]:
    """Open the same camera index as the scanner, with DSHOW on Windows."""
    cam_idx = _get_camera_index()
    api = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(cam_idx, api)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(cam_idx)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
    return cap


def _build_clahe(clip_limit: float) -> "cv2.CLAHE":
    clip = max(0.5, min(8.0, float(clip_limit)))
    return cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))


def _print_threshold_env_snippet(
    *,
    gamma: float,
    brightness_pos: int,
    contrast: int,
    saturation: int,
    denoise: int,
    pre_sharp: int,
    master_clahe: float,
    sharp_thresh: int,
) -> None:
    print("\n# --- Paste into .env (.env.example order: alignment → master → poll) ---")
    print(f"SCAN_GAMMA={gamma:.2f}")
    print(f"SCAN_BRIGHTNESS={int(brightness_pos)}")
    print(f"SCAN_CONTRAST={int(contrast)}")
    print(f"SCAN_PRE_SATURATION={int(saturation)}")
    print(f"SCAN_PRE_DENOISE={int(denoise)}")
    print(f"SCAN_PRE_SHARPNESS={int(pre_sharp)}")
    print(f"SCAN_CLAHE_MASTER_CLIP={master_clahe:.2f}")
    print(f"SHARPNESS_THRESHOLD={int(sharp_thresh)}")
    print("# ---------------------------------------------------------------------------\n")


def main() -> None:
    (
        gamma_default,
        master_clahe_default,
        sharp_default,
        brightness_default,
        denoise_default,
        sharpen_default,
        contrast_default,
        saturation_default,
    ) = _load_env_defaults()

    cap = _open_camera()
    if cap is None:
        print("ERROR: Could not open camera. Check CAMERA_INDEX and USB connection.", file=sys.stderr)
        return

    print(
        "Sliders 01–06 = alignment crop (.env order); 07 = SCAN_CLAHE_MASTER_CLIP; "
        "08 = SHARPNESS_THRESHOLD.  c=capture  q=quit+print .env block."
    )
    last_frame: Optional["np.ndarray"] = None  # type: ignore[name-defined]

    window_name = "Thresholds: L=crop R=master CLAHE"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    gamma_slider_min, gamma_slider_max = 50, 200  # 0.5–2.0
    gamma_default_pos = int(round(gamma_default * 100))
    gamma_default_pos = max(gamma_slider_min, min(gamma_slider_max, gamma_default_pos))

    brightness_slider_max = 255
    brightness_default_pos = max(0, min(brightness_slider_max, brightness_default))

    contrast_slider_max = 200
    contrast_default_pos = max(50, min(contrast_slider_max, contrast_default))

    saturation_slider_max = 200
    saturation_default_pos = max(0, min(saturation_slider_max, saturation_default))

    denoise_slider_max = 50
    denoise_default_pos = max(0, min(denoise_slider_max, denoise_default))

    pre_sharp_slider_max = 100
    pre_sharp_default_pos = max(0, min(pre_sharp_slider_max, sharpen_default))

    master_clahe_slider_max = 300  # position/100 → clip
    master_clahe_default_pos = int(round(master_clahe_default * 100))
    master_clahe_default_pos = max(50, min(master_clahe_slider_max, master_clahe_default_pos))

    sharp_thresh_slider_max = 300
    sharp_thresh_default_pos = max(1, min(sharp_thresh_slider_max, int(sharp_default)))

    def _on_trackbar(_val: int) -> None:
        if last_frame is None:
            return
        gamma_pos = cv2.getTrackbarPos(TB_GAMMA, window_name)
        bright_pos = cv2.getTrackbarPos(TB_BRIGHT, window_name)
        contrast_pos = cv2.getTrackbarPos(TB_CONTRAST, window_name)
        saturation_pos = cv2.getTrackbarPos(TB_SAT, window_name)
        denoise_pos = cv2.getTrackbarPos(TB_DENOISE, window_name)
        pre_sharp_pos = cv2.getTrackbarPos(TB_PRE_SHARP, window_name)
        master_clahe_pos = cv2.getTrackbarPos(TB_MST_CLAHE, window_name)
        sharp_thr_pos = cv2.getTrackbarPos(TB_SHRP_THR, window_name)

        gamma = max(0.1, gamma_pos / 100.0)
        master_clahe_clip = max(0.5, master_clahe_pos / 100.0)
        beta = float(int(bright_pos) - 128)
        dn = int(denoise_pos)
        pre_sh = int(pre_sharp_pos)
        cx = max(50, min(200, int(contrast_pos)))
        sx = max(0, min(200, int(saturation_pos)))
        sthr = max(1, min(sharp_thresh_slider_max, int(sharp_thr_pos)))

        crop = _crop_passport_alignment_region(last_frame)
        proc = _gamma_correct(crop, gamma)
        if abs(beta) > 0.01:
            proc = cv2.convertScaleAbs(proc, alpha=1.0, beta=beta)
        proc = apply_contrast_linear(proc, cx)
        proc = apply_saturation_hsv(proc, sx)
        proc = apply_denoise_bilateral(proc, dn)
        proc = apply_sharpen_unsharp(proc, pre_sh)
        gray = cv2.cvtColor(proc, cv2.COLOR_BGR2GRAY)
        clahe = _build_clahe(master_clahe_clip)
        proc_vis = clahe.apply(gray)

        try:
            left = crop
            right = cv2.cvtColor(proc_vis, cv2.COLOR_GRAY2BGR)
        except Exception:
            left = crop
            right = crop

        combined = np.hstack([left, right])
        cv2.imshow(window_name, combined)

        sys.stdout.write(
            f"\rSCAN_GAMMA={gamma:.2f}  BRIGHT={int(bright_pos)}  CONTRAST={cx}  SAT={sx}  "
            f"DENOISE={dn}  PRE_SHARP={pre_sh}  MST_CLAHE={master_clahe_clip:.2f}  "
            f"SHRP_THR={sthr}   "
        )
        sys.stdout.flush()

    cv2.createTrackbar(TB_GAMMA, window_name, gamma_default_pos, gamma_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_BRIGHT, window_name, brightness_default_pos, brightness_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_CONTRAST, window_name, contrast_default_pos, contrast_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_SAT, window_name, saturation_default_pos, saturation_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_DENOISE, window_name, denoise_default_pos, denoise_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_PRE_SHARP, window_name, pre_sharp_default_pos, pre_sharp_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_MST_CLAHE, window_name, master_clahe_default_pos, master_clahe_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_SHRP_THR, window_name, sharp_thresh_default_pos, sharp_thresh_slider_max, _on_trackbar)

    # Initial capture so sliders immediately show something if desired.
    ret, frame = cap.read()
    if ret and frame is not None:
        last_frame = frame.copy()
        _on_trackbar(0)

    while True:
        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            if last_frame is not None:
                gp = cv2.getTrackbarPos(TB_GAMMA, window_name)
                gamma_q = max(0.1, gp / 100.0)
                bright_q = cv2.getTrackbarPos(TB_BRIGHT, window_name)
                cx_q = max(50, min(200, cv2.getTrackbarPos(TB_CONTRAST, window_name)))
                sx_q = max(0, min(200, cv2.getTrackbarPos(TB_SAT, window_name)))
                dn_q = cv2.getTrackbarPos(TB_DENOISE, window_name)
                pre_q = cv2.getTrackbarPos(TB_PRE_SHARP, window_name)
                mc_q = max(0.5, cv2.getTrackbarPos(TB_MST_CLAHE, window_name) / 100.0)
                st_q = max(1, min(sharp_thresh_slider_max, cv2.getTrackbarPos(TB_SHRP_THR, window_name)))
                _print_threshold_env_snippet(
                    gamma=gamma_q,
                    brightness_pos=int(bright_q),
                    contrast=int(cx_q),
                    saturation=int(sx_q),
                    denoise=int(dn_q),
                    pre_sharp=int(pre_q),
                    master_clahe=float(mc_q),
                    sharp_thresh=int(st_q),
                )
            break
        if key == ord("c"):
            # Capture a fresh frame from camera.
            for _ in range(3):
                cap.read()
            ret, frame = cap.read()
            if not ret or frame is None:
                print("\nWARN: Could not read frame from camera.", file=sys.stderr)
                continue
            last_frame = frame.copy()
            _on_trackbar(0)

    print()  # newline after last printed slider values
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

