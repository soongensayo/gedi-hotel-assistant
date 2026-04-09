#!/usr/bin/env python3
"""
Variant grid tuner — **alignment crop (.env order) + variant OCR stack** (matches ``_build_six_variants``).

**Sliders** follow ``.env.example``:

1. **01–06** — Same alignment chain as the scanner: gamma → brightness → contrast → saturation →
   denoise → **SCAN_PRE_SHARPNESS** (pre-deskew unsharp on the crop).
2. **07–10** — Variant OCR: ``SCAN_CLAHE_CLIP``, ``SCAN_VARIANT_SHARPNESS``,
   ``SCAN_VARIANT_SECOND_SHARPNESS``, ``OCR_USE_V3_BASE``.

``SCAN_CLAHE_MASTER_CLIP`` and ``SHARPNESS_THRESHOLD`` are **not** here; use ``adjust_thresholds.py``.

Grid (2×3): v1_orig | v2_sharp | v3_clean_sharp / v4_gray | v5_lab_clahe | v6_lab_clahe

Usage::

    cd camera-and-nfc/Identification-and-payment-app
    python camera_adjustment/adjust_variants.py

Keys: **c** capture, **q** quit (prints ``.env`` lines for alignment + variant block).
"""

import os
import sys
from typing import Optional, List, Tuple

import cv2
import numpy as np

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))  # camera_adjustment/
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
    TB_PRE_SHARP,
    TB_SAT,
    TB_VAR_2SHRP,
    TB_VAR_CLAHE,
    TB_VAR_SHARP,
    TB_V3_BASE,
)

from core.scanner import (  # type: ignore[attr-defined]
    _crop_passport_alignment_region,
    _gamma_correct,
    _get_camera_index,
    _unsharp_median_for_ocr,
    CAMERA_HEIGHT,
    CAMERA_WIDTH,
)


def _load_env() -> Tuple[float, float, bool, int, int, int, int, int, int, int]:
    """Load defaults from .env: gamma, variant CLAHE, v3 flag, alignment ints, pre-sharp, variant sharpness."""
    if load_dotenv is not None:
        env_path = os.path.join(APP_ROOT, ".env")
        if os.path.isfile(env_path):
            try:
                load_dotenv(env_path)
            except Exception:
                pass

    def _f(name: str, default: str) -> float:
        try:
            return float(os.getenv(name, default).strip())
        except Exception:
            return float(default)

    gamma = _f("SCAN_GAMMA", "0.7")
    variant_clahe = _f("SCAN_CLAHE_CLIP", "2.5")
    use_v3 = (os.getenv("OCR_USE_V3_BASE", "0").strip().lower() in ("1", "true", "yes"))
    try:
        bdef = int(
            float(
                (
                    os.getenv("SCAN_GLOBAL_BRIGHTNESS")
                    or os.getenv("SCAN_BRIGHTNESS")
                    or os.getenv("ADJUST_BRIGHTNESS", "125")
                ).strip()
            )
        )
    except Exception:
        bdef = 125
    bdef = max(0, min(255, bdef))
    try:
        ddef = int(
            float((os.getenv("SCAN_PRE_DENOISE") or os.getenv("SCAN_DENOISE") or os.getenv("ADJUST_DENOISE", "0")).strip())
        )
    except Exception:
        ddef = 0
    ddef = max(0, min(50, ddef))
    try:
        predef = int(
            float(
                (os.getenv("SCAN_PRE_SHARPNESS") or os.getenv("SCAN_PREPROCESS_SHARPNESS", "50")).strip()
            )
        )
    except Exception:
        predef = 50
    predef = max(0, min(100, predef))
    try:
        sdef = int(
            float(
                (
                    os.getenv("SCAN_VARIANT_SHARPNESS")
                    or os.getenv("SCAN_SHARPNESS_VARIANT")
                    or os.getenv("ADJUST_SHARPNESS", "50")
                ).strip()
            )
        )
    except Exception:
        sdef = 50
    sdef = max(0, min(125, sdef))
    try:
        cdef = int(
            float(
                (
                    os.getenv("SCAN_GLOBAL_CONTRAST")
                    or os.getenv("SCAN_CONTRAST")
                    or os.getenv("ADJUST_CONTRAST", "160")
                ).strip()
            )
        )
    except Exception:
        cdef = 160
    cdef = max(50, min(200, cdef))
    try:
        satdef = int(
            float(
                (os.getenv("SCAN_PRE_SATURATION") or os.getenv("SCAN_SATURATION") or os.getenv("ADJUST_SATURATION", "100")).strip()
            )
        )
    except Exception:
        satdef = 100
    satdef = max(0, min(200, satdef))
    try:
        s2def = int(
            float(
                (
                    os.getenv("SCAN_VARIANT_SECOND_SHARPNESS")
                    or os.getenv("SCAN_VARIANT_EXTRA_SHARPNESS", "0")
                ).strip()
            )
        )
    except Exception:
        s2def = 0
    s2def = max(0, min(125, s2def))
    return gamma, variant_clahe, use_v3, bdef, ddef, predef, sdef, cdef, satdef, s2def


