"""
Shared preprocessing helpers for adjust_thresholds.py and adjust_variants.py.

Used by ``core/scanner`` for SCAN_PRE_* steps and by the camera_adjustment tuner scripts.
"""

from __future__ import annotations

import cv2
import numpy as np


def apply_contrast_linear(bgr: "np.ndarray", contrast_x100: int) -> "np.ndarray":
    """Linear contrast: multiply all channels by (contrast_x100 / 100). 100 = unchanged."""
    if bgr is None or bgr.size == 0:
        return bgr
    c = max(0.1, min(2.5, int(contrast_x100) / 100.0))
    if abs(c - 1.0) < 0.001:
        return bgr
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    try:
        return np.clip(bgr.astype(np.float32) * c, 0, 255).astype(np.uint8)
    except Exception:
        return bgr


def apply_saturation_hsv(bgr: "np.ndarray", saturation_x100: int) -> "np.ndarray":
    """Scale HSV S channel. saturation_x100 100 = unchanged; 0 = grayscale; 200 ≈ 2× saturation."""
    if bgr is None or bgr.size == 0:
        return bgr
    s = max(0.0, min(2.5, int(saturation_x100) / 100.0))
    if abs(s - 1.0) < 0.001:
        return bgr
    if bgr.ndim == 2:
        return bgr
    if bgr.shape[2] < 3:
        return bgr
    img = bgr[:, :, :3].copy()
    try:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        ch = hsv[:, :, 1].astype(np.float32) * s
        hsv[:, :, 1] = np.clip(ch, 0, 255).astype(np.uint8)
        return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    except Exception:
        return bgr


def apply_denoise_bilateral(bgr: "np.ndarray", strength: int) -> "np.ndarray":
    """Bilateral filter; strength 0 = no-op. strength 1–50 increases smoothing."""
    if bgr is None or bgr.size == 0 or strength <= 0:
        return bgr
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    st = max(1, min(50, int(strength)))
    sc = max(10, min(120, st * 4))
    sp = max(10, min(120, st * 3))
    try:
        return cv2.bilateralFilter(bgr, d=7, sigmaColor=float(sc), sigmaSpace=float(sp))
    except Exception:
        return bgr


def apply_erode(bgr: "np.ndarray", kernel_size: int) -> "np.ndarray":
    """Morphological erosion; 0 = off, 1..7 = square kernel width."""
    if bgr is None or bgr.size == 0 or kernel_size <= 0:
        return bgr
    ks = max(1, min(7, int(kernel_size)))
    kernel = np.ones((ks, ks), dtype=np.uint8)
    try:
        return cv2.erode(bgr, kernel, iterations=1)
    except Exception:
        return bgr


def apply_dilate(bgr: "np.ndarray", kernel_size: int) -> "np.ndarray":
    """Morphological dilation; 0 = off, 1..7 = square kernel width."""
    if bgr is None or bgr.size == 0 or kernel_size <= 0:
        return bgr
    ks = max(1, min(7, int(kernel_size)))
    kernel = np.ones((ks, ks), dtype=np.uint8)
    try:
        return cv2.dilate(bgr, kernel, iterations=1)
    except Exception:
        return bgr


def apply_sharpen_unsharp(bgr: "np.ndarray", amount_pct: int) -> "np.ndarray":
    """
    Unsharp via median blur + addWeighted (same idea as scanner._sharpen_for_ocr).

    amount_pct 0 = identity. 50 ≈ mid. 100 → a=1.0; 125 → a=1.25 (matches scanner max).
    """
    if bgr is None or bgr.size == 0 or amount_pct <= 0:
        return bgr
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    a = min(1.25, max(0.0, float(int(amount_pct)) / 100.0))
    try:
        blurred = cv2.medianBlur(bgr, 5)
        out = cv2.addWeighted(bgr, 1.0 + a, blurred, -a, 0)
        return np.clip(out, 0, 255).astype(np.uint8)
    except Exception:
        return bgr
