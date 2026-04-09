"""
OpenCV trackbar names and .env mapping — kept in sync with ``.env.example`` preprocessing order.

Alignment crop (passport): gamma → brightness → contrast → saturation → denoise → pre-unsharp.
Deskew / detection master: SCAN_CLAHE_MASTER_CLIP (``adjust_thresholds`` only).
Variant OCR: SCAN_CLAHE_CLIP, SCAN_VARIANT_SHARPNESS, SCAN_VARIANT_SECOND_SHARPNESS, OCR_USE_V3_BASE.
Polling gate: SHARPNESS_THRESHOLD (``adjust_thresholds`` only).
"""

from __future__ import annotations

from typing import List, Tuple

# (trackbar_label, env_var_primary, description_for_docs)
ALIGNMENT_TRACKBARS: List[Tuple[str, str, str]] = [
    ("01_GAMMA x100", "SCAN_GAMMA", "gamma ×100 → value/100 (1.0 = no curve)"),
    ("02_BRIGHT 128", "SCAN_BRIGHTNESS", "0–255; 128 = neutral (alias SCAN_GLOBAL_BRIGHTNESS)"),
    ("03_CONTRAST", "SCAN_CONTRAST", "50–200; 100 = ×1.0 (alias SCAN_GLOBAL_CONTRAST)"),
    ("04_SAT x100", "SCAN_PRE_SATURATION", "0–200; 100 = unchanged HSV S"),
    ("05_DENOISE", "SCAN_PRE_DENOISE", "0–50 bilateral (alias SCAN_DENOISE)"),
    ("06_PRE_SHARP", "SCAN_PRE_SHARPNESS", "0–100 unsharp on crop before deskew"),
]

THRESHOLD_EXTRA_TRACKBARS: List[Tuple[str, str, str]] = [
    ("07_MST_CLAHE", "SCAN_CLAHE_MASTER_CLIP", "detection / deskew master LAB L CLAHE clip"),
    ("08_SHRP_THR", "SHARPNESS_THRESHOLD", "1–300 Laplacian gate (poll script)"),
]

VARIANT_EXTRA_TRACKBARS: List[Tuple[str, str, str]] = [
    ("07_VAR_CLAHE", "SCAN_CLAHE_CLIP", "v5/v6 LAB L CLAHE clip"),
    ("08_VAR_SHARP", "SCAN_VARIANT_SHARPNESS", "0–125 variant v2/v3 unsharp"),
    ("09_VAR_2SHRP", "SCAN_VARIANT_SECOND_SHARPNESS", "0–125 2nd pass on v2–v6"),
    ("10_V3_BASE", "OCR_USE_V3_BASE", "0/1 median+sharpen base for v4–v6"),
]

# Short accessors for labels only (must match createTrackbar / getTrackbarPos strings)
TB_GAMMA = ALIGNMENT_TRACKBARS[0][0]
TB_BRIGHT = ALIGNMENT_TRACKBARS[1][0]
TB_CONTRAST = ALIGNMENT_TRACKBARS[2][0]
TB_SAT = ALIGNMENT_TRACKBARS[3][0]
TB_DENOISE = ALIGNMENT_TRACKBARS[4][0]
TB_PRE_SHARP = ALIGNMENT_TRACKBARS[5][0]
TB_MST_CLAHE = THRESHOLD_EXTRA_TRACKBARS[0][0]
TB_SHRP_THR = THRESHOLD_EXTRA_TRACKBARS[1][0]
TB_VAR_CLAHE = VARIANT_EXTRA_TRACKBARS[0][0]
TB_VAR_SHARP = VARIANT_EXTRA_TRACKBARS[1][0]
TB_VAR_2SHRP = VARIANT_EXTRA_TRACKBARS[2][0]
TB_V3_BASE = VARIANT_EXTRA_TRACKBARS[3][0]