def _open_camera() -> Optional["cv2.VideoCapture"]:
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


def _clahe_lab_bgr_clip(
    image: "np.ndarray",  # type: ignore[name-defined]
    clip_limit: float,
    *,
    color_only: bool = False,
) -> "np.ndarray":  # type: ignore[name-defined]
    """LAB colorspace: CLAHE on L only; mirrors ``scanner._clahe_lab_bgr`` (with explicit clip).

    ``color_only=True`` (v6): BGR→LAB→CLAHE→BGR only; no GRAY2BGR (requires 3+ BGR channels).
    """
    if image is None or image.size == 0:  # type: ignore[attr-defined]
        return image
    img = image.copy()
    if color_only:
        if img.ndim != 3 or img.shape[2] < 3:
            return img
        if img.shape[2] > 3:
            img = img[:, :, :3]
    elif img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    try:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        clahe_obj = cv2.createCLAHE(clipLimit=max(0.1, float(clip_limit)), tileGridSize=(8, 8))
        l2 = clahe_obj.apply(l_ch)
        lab2 = cv2.merge([l2, a_ch, b_ch])
        return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)
    except Exception:
        return img


def _build_variants_for_tuner(
    roi: "np.ndarray",  # type: ignore[name-defined]
    use_v3_base: bool,
    clahe_clip: float,
    sharpen_amount: int,
    second_sharpen_amount: int = 0,
) -> List["np.ndarray"]:  # type: ignore[name-defined]
    """
    Local variant builder for the tuner UI (matches scanner v5/v6 LAB+CLAHE logic).

    ``sharpen_amount`` 0–125 drives unsharp on v2/v3 (125 = max ``_sharpen_for_ocr`` strength).
    ``second_sharpen_amount`` 0–125 applies ``_unsharp_median_for_ocr`` again on v2–v6 only
    (same as ``SCAN_VARIANT_SECOND_SHARPNESS`` in production).

    Returns 6 images: v1..v3, v4_gray, v5_lab_clahe (gray→BGR→LAB), v6 (v2/v3 BGR sharp→LAB only, no gray).
    """
    if roi is None or roi.size == 0:  # type: ignore[attr-defined]
        return []

    v1_orig = roi.copy()
    v2_sharp = apply_sharpen_unsharp(v1_orig.copy(), sharpen_amount)
    v3_clean_sharp = apply_sharpen_unsharp(cv2.medianBlur(v1_orig.copy(), 3), sharpen_amount)

    base_for_gray = v3_clean_sharp if use_v3_base else v2_sharp
    try:
        v4_gray = cv2.cvtColor(base_for_gray, cv2.COLOR_BGR2GRAY) if base_for_gray.ndim == 3 else base_for_gray.copy()
    except Exception:
        v4_gray = base_for_gray.copy()

    try:
        gray_as_bgr = cv2.cvtColor(v4_gray.copy(), cv2.COLOR_GRAY2BGR)
        v5_lab_clahe = _clahe_lab_bgr_clip(gray_as_bgr, clahe_clip)
    except Exception:
        v5_lab_clahe = cv2.cvtColor(v4_gray.copy(), cv2.COLOR_GRAY2BGR)
    try:
        v6_lab_clahe = _clahe_lab_bgr_clip(
            base_for_gray.copy(), clahe_clip, color_only=True
        )
    except Exception:
        v6_lab_clahe = base_for_gray.copy()

    out = [v1_orig, v2_sharp, v3_clean_sharp, v4_gray, v5_lab_clahe, v6_lab_clahe]
    if second_sharpen_amount > 0:
        for i in range(1, len(out)):
            out[i] = _unsharp_median_for_ocr(out[i].copy(), second_sharpen_amount)
    return out


def _print_variant_env_snippet(
    *,
    gamma: float,
    brightness_pos: int,
    contrast: int,
    saturation: int,
    denoise: int,
    pre_sharp: int,
    variant_clahe: float,
    variant_sharp: int,
    second_variant_sharp: int,
    use_v3_base: bool,
) -> None:
    print("\n# --- Paste into .env: alignment crop (01–06) + variant OCR (07–10) ---")
    print(f"SCAN_GAMMA={gamma:.2f}")
    print(f"SCAN_BRIGHTNESS={int(brightness_pos)}")
    print(f"SCAN_CONTRAST={int(contrast)}")
    print(f"SCAN_PRE_SATURATION={int(saturation)}")
    print(f"SCAN_PRE_DENOISE={int(denoise)}")
    print(f"SCAN_PRE_SHARPNESS={int(pre_sharp)}")
    print(f"SCAN_CLAHE_CLIP={variant_clahe:.2f}")
    print(f"SCAN_VARIANT_SHARPNESS={int(variant_sharp)}")
    print(f"SCAN_VARIANT_SECOND_SHARPNESS={int(second_variant_sharp)}")
    print(f"OCR_USE_V3_BASE={1 if use_v3_base else 0}")
    print("# SCAN_CLAHE_MASTER_CLIP / SHARPNESS_THRESHOLD → adjust_thresholds.py")
    print("# ---------------------------------------------------------------------------\n")


def _render_grid(variants: List["np.ndarray"]) -> "np.ndarray":  # type: ignore[name-defined]
    """Arrange 6 variants into a 2×3 labeled grid."""
    labels = [
        "v1_orig",
        "v2_sharp",
        "v3_clean_sharp",
        "v4_gray",
        "v5_lab_clahe",
        "v6_lab_clahe",
    ]
    tiles: List["np.ndarray"] = []
    for img, lab in zip(variants, labels):
        if img.ndim == 2:
            tile = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        else:
            tile = img.copy()
        h, w = tile.shape[:2]
        cv2.rectangle(tile, (0, 0), (w - 1, h - 1), (0, 255, 0), 1)
        cv2.putText(
            tile,
            lab,
            (5, 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2,
        )
        tiles.append(tile)

    # Ensure all tiles have the same size
    h_min = min(t.shape[0] for t in tiles)
    w_min = min(t.shape[1] for t in tiles)
    tiles = [cv2.resize(t, (w_min, h_min), interpolation=cv2.INTER_AREA) for t in tiles]

    row1 = np.hstack(tiles[0:3])
    row2 = np.hstack(tiles[3:6])
    grid = np.vstack([row1, row2])
    return grid


def main() -> None:
    (
        gamma_default,
        variant_clahe_default,
        use_v3_default,
        brightness_default,
        denoise_default,
        pre_sharp_default,
        variant_sharp_default,
        contrast_default,
        saturation_default,
        second_sharp_default,
    ) = _load_env()

    cap = _open_camera()
    if cap is None:
        print("ERROR: Could not open camera. Check CAMERA_INDEX and USB connection.", file=sys.stderr)
        return

    print(
        "Sliders 01–06 = alignment (.env order); 07–10 = variant OCR.  "
        "c=capture  q=quit+print .env block."
    )
    window_name = "Variants: 01-06 align then 07-10 OCR"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    last_roi: Optional["np.ndarray"] = None  # type: ignore[name-defined]

    gamma_slider_min, gamma_slider_max = 50, 200  # 0.5–2.0
    gamma_default_pos = int(round(gamma_default * 100))
    gamma_default_pos = max(gamma_slider_min, min(gamma_slider_max, gamma_default_pos))

    var_clahe_min, var_clahe_max = 50, 300  # 0.5–3.0
    var_clahe_default_pos = int(round(variant_clahe_default * 100))
    var_clahe_default_pos = max(var_clahe_min, min(var_clahe_max, var_clahe_default_pos))

    use_v3_initial = 1 if use_v3_default else 0

    brightness_slider_max = 255
    brightness_default_pos = max(0, min(brightness_slider_max, brightness_default))

    contrast_slider_max = 200
    contrast_default_pos = max(50, min(contrast_slider_max, contrast_default))

    saturation_slider_max = 200
    saturation_default_pos = max(0, min(saturation_slider_max, saturation_default))

    denoise_slider_max = 50
    denoise_default_pos = max(0, min(denoise_slider_max, denoise_default))

    pre_sharp_slider_max = 100
    pre_sharp_default_pos = max(0, min(pre_sharp_slider_max, pre_sharp_default))

    variant_sharp_slider_max = 125
    variant_sharp_default_pos = max(0, min(variant_sharp_slider_max, variant_sharp_default))

    second_sharp_slider_max = 125
    second_sharp_default_pos = max(0, min(second_sharp_slider_max, second_sharp_default))

    def _on_trackbar(_val: int) -> None:
        if last_roi is None:
            return
        gamma_pos = cv2.getTrackbarPos(TB_GAMMA, window_name)
        bright_pos = cv2.getTrackbarPos(TB_BRIGHT, window_name)
        contrast_pos = cv2.getTrackbarPos(TB_CONTRAST, window_name)
        saturation_pos = cv2.getTrackbarPos(TB_SAT, window_name)
        denoise_pos = cv2.getTrackbarPos(TB_DENOISE, window_name)
        pre_sharp_pos = cv2.getTrackbarPos(TB_PRE_SHARP, window_name)
        var_pos = cv2.getTrackbarPos(TB_VAR_CLAHE, window_name)
        var_sharp_pos = cv2.getTrackbarPos(TB_VAR_SHARP, window_name)
        second_sharp_pos = cv2.getTrackbarPos(TB_VAR_2SHRP, window_name)
        use_v3 = cv2.getTrackbarPos(TB_V3_BASE, window_name)

        gamma_val = max(0.1, gamma_pos / 100.0)
        var_clip = max(0.5, var_pos / 100.0)
        use_v3_flag = bool(use_v3)
        beta = float(int(bright_pos) - 128)
        dn = int(denoise_pos)
        pre_sh = int(pre_sharp_pos)
        sh = int(var_sharp_pos)
        sh2 = int(second_sharp_pos)
        cx = max(50, min(200, int(contrast_pos)))
        sx = max(0, min(200, int(saturation_pos)))

        roi_proc = _gamma_correct(last_roi, gamma_val)
        if abs(beta) > 0.01:
            roi_proc = cv2.convertScaleAbs(roi_proc, alpha=1.0, beta=beta)
        roi_proc = apply_contrast_linear(roi_proc, cx)
        roi_proc = apply_saturation_hsv(roi_proc, sx)
        roi_proc = apply_denoise_bilateral(roi_proc, dn)
        roi_proc = apply_sharpen_unsharp(roi_proc, pre_sh)

        variants = _build_variants_for_tuner(
            roi_proc,
            use_v3_base=use_v3_flag,
            clahe_clip=var_clip,
            sharpen_amount=sh,
            second_sharpen_amount=sh2,
        )

        if not variants or len(variants) != 6:
            print("\nWARN: Could not build 6 variants from ROI.", file=sys.stderr)
            return

        grid = _render_grid(variants)
        cv2.imshow(window_name, grid)

        sys.stdout.write(
            f"\rGAMMA={gamma_val:.2f} BRIGHT={int(bright_pos)} CONTRAST={cx} SAT={sx} "
            f"DENOISE={dn} PRE_SHARP={pre_sh} | VAR_CLAHE={var_clip:.2f} VAR_SHARP={sh} "
            f"VAR_2SHRP={sh2} V3={int(use_v3_flag)}   "
        )
        sys.stdout.flush()

    cv2.createTrackbar(TB_GAMMA, window_name, gamma_default_pos, gamma_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_BRIGHT, window_name, brightness_default_pos, brightness_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_CONTRAST, window_name, contrast_default_pos, contrast_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_SAT, window_name, saturation_default_pos, saturation_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_DENOISE, window_name, denoise_default_pos, denoise_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_PRE_SHARP, window_name, pre_sharp_default_pos, pre_sharp_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_VAR_CLAHE, window_name, var_clahe_default_pos, var_clahe_max, _on_trackbar)
    cv2.createTrackbar(TB_VAR_SHARP, window_name, variant_sharp_default_pos, variant_sharp_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_VAR_2SHRP, window_name, second_sharp_default_pos, second_sharp_slider_max, _on_trackbar)
    cv2.createTrackbar(TB_V3_BASE, window_name, use_v3_initial, 1, _on_trackbar)

    # Initial capture
    for _ in range(5):
        cap.read()
    ret, frame = cap.read()
    if ret and frame is not None:
        crop = _crop_passport_alignment_region(frame)
        last_roi = crop.copy()
        _on_trackbar(0)

    while True:
        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            if last_roi is not None:
                gp = cv2.getTrackbarPos(TB_GAMMA, window_name)
                gamma_q = max(0.1, gp / 100.0)
                bright_q = cv2.getTrackbarPos(TB_BRIGHT, window_name)
                cx_q = max(50, min(200, cv2.getTrackbarPos(TB_CONTRAST, window_name)))
                sx_q = max(0, min(200, cv2.getTrackbarPos(TB_SAT, window_name)))
                dn_q = cv2.getTrackbarPos(TB_DENOISE, window_name)
                pre_q = cv2.getTrackbarPos(TB_PRE_SHARP, window_name)
                var_c_q = max(0.5, cv2.getTrackbarPos(TB_VAR_CLAHE, window_name) / 100.0)
                vsh_q = cv2.getTrackbarPos(TB_VAR_SHARP, window_name)
                v2_q = cv2.getTrackbarPos(TB_VAR_2SHRP, window_name)
                v3_q = bool(cv2.getTrackbarPos(TB_V3_BASE, window_name))
                _print_variant_env_snippet(
                    gamma=gamma_q,
                    brightness_pos=int(bright_q),
                    contrast=int(cx_q),
                    saturation=int(sx_q),
                    denoise=int(dn_q),
                    pre_sharp=int(pre_q),
                    variant_clahe=float(var_c_q),
                    variant_sharp=int(vsh_q),
                    second_variant_sharp=int(v2_q),
                    use_v3_base=v3_q,
                )
            break
        if key == ord("c"):
            for _ in range(5):
                cap.read()
            ret, frame = cap.read()
            if not ret or frame is None:
                print("\nWARN: Could not read frame from camera.", file=sys.stderr)
                continue
            crop = _crop_passport_alignment_region(frame)
            last_roi = crop.copy()
            _on_trackbar(0)

    print()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

