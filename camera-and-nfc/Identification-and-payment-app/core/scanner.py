"""Camera OCR and Passport/Card scanning functionality.

**Passport:** Preprocessed alignment crop → Pass 2 EasyOCR MRZ line hunt (full crop, may be tilted) →
union of MRZ boxes → **deskew only the combined MRZ strip** → 5-variant shotgun OCR on that strip.

**Card:** Pass 1 text-based deskew on the full alignment crop, then Pass 2 EasyOCR for PAN / MM/YY /
name. Pass 2 coordinates (expanded) feed the 5-variant shotgun OCR
(v5 = gray→BGR then LAB+CLAHE on L; v6 = BGR sharp only → LAB+CLAHE on L → BGR, no gray step)
and debug/variants/ visuals.
"""

import base64
import logging
import math
import os
import statistics
import sys
import time
import re
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List, Set

logger = logging.getLogger(__name__)

# tkinter + PIL for camera preview when cv2.imshow is unavailable
try:
    import tkinter as tk
    from PIL import Image, ImageTk
    HAS_TKINTER_PREVIEW = True
except ImportError:
    HAS_TKINTER_PREVIEW = False

# Camera resolution (width, height).
CAMERA_WIDTH = 1920
CAMERA_HEIGHT = 1080

# Camera index: 0 = default (e.g. laptop webcam), 1 = first external USB camera, 2 = second, etc.
# Set CAMERA_INDEX in .env to use an external camera (e.g. CAMERA_INDEX=1).
def _get_camera_index() -> int:
    try:
        return int(os.getenv("CAMERA_INDEX", "0").strip())
    except ValueError:
        return 0


def _open_camera() -> Tuple[Optional["cv2.VideoCapture"], int]:
    """Open the camera. On Windows uses CAP_DSHOW for better USB camera support. Returns (cap, index) or (None, -1)."""
    if not HAS_OPENCV:
        return None, -1
    cam_idx = _get_camera_index()
    # On Windows, DirectShow (CAP_DSHOW) often required for external USB cameras
    api = getattr(cv2, "CAP_DSHOW", None) if sys.platform == "win32" else None
    indices_to_try = [cam_idx, 0, 2] if cam_idx != 0 else [0, 1, 2]
    for idx in indices_to_try:
        try:
            if api is not None:
                cap = cv2.VideoCapture(idx, api)
            else:
                cap = cv2.VideoCapture(idx)
            if cap is not None and cap.isOpened():
                if idx != cam_idx:
                    logger.info("Using camera index %s (requested %s)", idx, cam_idx)
                return cap, idx
            if cap is not None:
                cap.release()
        except Exception as e:
            logger.debug("Camera index %s failed: %s", idx, e)
    return None, -1

# Bounding box size (pixels) for document alignment.
# Card guide rectangle (smaller, closer to ID-1 aspect).
RECT_W, RECT_H = 560, 400

# Passport guide rectangle: larger box for clearer capture; crop uses same size.
# Sized for 1920x1080; leaves margin and fills most of the frame.
PASSPORT_RECT_W, PASSPORT_RECT_H = 1040, 640

# Card zones (fractions 0-1 of width/height). Layout: number top-center, name left, expiry right, brand bottom-right.
CARD_ZONES = {
    "card_number": (0.06, 0.20, 0.94, 0.42),   # wide strip, upper-middle (big digits)
    "name": (0.06, 0.46, 0.58, 0.64),          # left, below number
    "expiry": (0.56, 0.46, 0.94, 0.64),        # right, same row as name
    "card_type": (0.58, 0.70, 0.96, 0.96),     # bottom-right (Visa, Mastercard, etc.)
}

# MRZ zone: fractional (x1, y1, x2, y2) on passport alignment crop; bottom strip with two 44-char lines (legacy / tuning).
MRZ_ZONE = (0.0, 0.72, 1.0, 1.0)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
# Load .env so OCR_TIMING is the master key regardless of which script imports this module.
try:
    from dotenv import load_dotenv
    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass
MRZ_DEBUG_VERBOSE = True

# --- Try to import hardware libraries ---
# We wrap in try/except so the app still runs on PCs without camera/OCR
# (it will fall back to MOCK mode instead of crashing)

try:
    import cv2      # OpenCV - for camera access and image processing
    import numpy as np  # Used by OpenCV for image arrays
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("OpenCV not available - will use mock mode")

try:
    import Jetson.GPIO as GPIO  # Only exists on Jetson robots
    HAS_JETSON_GPIO = True
except (ImportError, RuntimeError):
    HAS_JETSON_GPIO = False
    logger.warning("Jetson GPIO not available - will use mock mode")

import importlib.util

# EasyOCR model initialization is slow (and may download files). Don't do it at import time.
# We only check whether the package is installed; the heavy import + model load is deferred until first use.
HAS_EASYOCR = importlib.util.find_spec("easyocr") is not None
OCR_READER = None

# Bundled models: if present, we load from here and disable download (offline/edge-friendly).
EASYOCR_REQUIRED_FILES = ("craft_mlt_25k.pth", "english_g2.pth")


def _get_easyocr_model_dir():
    """Return (model_dir_path, download_enabled).

    - If EASYOCR_MODULE_PATH is set and the dir exists with required .pth files, use it and disable download.
    - Else if project easyocr_models/ exists with required files, use it and disable download.
    - Else return (None, True) so Reader() uses default location and may download (needs network/SSL).
    """
    # 1. Explicit env (absolute or relative to cwd)
    env_path = (os.getenv("EASYOCR_MODULE_PATH") or "").strip()
    if env_path:
        p = Path(env_path).resolve()
        if p.is_dir() and all((p / f).is_file() for f in EASYOCR_REQUIRED_FILES):
            return str(p), False
        if p.is_dir():
            logger.warning("EASYOCR_MODULE_PATH=%s missing required files %s; will use default (download if needed).", env_path, EASYOCR_REQUIRED_FILES)
    # 2. Project-bundled folder (for edge/offline deployment)
    bundled = _PROJECT_ROOT / "easyocr_models"
    if bundled.is_dir() and all((bundled / f).is_file() for f in EASYOCR_REQUIRED_FILES):
        return str(bundled), False
    return None, True


def _get_easyocr_reader():
    """Return a cached EasyOCR reader, initializing it on first use.

    Uses EASYOCR_MODULE_PATH or project easyocr_models/ if present (offline/edge); otherwise
    default EasyOCR path (may download on first run; requires network and valid SSL).
    Set DISABLE_EASYOCR=1 to force-disable EasyOCR entirely.
    """
    global OCR_READER, HAS_EASYOCR
    if OCR_READER is not None:
        return OCR_READER
    if not HAS_EASYOCR:
        return None
    if (os.getenv("DISABLE_EASYOCR", "") or "").strip().lower() in ("1", "true", "yes", "y", "on"):
        return None
    try:
        import easyocr  # heavy import (torch); defer until needed

        model_dir, download_ok = _get_easyocr_model_dir()
        logger.info("Initializing EasyOCR reader (first use)...")
        if model_dir:
            logger.info("Using bundled/local EasyOCR models from %s (download_enabled=False).", model_dir)
            OCR_READER = easyocr.Reader(
                ["en"],
                model_storage_directory=model_dir,
                download_enabled=download_ok,
            )
        else:
            OCR_READER = easyocr.Reader(["en"])  # English-only; may download if needed
        return OCR_READER
    except Exception as e:
        # Mark unavailable to avoid repeated slow failures.
        HAS_EASYOCR = False
        logger.warning("EasyOCR not available - OCR will be limited (%s)", e)
        if "CERTIFICATE_VERIFY_FAILED" in str(e) or "SSL" in str(e):
            logger.warning(
                "Tip: run 'python download_easyocr_models.py' once (with internet), or copy easyocr_models/ into the project for offline use."
            )
        return None


def detect_hardware() -> bool:
    """Check if we have real hardware (camera + Jetson GPIO).

    Returns True only if BOTH OpenCV and Jetson GPIO are available.
    On a laptop, this usually returns False -> we use mock mode.
    """
    if not HAS_OPENCV or not HAS_JETSON_GPIO:
        return False

    try:
        cap, _ = _open_camera()
        if cap is not None:
            cap.release()
            return True
    except Exception as e:
        logger.debug("Hardware detection failed: %s", e)

    return False


def _sharpness_score(frame: "np.ndarray", use_center_region: bool = True) -> float:
    """Higher = sharper. Uses Laplacian variance on (optionally) the center card region."""
    try:
        if use_center_region and frame.shape[0] > 100 and frame.shape[1] > 100:
            h, w = frame.shape[:2]
            x1 = int(w * 0.2)
            y1 = int(h * 0.2)
            x2 = int(w * 0.8)
            y2 = int(h * 0.8)
            frame = frame[y1:y2, x1:x2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        return 0.0


def _capture_best_frames(
    cap: "cv2.VideoCapture",
    num_frames: int = 3,
    interval_ms: int = 75,
    top_k: int = 1,
) -> List["np.ndarray"]:
    """Grab *num_frames* from the camera and return the *top_k* sharpest as raw
    (unenhanced) frames sorted best-first.  Returns an empty list on failure."""
    if not HAS_OPENCV or cap is None or not cap.isOpened():
        return []
    scored: List[Tuple[float, "np.ndarray"]] = []
    for _ in range(num_frames):
        ret, frame = cap.read()
        if not ret or frame is None:
            continue
        score = _sharpness_score(frame, use_center_region=True)
        scored.append((score, frame.copy()))
        if interval_ms > 0:
            time.sleep(interval_ms / 1000.0)
    scored.sort(key=lambda t: t[0], reverse=True)
    return [f for _, f in scored[:top_k]]


def _capture_selection_config(doc_type: str) -> Tuple[int, int]:
    """Return (num_frames_to_grab, top_k_to_keep) for the document capture flow."""
    if doc_type.strip().lower() == "card":
        return 3, 2
    # Passport: grab 3 quick samples and keep only the single sharpest frame.
    return 3, 1


# ---------------------------------------------------------------------------
# Dark-environment tuning — all configurable via .env
# ---------------------------------------------------------------------------
# Gamma < 1.0 brightens dark frames (e.g. 0.5 is aggressive, 0.7 is moderate).
# Set SCAN_GAMMA=1.0 to disable (default). Applied to the raw crop before deskew.
_SCAN_GAMMA = float(os.environ.get("SCAN_GAMMA", "0.7").strip())

# Global tone after gamma (passport + card alignment crops, before deskew).
# Set in .env (first non-empty wins for each):
#   Brightness: SCAN_GLOBAL_BRIGHTNESS, SCAN_BRIGHTNESS, or ADJUST_BRIGHTNESS
#   Contrast:   SCAN_GLOBAL_CONTRAST, SCAN_CONTRAST, or ADJUST_CONTRAST
# Brightness: 0–255; 128 = no offset (beta = value − 128 per channel). Default 125.
# Contrast: 50–200 = multiply by (value / 100); 100 = 1.0. Default 160.
def _read_int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(float(os.environ.get(name, str(default)).strip()))
    except ValueError:
        v = default
    return max(lo, min(hi, v))


def _read_int_env_first(names: Tuple[str, ...], default: int, lo: int, hi: int) -> int:
    """Parse first defined env var in ``names``; empty string skips to next."""
    for name in names:
        raw = os.environ.get(name)
        if raw is None:
            continue
        s = str(raw).strip()
        if s == "":
            continue
        try:
            v = int(float(s))
            return max(lo, min(hi, v))
        except ValueError:
            continue
    return max(lo, min(hi, default))


_SCAN_GLOBAL_BRIGHTNESS = _read_int_env_first(
    ("SCAN_GLOBAL_BRIGHTNESS", "SCAN_BRIGHTNESS", "ADJUST_BRIGHTNESS"),
    125,
    0,
    255,
)
_SCAN_GLOBAL_CONTRAST = _read_int_env_first(
    ("SCAN_GLOBAL_CONTRAST", "SCAN_CONTRAST", "ADJUST_CONTRAST"),
    160,
    50,
    200,
)

# When True, skip the fixed center-crop alignment box and pass the full camera frame
# into the pipeline. Use this when the passport position is unpredictable (shifted/tilted).
_SCAN_FULL_FRAME = os.environ.get("SCAN_FULL_FRAME", "").strip().lower() in ("1", "true", "yes")

# CLAHE clip limit for OCR variants v5_lab_clahe / v6_lab_clahe (L channel in LAB).
# Higher = more aggressive contrast stretching; useful in dim lighting.
# Default 2.5; set SCAN_CLAHE_CLIP=1.2 to revert to the original subtle value.
_SCAN_CLAHE_CLIP = float(os.environ.get("SCAN_CLAHE_CLIP", "2.5").strip())

# CLAHE clip limit used for the EasyOCR detection master (deskew + MRZ hunt).
# Default 3.0; set SCAN_CLAHE_MASTER_CLIP=2.0 to revert to original value.
_SCAN_CLAHE_MASTER_CLIP = float(os.environ.get("SCAN_CLAHE_MASTER_CLIP", "3.0").strip())

# After gamma + brightness + contrast on the alignment crop, before deskew (see .env.example).
_SCAN_PRE_SATURATION = _read_int_env_first(
    ("SCAN_PRE_SATURATION", "SCAN_SATURATION", "ADJUST_SATURATION"),
    100,
    0,
    200,
)
_SCAN_PRE_DENOISE = _read_int_env_first(
    ("SCAN_PRE_DENOISE", "SCAN_DENOISE", "ADJUST_DENOISE"),
    0,
    0,
    50,
)
_SCAN_PRE_ERODE = _read_int_env_first(
    ("SCAN_PRE_ERODE", "SCAN_ERODE"),
    0,
    0,
    7,
)
_SCAN_PRE_DILATE = _read_int_env_first(
    ("SCAN_PRE_DILATE", "SCAN_DILATE"),
    0,
    0,
    7,
)
_SCAN_PRE_SHARPNESS = _read_int_env_first(
    ("SCAN_PRE_SHARPNESS", "SCAN_PREPROCESS_SHARPNESS"),
    50,
    0,
    100,
)
# Unsharp strength for OCR variants v2 / v3 (_sharpen_for_ocr). 0 = off; 50 ≈ mid.
# Env is 0–125: value/100 → weight *a* in addWeighted, capped at *a*≤1.25 in _sharpen_for_ocr.
# So SCAN_VARIANT_SHARPNESS=100 → a=1.0; 125 → a=1.25 (maximum sharpening in code).
_SCAN_VARIANT_SHARPNESS = _read_int_env_first(
    ("SCAN_VARIANT_SHARPNESS", "SCAN_SHARPNESS_VARIANT", "ADJUST_SHARPNESS"),
    50,
    0,
    125,
)
# Second unsharp pass applied on top of each built variant **except** v1_orig (0–125; 0 = off).
# Runs after v2/v3 sharp, v4 gray, v5/v6 LAB+CLAHE so OCR/debug PNGs all get the extra edge boost.
_SCAN_VARIANT_SECOND_SHARPNESS = _read_int_env_first(
    ("SCAN_VARIANT_SECOND_SHARPNESS", "SCAN_VARIANT_EXTRA_SHARPNESS"),
    0,
    0,
    125,
)
# When true, card alignment crop also gets SCAN_GAMMA before brightness/contrast (default: card skips gamma).
_SCAN_CARD_USE_GAMMA = os.environ.get("SCAN_CARD_USE_GAMMA", "").strip().lower() in (
    "1",
    "true",
    "yes",
)
# EasyOCR on v5/v6 LAB+CLAHE often returns short, over-confident fragments that sorted-by-conf
# ``top_l1`` / ``top_l2`` would place first and poison ``combined_l1`` / ``combined_l2``.
try:
    _SCAN_MRZ_LAB_POOL_WEIGHT = float(os.environ.get("SCAN_MRZ_LAB_POOL_WEIGHT", "0.5").strip())
except ValueError:
    _SCAN_MRZ_LAB_POOL_WEIGHT = 0.5
_SCAN_MRZ_LAB_POOL_WEIGHT = max(0.05, min(1.5, _SCAN_MRZ_LAB_POOL_WEIGHT))


def _mrz_pool_variant_conf_scale(variant_key: str) -> float:
    """Scale OCR confidence for MRZ pool merge / gating (LAB variants fragment more)."""
    vk = (variant_key or "").lower()
    mult = 1.0
    if "v5_lab_clahe" in vk or "v6_lab_clahe" in vk:
        mult *= float(_SCAN_MRZ_LAB_POOL_WEIGHT)
    # Unprocessed strip often reads Line 1 cleanest; slight boost so merge/combined_l1 is not
    # dominated by sharpened variants that stitch Line 1 + Line 2 in one EasyOCR row.
    if "v1_orig" in vk:
        mult *= 1.12
    return mult


def _mrz_l1_loose_looks_merged_with_line2(loose: str) -> bool:
    """True when a *line-1 pool* string clearly embeds Line-2-style digits (two lines in one read)."""
    if not loose:
        return False
    u = loose.upper()
    tail = u[5:] if len(u) > 5 else u
    # Long digit runs belong on TD3 Line 2, not inside Line 1 name field.
    if re.search(r"\d{5,}", tail):
        return True
    # MRZ Line 2 often contains YYMMDD + sex + YYMMDD patterns when concatenated.
    if re.search(r"\d{6}[MF<]\d", u):
        return True
    if _has_td3_line1_prefix(u):
        nd = sum(1 for c in u if c.isdigit())
        if nd >= 8:
            return True
    return False


def _mrz_l1_loose_merge_priority(loose: str, conf: float) -> float:
    """Rank line-1 pool fragments for cross-entry merge: prefer long TD3-shaped MRZ, not raw conf."""
    if not loose:
        return 0.0
    if _mrz_l1_loose_looks_merged_with_line2(loose):
        return -5000.0 + float(conf)
    score = 0.0
    if _has_td3_line1_prefix(loose):
        score += 400.0
    score += min(len(loose), 55) * 4.0
    score += loose.count("<") * 6.0
    score += float(conf) * 25.0
    return score


def _mrz_l2_loose_looks_merged_with_line1(loose: str) -> bool:
    """True when a *line-2 pool* string clearly embeds a second TD3 Line-1 (L2 + L1 in one read).

    EasyOCR often returns one box spanning both MRZ rows, e.g. ``...<<00PpcanrartINGESaram...``.
    Those strings score very high on length/digits/chevrons and poison ``combined_l2``.
    """
    if not loose or len(loose) < 20:
        return False
    u = loose.upper()
    # TD3 Line 2 starts with document number; a *second* ``P<`` / ``PP`` / ``P[A-Z]`` deep in the
    # string is almost always the start of Line 1 stitched onto Line 2.
    for i in range(15, len(u) - 1):
        if u[i] != "P":
            continue
        nxt = u[i + 1]
        if nxt == "<" or ("A" <= nxt <= "Z"):
            return True
    return False


def _mrz_l2_loose_merge_priority(loose: str, conf: float) -> float:
    """Rank line-2 pool fragments: long, digit-heavy, chevron-heavy; de-prioritize TD3 line-1 headers."""
    if not loose:
        return 0.0
    if _mrz_l2_loose_looks_merged_with_line1(loose):
        return -5000.0 + float(conf)
    digits = sum(1 for ch in loose if ch.isdigit())
    score = min(len(loose), 55) * 2.0 + digits * 3.0 + loose.count("<") * 2.0
    if _has_td3_line1_prefix(loose):
        score -= 80.0
    score += float(conf) * 20.0
    return score


def _apply_pre_alignment_extras(image: "np.ndarray") -> "np.ndarray":
    """Saturation, denoise, morphology, unsharp on BGR crop (``SCAN_PRE_*``)."""
    if not HAS_OPENCV or image is None or image.size == 0:
        return image
    try:
        from camera_adjustment._tuner_preproc import (  # type: ignore[import-untyped]
            apply_dilate,
            apply_denoise_bilateral,
            apply_erode,
            apply_saturation_hsv,
            apply_sharpen_unsharp,
        )

        out = apply_saturation_hsv(image.copy(), _SCAN_PRE_SATURATION)
        out = apply_denoise_bilateral(out, _SCAN_PRE_DENOISE)
        # Optional morphology can close broken MRZ strokes or thin noisy blobs before OCR.
        out = apply_erode(out, _SCAN_PRE_ERODE)
        out = apply_dilate(out, _SCAN_PRE_DILATE)
        out = apply_sharpen_unsharp(out, _SCAN_PRE_SHARPNESS)
        return out
    except Exception:
        return image


def _gamma_correct(image: "np.ndarray", gamma: float = 0.7) -> "np.ndarray":
    """Brighten a dark frame using a lookup-table gamma correction.

    gamma < 1.0 → brightens (good for dark environments).
    gamma = 1.0 → no change.
    gamma > 1.0 → darkens.
    """
    if not HAS_OPENCV or image is None or image.size == 0 or abs(gamma - 1.0) < 0.01:
        return image
    try:
        import numpy as np
        inv_gamma = 1.0 / max(gamma, 0.01)
        lut = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)], dtype=np.uint8)
        return cv2.LUT(image, lut)
    except Exception:
        return image


def _apply_global_brightness_contrast(image: "np.ndarray") -> "np.ndarray":
    """Linear brightness offset then contrast gain (``SCAN_GLOBAL_BRIGHTNESS``, ``SCAN_GLOBAL_CONTRAST``)."""
    if not HAS_OPENCV or image is None or image.size == 0:
        return image
    try:
        out = image
        beta = float(_SCAN_GLOBAL_BRIGHTNESS - 128)
        if abs(beta) > 0.01:
            out = cv2.convertScaleAbs(out, alpha=1.0, beta=beta)
        c = max(0.1, min(2.5, _SCAN_GLOBAL_CONTRAST / 100.0))
        if abs(c - 1.0) > 0.001:
            if out.ndim == 2:
                out = cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)
            out = np.clip(out.astype(np.float32) * c, 0, 255).astype(np.uint8)
        return out
    except Exception:
        return image


def _preprocess_passport_alignment_crop(crop: "np.ndarray") -> "np.ndarray":
    """Gamma, brightness/contrast, then pre-alignment sat/denoise/sharp before deskew."""
    if crop is None or crop.size == 0:
        return crop
    out = _gamma_correct(crop, _SCAN_GAMMA)
    out = _apply_global_brightness_contrast(out)
    return _apply_pre_alignment_extras(out)


def _preprocess_card_alignment_crop(crop: "np.ndarray") -> "np.ndarray":
    """Optional gamma, brightness/contrast, pre-alignment extras (``SCAN_CARD_USE_GAMMA``)."""
    if crop is None or crop.size == 0:
        return crop
    out = crop
    if _SCAN_CARD_USE_GAMMA:
        out = _gamma_correct(out, _SCAN_GAMMA)
    out = _apply_global_brightness_contrast(out)
    return _apply_pre_alignment_extras(out)


def _apply_clahe_bgr(image: "np.ndarray", clip_limit: float = 2.0, grid_size: int = 8) -> "np.ndarray":
    """Apply CLAHE on the L channel (LAB) to improve contrast without changing color balance."""
    if not HAS_OPENCV or image is None or image.size == 0 or image.ndim != 3:
        return image
    try:
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(grid_size, grid_size))
        l = clahe.apply(l)
        lab = cv2.merge([l, a, b])
        return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    except Exception:
        return image


def _unsharp_median_for_ocr(image: "np.ndarray", strength_0_125: int) -> "np.ndarray":
    """Median-based unsharp mask; *strength_0_125* uses same scale as ``SCAN_VARIANT_SHARPNESS`` (capped *a*≤1.25)."""
    if not HAS_OPENCV or image is None or image.size == 0:
        return image
    try:
        a = min(1.25, max(0.0, float(strength_0_125) / 100.0))
        if a <= 0.001:
            return image
        blurred = cv2.medianBlur(image, 5)
        sharpened = cv2.addWeighted(image, 1.0 + a, blurred, -a, 0)
        return np.clip(sharpened, 0, 255).astype(np.uint8)
    except Exception:
        return image


def _sharpen_for_ocr(image: "np.ndarray") -> "np.ndarray":
    """Unsharp for OCR variant v2/v3; strength from ``SCAN_VARIANT_SHARPNESS`` (0–125, see module constant)."""
    return _unsharp_median_for_ocr(image, _SCAN_VARIANT_SHARPNESS)


def _capture_frame_via_tkinter(cap: "cv2.VideoCapture", doc_type: str = "passport") -> List["np.ndarray"]:
    """Tkinter camera preview. Returns the configured best raw frame(s) on capture.
    doc_type: 'passport' or 'card' to show the correct alignment box."""
    if not HAS_TKINTER_PREVIEW or not HAS_OPENCV:
        return []

    use_card_rect = doc_type.strip().lower() == "card"
    captured_frames: List["np.ndarray"] = []
    after_id = [None]

    root = tk.Tk()
    root.title("Robot Scanner - Align Document")
    root.configure(bg="black")
    root.resizable(True, True)

    def cancel_preview():
        if after_id[0] is not None:
            try:
                root.after_cancel(after_id[0])
            except Exception:
                pass
            after_id[0] = None

    def on_close():
        cancel_preview()
        root.quit()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)

    lbl = tk.Label(
        root,
        text="Position your passport/card in the green box.\nClick Capture or press Enter when ready.",
        bg="black",
        fg="white",
        font=("Arial", 12),
    )
    lbl.pack(pady=8)

    video_label = tk.Label(root, bg="black")
    video_label.pack(padx=10, pady=5)

    def on_capture():
        nonlocal captured_frames
        cancel_preview()
        lbl.configure(text="Hold steady... capturing frames.")
        root.update()
        time.sleep(0.6)
        num_frames, top_k = _capture_selection_config(doc_type)
        captured_frames = _capture_best_frames(cap, num_frames=num_frames, interval_ms=75, top_k=top_k)
        root.quit()
        root.destroy()

    btn = tk.Button(root, text="Capture (or press Enter)", command=on_capture, font=("Arial", 14), padx=20, pady=10)
    btn.pack(pady=10)

    root.bind("<Return>", lambda e: on_capture())
    root.bind("<KP_Enter>", lambda e: on_capture())
    root.focus_force()

    def update_frame():
        try:
            if not root.winfo_exists():
                return
        except tk.TclError:
            return
        ret, frame = cap.read()
        if not ret:
            after_id[0] = root.after(30, update_frame)
            return
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb)
        img = ImageTk.PhotoImage(img)
        video_label.img = img
        video_label.configure(image=img)
        after_id[0] = root.after(30, update_frame)

    root.after(0, update_frame)
    root.mainloop()

    return captured_frames


def _capture_frames_from_camera(doc_type: str = "passport") -> List["np.ndarray"]:
    """Open camera, show live preview (OpenCV window; fallback to tkinter), and capture the configured sharpest frame(s).
    doc_type: 'passport' uses PASSPORT_RECT_*, 'card' uses RECT_* (card crop).

    Passport keeps the sharpest 1 of 3 frames; card keeps the sharpest 2 of 3.
    Returns raw frames best-first, or empty list on failure / cancel.
    """
    if not HAS_OPENCV:
        logger.warning("OpenCV not available - cannot open camera")
        return []

    use_card_rect = doc_type.strip().lower() == "card"

    try:
        cap, cam_idx = _open_camera()
        if cap is None:
            logger.error("Could not open camera. On Windows, try CAMERA_INDEX=0 or 1 in .env; external USB often needs DirectShow (CAP_DSHOW).")
            return []

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)

        window_name = "Robot Scanner - Align Document"

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    logger.error("Failed to read frame from camera")
                    break

                cv2.imshow(window_name, frame)
                key = cv2.waitKey(1) & 0xFF

                # Space or Enter to capture
                if key in (32, 13):
                    time.sleep(0.5)
                    num_frames, top_k = _capture_selection_config(doc_type)
                    picked = _capture_best_frames(cap, num_frames=num_frames, interval_ms=75, top_k=top_k)
                    cap.release()
                    cv2.destroyWindow(window_name)
                    return picked
                # Esc to cancel
                if key == 27:
                    break

            cap.release()
            cv2.destroyWindow(window_name)
            return []

        except cv2.error:
            if HAS_TKINTER_PREVIEW:
                logger.info("OpenCV GUI unavailable, using tkinter camera preview")
                frames = _capture_frame_via_tkinter(cap, doc_type=doc_type)
                cap.release()
                return frames
            logger.warning("OpenCV GUI not available, falling back to prompt-based capture")
            print("\nPosition your passport/card in front of the camera.")
            print("Take your time. Press Enter when you are ready to capture.")
            input()
            print("Capturing now...")
            num_frames, top_k = _capture_selection_config(doc_type)
            picked = _capture_best_frames(cap, num_frames=num_frames, interval_ms=75, top_k=top_k)
            cap.release()
            try:
                cv2.destroyAllWindows()
            except Exception:
                pass
            return picked

    except Exception as exc:
        logger.error("Error during camera capture: %s", exc, exc_info=True)
        try:
            cap.release()
        except Exception:
            pass
        return []


def _luhn_check(card_num: str) -> bool:
    """Return True if the card number passes the Luhn checksum."""
    if not card_num or not card_num.isdigit():
        return False
    total = 0
    for i, digit in enumerate(reversed(card_num)):
        n = int(digit)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# Symbols that never appear in card numbers; replace with the digit OCR often confuses them with.
_OCR_SYMBOL_TO_DIGIT = {
    "$": "4", "%": "8", "@": "0", "#": "4", "&": "8", "*": "8",
    "(": "0", ")": "0", "[": "1", "]": "1", "{": "1", "}": "1",
    "?": "7", "!": "1", "¢": "4", "§": "5", "©": "0", "®": "0",
}

def _normalize_ocr_digits_for_card(text: str) -> str:
    """Remove symbol confusions: $ % @ # etc. → digit. Card number has only digits; / is for expiry only."""
    if not text:
        return text
    s = text
    for sym, digit in _OCR_SYMBOL_TO_DIGIT.items():
        s = s.replace(sym, digit)
    s = re.sub(r"(\d)O(\d)", r"\g<1>0\g<2>", s)
    s = re.sub(r"(\d)O(?!\d)", r"\g<1>0", s)
    s = re.sub(r"(?<!\d)O(\d)", r"0\g<1>", s)
    return s


def _parse_expiry_mm_yy(text: str) -> Optional[str]:
    """Extract expiry as MM/YY only (exactly 5 chars including /). / is required for expiry."""
    if not text:
        return None
    # Prefer strict MM/YY (2 digits, slash, 2 digits) — only 5-char format we accept
    m = re.search(r"(0[1-9]|1[0-2])/(\d{2})", text)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    # Fallback: MM-YY or MMYY (then format as MM/YY)
    m = re.search(r"(0[1-9]|1[0-2])[\-\s]*(\d{2})", text)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    m = re.search(r"(0[1-9]|1[0-2])(\d{2})(?:\D|$|\s)", text)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    m = re.search(r"(0[1-9]|1[0-2]).*?25", text)
    if m:
        return f"{m.group(1)}/25"
    return None


def _pick_luhn_card_number(digits_only: list, all_digits: Optional[str] = None) -> Optional[str]:
    """When there are multiple digit runs (e.g. junk + real number), pick the one that passes Luhn."""
    candidates = []
    for s in digits_only or []:
        if 13 <= len(s) <= 19:
            candidates.append(s)
    if all_digits and len(all_digits) >= 16:
        for i in range(len(all_digits) - 15):
            candidates.append(all_digits[i : i + 16])
    for c in candidates:
        if len(c) == 16:
            if _luhn_check(c):
                return c
            corr = _try_correct_card_number_ocr(c)
            if corr is not None:
                return corr
    for c in candidates:
        if len(c) != 16 and 13 <= len(c) <= 19:
            if _luhn_check(c):
                return c
    valid_len = [c for c in candidates if 13 <= len(c) <= 19]
    return max(valid_len, key=lambda s: (len(s) == 16, len(s))) if valid_len else None


def _try_correct_card_number_ocr(card_no: str) -> Optional[str]:
    """If OCR misread a digit, try common confusions (1/7, 0/8, 5/6, etc.) and return a version that passes Luhn."""
    if not card_no or len(card_no) != 16 or not card_no.isdigit():
        return None
    if _luhn_check(card_no):
        return card_no
    # Common OCR digit confusions
    confusions = {"0": "86", "1": "7", "2": "7", "3": "85", "4": "9", "5": "6", "6": "5", "7": "1", "8": "03", "9": "4"}
    digits = list(card_no)
    for i in range(16):
        orig = digits[i]
        for c in confusions.get(orig, ""):
            digits[i] = c
            candidate = "".join(digits)
            if _luhn_check(candidate):
                return candidate
        digits[i] = orig
    return None


def _crop_to_alignment_region(frame: "np.ndarray") -> "np.ndarray":
    """Crop frame to the center RECT_W x RECT_H region (where user aligned the document)."""
    height, width = frame.shape[:2]
    rect_w = min(RECT_W, width - 20)
    rect_h = min(RECT_H, height - 20)
    x1 = (width - rect_w) // 2
    y1 = (height - rect_h) // 2
    return frame[y1 : y1 + rect_h, x1 : x1 + rect_w]


def _crop_passport_alignment_region(frame: "np.ndarray") -> "np.ndarray":
    """Crop frame to the center PASSPORT_RECT_W x PASSPORT_RECT_H region (passport data page).

    When SCAN_FULL_FRAME=1 is set in .env the full camera frame is returned without
    cropping, allowing detection of passports that are shifted or tilted out of the
    standard alignment box.
    """
    if _SCAN_FULL_FRAME:
        return frame
    height, width = frame.shape[:2]
    rect_w = min(PASSPORT_RECT_W, width - 20)
    rect_h = min(PASSPORT_RECT_H, height - 20)
    x1 = (width - rect_w) // 2
    y1 = (height - rect_h) // 2
    return frame[y1 : y1 + rect_h, x1 : x1 + rect_w]


def _show_capture_for_verification(frame: "np.ndarray", doc_type: str = "passport") -> bool:
    """Show the RAW captured frame (cropped to the alignment region for doc_type and resized for
    the UI) so the user can judge actual image quality. doc_type: 'passport' or 'card'.
    """
    if not HAS_OPENCV or frame is None or frame.size == 0:
        return True
    if doc_type.strip().lower() == "card":
        display = _crop_to_alignment_region(frame)
    else:
        display = _crop_passport_alignment_region(frame)
    try:
        rgb = cv2.cvtColor(display, cv2.COLOR_BGR2RGB)
    except Exception:
        rgb = display if display.ndim == 3 else cv2.cvtColor(display, cv2.COLOR_GRAY2RGB)

    choice = [None]  # mutable so inner function can set it

    if HAS_TKINTER_PREVIEW:
        root = tk.Tk()
        root.title("Verify capture")
        root.configure(bg="black")
        root.resizable(True, True)

        tk_img = Image.fromarray(rgb)
        tk_photo = ImageTk.PhotoImage(tk_img)
        lbl_img = tk.Label(root, image=tk_photo, bg="black")
        lbl_img.image = tk_photo
        lbl_img.pack(padx=10, pady=5)

        tk.Label(
            root,
            text="Is this image clear? Use it for OCR or retake.",
            bg="black",
            fg="white",
            font=("Arial", 11),
        ).pack(pady=5)

        def use_this():
            choice[0] = True
            root.quit()
            root.destroy()

        def retry():
            choice[0] = False
            root.quit()
            root.destroy()

        btn_frame = tk.Frame(root, bg="black")
        btn_frame.pack(pady=10)
        tk.Button(btn_frame, text="Use this", command=use_this, font=("Arial", 12), padx=15, pady=5).pack(side=tk.LEFT, padx=5)
        tk.Button(btn_frame, text="Retry", command=retry, font=("Arial", 12), padx=15, pady=5).pack(side=tk.LEFT, padx=5)
        root.bind("<Return>", lambda e: use_this())
        root.bind("<Escape>", lambda e: retry())
        root.protocol("WM_DELETE_WINDOW", retry)
        root.mainloop()
        return choice[0] if choice[0] is not None else False

    # Fallback: no tkinter, try OpenCV window
    try:
        cv2.imshow("Verify capture - Enter=use, R=retry", display)
        key = cv2.waitKey(0) & 0xFF
        cv2.destroyWindow("Verify capture - Enter=use, R=retry")
        return key != ord("r") and key != ord("R")
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Stage 1 & 2: 6-Variant Shotgun OCR
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# debug_activate: when True, save all debug images to debug/variants/.
# When False, no deskew_debug_zone, deskew_debug_passport,
# Variant debug images (v1–v5 for OCR pipeline) are written. Set in .env as DEBUG_ACTIVATE.
# ---------------------------------------------------------------------------
DEBUG_ACTIVATE = os.environ.get("DEBUG_ACTIVATE", "").strip().lower() in ("1", "true", "yes")
_DEBUG_VARIANTS_BASE = _PROJECT_ROOT / "debug" / "variants"
# Backward compat: flat dir used when doc_type is unknown; prefer _get_debug_variants_dir().
_DEBUG_VARIANTS_DIR = _DEBUG_VARIANTS_BASE

# When True, compute tilt from detection boxes and rotate the crop; when False, no angle or rotation (image used as-is).
# Default ON when unset; set DESKEW_ENABLE=0 / false / no / off to disable.
_deskew_on = os.environ.get("DESKEW_ENABLE", "1").strip().lower()
DESKEW_ENABLE = _deskew_on not in ("0", "false", "no", "off")

# After the first full deskew (EasyOCR + angle) per label in a batch, reuse the measured tilt and only
# apply cv2.warpAffine — skips the deskew readtext() call. Reset at the start of each multi-frame scan.
_deskew_cache_on = os.environ.get("DESKEW_CACHE_ANGLE", "1").strip().lower()
DESKEW_CACHE_ANGLE = _deskew_cache_on not in ("0", "false", "no", "off")

# Passport only: after coarse Hough/box tilt, search ±few degrees on MRZ band to maximize row-projection
# sharpness (straighter horizontal text). Set DESKEW_REFINE_PASSPORT=0 to skip.
_deskew_refine_p = os.environ.get("DESKEW_REFINE_PASSPORT", "1").strip().lower()
DESKEW_REFINE_PASSPORT = _deskew_refine_p not in ("0", "false", "no", "off")

# label -> estimated text tilt (degrees), same convention as rotation_angle returned by _text_based_deskew.
_deskew_cached_tilt_degrees: Dict[str, float] = {}

DEBUG_SAVE_VARIANTS = True
# Card only: one save per scan session for full-frame boxed variant PNGs (passport uses strip-only ``_save_debug_variants_plain``).
_debug_variants_saved_card = False
# Extra debug: save MRZ variant images from whichever ROI/band actually runs OCR,
# even when MRZ line detection fails and/or later TD3/check-digit gating rejects
# the candidates. Track by tag so we can save line-1 + line-2 variants, but not
# spam duplicate saves for every ROI tag.
_debug_mrz_plain_variants_saved_tags = set()

# Master key for OCR timing logs: set OCR_TIMING=true in .env to log duration of heavy OCR steps; false = no timing logs.
_OCR_TIMING = os.environ.get("OCR_TIMING", "").strip().lower() in ("1", "true", "yes")

# Set OCR_USE_V3_BASE=1 to build v4/v5 from v3 (clean sharp); default uses v2 (sharp) as base. See docs/OCR_VARIANTS.md.
_USE_V3_BASE_FOR_DERIVED = os.environ.get("OCR_USE_V3_BASE", "").strip().lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Why the pipeline is slow (main time consumers):
# 1. EasyOCR model load at import: Reader(["en"]) loads PyTorch + detection + recognition
#    models once; on CPU this can take 30–90+ seconds (first run may download).
# 2. Many EasyOCR readtext() calls: each is a neural net forward pass. Per passport frame:
#    deskew (1 full-crop readtext on 1st frame; cached tilt skips deskew readtext on later frames
#    when DESKEW_CACHE_ANGLE) + MRZ detect + combined MRZ strip × 5 variants. Per card frame:
#    deskew + ROI detect + ROIs × variants (2nd card frame skips deskew readtext if cache on).
#    run_test_image uses 3 passport + 3 card frames → fewer passport-side calls than the old per-line path.
# 3. All of the above run on CPU unless CUDA/MPS is available; GPU greatly reduces EasyOCR time.
# ---------------------------------------------------------------------------


def _get_debug_variants_dir(doc_type: str) -> Path:
    """Return debug/variants/passport or debug/variants/card so passport and card debug don't overwrite each other."""
    doc = (doc_type or "").strip().lower()
    if doc not in ("passport", "card"):
        doc = "passport"
    return _DEBUG_VARIANTS_BASE / doc


def _clahe_lab_bgr(image: "np.ndarray", *, color_only: bool = False) -> "np.ndarray":
    """Apply CLAHE to LAB L channel only; return BGR.

    Default (``color_only=False``): 2D images are promoted with GRAY2BGR (e.g. v5 after gray lift).

    ``color_only=True`` (v6): **No grayscale step** — only true BGR input is processed:
    BGR → LAB → CLAHE(L) → LAB→BGR. If the image is not 3-channel BGR, returns a copy unchanged
    (no GRAY2BGR).
    """
    if image is None or image.size == 0:
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
        clahe_obj = cv2.createCLAHE(clipLimit=_SCAN_CLAHE_CLIP, tileGridSize=(8, 8))
        l2 = clahe_obj.apply(l_ch)
        lab2 = cv2.merge([l2, a_ch, b_ch])
        return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)
    except Exception:
        return img


def _build_six_variants(base_roi: "np.ndarray") -> List["np.ndarray"]:
    """Build **five** OCR variant images from a single ROI crop (function name kept for imports).

    v1_orig:         Raw baseline crop.
    v2_or_v3_sharp:  v1 + sharpen (v2) or medianBlur+sharpen (v3) per ``OCR_USE_V3_BASE``.
    v4_gray:         Grayscale of the selected sharp base.
    v5_lab_clahe:    Grayscale promoted to BGR, then LAB + CLAHE on L (``SCAN_CLAHE_CLIP``).
    v6_lab_clahe:    v2/v3 **BGR** sharp → LAB → CLAHE(L) → BGR only (never BGR2GRAY / GRAY2BGR).
    """
    if base_roi is None or base_roi.size == 0:
        return []
    v1_orig = base_roi.copy()
    v2_sharp = _sharpen_for_ocr(v1_orig.copy())
    v3_clean_sharp = _sharpen_for_ocr(cv2.medianBlur(v1_orig.copy(), 3))
    use_v3 = _USE_V3_BASE_FOR_DERIVED
    sharp = v3_clean_sharp if use_v3 else v2_sharp
    base_for_gray = sharp
    try:
        v4_gray = cv2.cvtColor(base_for_gray, cv2.COLOR_BGR2GRAY) if base_for_gray.ndim == 3 else base_for_gray.copy()
    except Exception:
        v4_gray = base_for_gray.copy()
    try:
        gray_as_bgr = cv2.cvtColor(v4_gray.copy(), cv2.COLOR_GRAY2BGR)
        v5_lab_clahe = _clahe_lab_bgr(gray_as_bgr)
    except Exception:
        try:
            v5_lab_clahe = cv2.cvtColor(v4_gray.copy(), cv2.COLOR_GRAY2BGR)
        except Exception:
            v5_lab_clahe = sharp.copy()
    try:
        v6_lab_clahe = _clahe_lab_bgr(sharp.copy(), color_only=True)
    except Exception:
        v6_lab_clahe = sharp.copy()

    out = [v1_orig, sharp, v4_gray, v5_lab_clahe, v6_lab_clahe]
    # Optional second sharpening layer on every variant except the raw baseline (v1_orig).
    if _SCAN_VARIANT_SECOND_SHARPNESS > 0:
        for i in range(1, len(out)):
            out[i] = _unsharp_median_for_ocr(out[i].copy(), _SCAN_VARIANT_SECOND_SHARPNESS)
    return out


_VARIANT_LABELS = ["v1_orig", "v2_or_v3_sharp", "v4_gray", "v5_lab_clahe", "v6_lab_clahe"]


def _save_debug_variants(variants: List["np.ndarray"], frame_index: int, doc_type: str = "card") -> None:
    """Save full **card** alignment variants with zone boxes drawn to ``debug/variants/card/``.

    Passport MRZ uses only the combined strip; variant PNGs are ``f*_mrzroi_*`` via
    :func:`_save_debug_variants_plain`, not this function.

    Saves at most once per card scan session. Files: ``f{N}_v1_orig.png`` … (labels in ``_VARIANT_LABELS``).
    """
    global _debug_variants_saved_card
    doc = (doc_type or "card").strip().lower()
    if doc != "card":
        return
    if not DEBUG_ACTIVATE or not DEBUG_SAVE_VARIANTS or not HAS_OPENCV or _debug_variants_saved_card:
        return
    # Expect exactly 5 variants; otherwise skip saving.
    if len(variants) != 5:
        return
    try:
        ddir = _get_debug_variants_dir("card")
        ddir.mkdir(parents=True, exist_ok=True)
        for name, img in zip(_VARIANT_LABELS, variants):
            path = ddir / f"f{frame_index}_{name}.png"
            cv2.imwrite(str(path.resolve()), img)
        _debug_variants_saved_card = True
        logger.debug("Saved %d variant debug images (frame %d) to %s", len(variants), frame_index, ddir)
    except Exception as e:
        logger.debug("Could not save debug variants: %s", e)


def _save_debug_variants_plain(
    variants: List["np.ndarray"],
    frame_index: int,
    *,
    doc_type: str = "passport",
    tag: str = "mrz",
) -> None:
    """Save variant images without any rectangles/boxes.

    This is intended for "debug activate" so you can see what the OCR
    variants looked like on the ROI/band used for OCR, even when:
    - MRZ line detection fails
    - or later TD3/check-digit gating rejects the candidates
    """
    global _debug_mrz_plain_variants_saved_tags
    doc = (doc_type or "passport").strip().lower()
    if doc not in ("passport", "card"):
        doc = "passport"
    if not DEBUG_ACTIVATE or not DEBUG_SAVE_VARIANTS or not HAS_OPENCV:
        return
    # One save per (doc, tag, frame_index) so f1_mrzroi_* matches deskew_debug_*_frame_1 (not deduped across frames).
    save_key = f"{doc}:{tag}:f{frame_index}".strip()
    if save_key in _debug_mrz_plain_variants_saved_tags:
        return

    try:
        ddir = _get_debug_variants_dir(doc)
        ddir.mkdir(parents=True, exist_ok=True)

        if len(variants) == len(_VARIANT_LABELS):
            names = _VARIANT_LABELS
        else:
            names = [f"v{i+1}" for i in range(len(variants))]

        for name, img in zip(names, variants):
            path = ddir / f"f{frame_index}_{tag}_{name}.png"
            cv2.imwrite(str(path.resolve()), img)

        _debug_mrz_plain_variants_saved_tags.add(save_key)
    except Exception as e:
        logger.debug("Could not save plain debug variants: %s", e)


def _save_debug_passport_original_frame(frame: "np.ndarray", frame_index: Optional[int]) -> None:
    """Save the untouched passport camera frame for visual debugging."""
    if (
        frame is None
        or frame.size == 0
        or frame_index is None
        or not DEBUG_ACTIVATE
        or not HAS_OPENCV
    ):
        return
    try:
        ddir = _get_debug_variants_dir("passport")
        ddir.mkdir(parents=True, exist_ok=True)
        path = ddir / f"original_passport_frame_{frame_index}.png"
        cv2.imwrite(str(path.resolve()), frame)
    except Exception as e:
        logger.debug("Could not save original passport frame: %s", e)


def _shotgun_ocr(image: "np.ndarray") -> List[Tuple[str, float]]:
    """Run EasyOCR on a single image variant.

    Returns list of (raw_text, confidence) using EasyOCR's real confidence score.
    """
    results: List[Tuple[str, float]] = []
    if image is None or image.size == 0:
        return results
    reader = _get_easyocr_reader()
    if reader is not None:
        try:
            detections = reader.readtext(image, detail=1)
            for _bbox, txt, conf in detections:
                if txt and txt.strip():
                    results.append((txt.strip(), float(conf)))
        except Exception:
            pass
    return results


def _shotgun_ocr_mrz(image: "np.ndarray") -> List[Tuple[str, float, float]]:
    """OCR tuned for MRZ stitching.

    Same engines as _shotgun_ocr, but for EasyOCR also returns stitched line(s)
    by concatenating detections on the same visual line (sorted left→right).

    Each entry is (raw_text, confidence, mid_y) where *mid_y* is the vertical center
    of the detection or stitched row in **image pixel coordinates** (used to route
    fragments to TD3 Line 1 vs Line 2 pools on the combined MRZ strip).
    """
    results: List[Tuple[str, float, float]] = []
    if image is None or image.size == 0:
        return results

    reader = _get_easyocr_reader()
    if reader is None:
        return results

    try:
        dets = reader.readtext(image, detail=1)
    except Exception:
        return results

    blocks: List[Dict[str, Any]] = []
    for bbox, txt, conf in dets:
        if not txt or not str(txt).strip():
            continue
        try:
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x1, x2 = float(min(xs)), float(max(xs))
            y1, y2 = float(min(ys)), float(max(ys))
        except Exception:
            x1 = x2 = y1 = y2 = 0.0
        mid_y = (y1 + y2) / 2.0
        blocks.append(
            {
                "x1": x1,
                "x2": x2,
                "y1": y1,
                "y2": y2,
                "mid_y": mid_y,
                "h": max(1.0, y2 - y1),
                "text": str(txt).strip(),
                "conf": float(conf) if conf is not None else 0.0,
            }
        )
        # Keep the original detection too.
        results.append((str(txt).strip(), float(conf) if conf is not None else 0.0, mid_y))

    if not blocks:
        return results

    # Group by horizontal line (mid_y). Threshold based on median height.
    hs = sorted(b["h"] for b in blocks)
    median_h = hs[len(hs) // 2] if hs else 10.0
    # Be generous: EasyOCR can jitter y for split blocks on the same MRZ line.
    line_thresh = max(8.0, 1.2 * median_h)
    blocks.sort(key=lambda b: (b["mid_y"], b["x1"]))

    lines: List[List[Dict[str, Any]]] = []
    for b in blocks:
        placed = False
        for line in lines:
            ref_y = sum(x["mid_y"] for x in line) / max(len(line), 1)
            if abs(b["mid_y"] - ref_y) <= line_thresh:
                line.append(b)
                placed = True
                break
        if not placed:
            lines.append([b])

    # Build stitched string per line group.
    roi_w = float(image.shape[1]) if hasattr(image, "shape") else 0.0
    stitched_lines: List[Tuple[float, str, float]] = []  # (mid_y, text, avg_conf)
    for line in lines:
        line.sort(key=lambda b: b["x1"])
        parts: List[str] = []
        confs: List[float] = []
        prev_x2 = None
        for b in line:
            # Insert a single "<" when there's a clear horizontal gap between blocks.
            if prev_x2 is not None and roi_w > 0:
                gap = b["x1"] - prev_x2
                if gap > 0.04 * roi_w:
                    parts.append("<")
            parts.append(b["text"])
            confs.append(b["conf"])
            prev_x2 = b["x2"]
        stitched = "".join(parts).strip()
        if stitched:
            avg_conf = sum(confs) / max(len(confs), 1)
            row_mid_y = sum(b["mid_y"] for b in line) / max(len(line), 1)
            results.append((stitched, avg_conf, row_mid_y))
            stitched_lines.append((row_mid_y, stitched, avg_conf))

    # Special MRZ case: Line 1 can be split into two "rows" in EasyOCR output (y jitter),
    # e.g. "P<NGA...<<ADEBOYE" and "USMAN<<<<<", or "PPCAN...<<SARAH" and fragment.
    # If we see a TD3 Line 1 prefix (P< or P[A-Z]) plus a nearby no-digit chevron-heavy
    # line, also emit a merged candidate.
    try:
        p_line = None
        for my, txt, ac in stitched_lines:
            norm = _normalize_mrz_text_loose(txt)
            if _has_td3_line1_prefix(norm):
                p_line = (my, txt, ac)
                break
        if p_line and len(stitched_lines) >= 2:
            p_my, p_txt, p_conf = p_line
            # Find the closest line below with no digits (names), and some chevrons.
            best_other = None
            best_dy = None
            for my, txt, ac in stitched_lines:
                if my <= p_my:
                    continue
                if re.search(r"\d", txt):
                    continue
                if "<" not in txt and "<<" not in txt:
                    continue
                dy = my - p_my
                if best_dy is None or dy < best_dy:
                    best_dy = dy
                    best_other = (my, txt, ac)
            if best_other is not None and best_dy is not None:
                _, other_txt, other_conf = best_other
                merged = (p_txt.rstrip() + "<" + other_txt.lstrip()).strip()
                if merged:
                    # Anchor routing on the P< row so the merged string goes to the Line 1 pool.
                    results.append((merged, (p_conf + other_conf) / 2.0, p_my))
    except Exception:
        pass

    return results


def _mrz_combined_roi_bands_y(
    used_boxes: List[Tuple[int, int, int, int]],
    cy1: int,
    cy2: int,
) -> Tuple[Optional[Tuple[float, float]], Optional[Tuple[float, float]]]:
    """Map Pass-2 MRZ boxes to y-ranges inside the combined ROI (0 .. roi_h).

    Boxes are sorted top-to-bottom. Band boundaries meet near the midpoint between
    the bottom of the upper box and the top of the lower box so stitched-row *mid_y*
    routes to TD3 Line 1 vs Line 2 on the **same** combined strip.
    """
    if not used_boxes:
        return None, None
    roi_h = float(max(0, cy2 - cy1))
    if roi_h <= 0:
        return None, None
    sb = sorted(used_boxes, key=lambda b: (b[1], b[0]))
    if len(sb) >= 2:
        b0, b1 = sb[0], sb[1]
        y1_top = float(b0[1] - cy1)
        y1_bot = float(b0[3] - cy1)
        y2_top = float(b1[1] - cy1)
        y2_bot = float(b1[3] - cy1)
        mid = (y1_bot + y2_top) / 2.0
        slack = max(2.0, 0.02 * roi_h)
        band1 = (max(0.0, y1_top - 2.0), min(roi_h, mid + slack))
        band2 = (max(0.0, mid - slack), min(roi_h, y2_bot + 2.0))
        return band1, band2
    b = sb[0]
    y0 = max(0.0, float(b[1] - cy1))
    yb = min(roi_h, float(b[3] - cy1))
    if yb <= y0 + 5.0:
        return None, None
    mid = (y0 + yb) / 2.0
    slack = max(2.0, 0.02 * roi_h)
    return (y0, mid + slack), (max(0.0, mid - slack), yb)


def _mrz_clear_line2_only(text: str) -> bool:
    """True when the fragment is almost certainly TD3 Line 2 (exclude from Line 1 pool)."""
    loose = _normalize_mrz_text_loose(text or "")
    if not loose:
        return False
    if _find_td3_line1_start(loose) >= 0:
        return False
    b2 = _best_td3_line2_candidate(loose)
    if b2 is not None and b2[1] >= 2:
        return True
    digits = sum(1 for c in loose if c.isdigit())
    if digits >= 14:
        return True
    if digits >= 11 and loose.count("<") < 6:
        return True
    return False


def _mrz_clear_line1_only_fragment(text: str) -> bool:
    """True for P< / name / chevron fragments that belong to Line 1, not Line 2."""
    loose = _normalize_mrz_text_loose(text or "")
    if not loose:
        return False
    if _find_td3_line1_start(loose) >= 0:
        return True
    digits = sum(1 for c in loose if c.isdigit())
    if digits > 8:
        return False
    if re.search(r"[A-Z]", loose) and (loose.count("<") >= 2 or len(loose) >= 6):
        return True
    return False


def _mrz_fragment_looks_line1(text: str) -> bool:
    """Text gate: keep in Line 1 raw pool when geometry is ambiguous."""
    loose = _normalize_mrz_text_loose(text or "")
    if not loose:
        return False
    digits = sum(1 for c in loose if c.isdigit())
    if _find_td3_line1_start(loose) >= 0:
        return True
    b2 = _best_td3_line2_candidate(loose)
    if b2 is not None and b2[1] >= 3 and _find_td3_line1_start(loose) < 0:
        return False
    if digits >= 15 and _find_td3_line1_start(loose) < 0:
        return False
    if digits >= 10 and loose.count("<") < 4 and _find_td3_line1_start(loose) < 0:
        return False
    if re.search(r"[A-Z]", loose) and (loose.count("<") >= 3 or len(loose) >= 8):
        if digits <= 8:
            return True
    return False


def _mrz_fragment_looks_line2(text: str) -> bool:
    """Text gate: keep in Line 2 raw pool when geometry is ambiguous."""
    loose = _normalize_mrz_text_loose(text or "")
    if not loose:
        return False
    digits = sum(1 for c in loose if c.isdigit())
    if _best_td3_line2_candidate(loose) is not None:
        return True
    if digits >= 10 and len(loose) >= 15:
        return True
    if digits >= 8 and len(loose) >= 18 and _find_td3_line1_start(loose) < 0:
        return True
    return False


def _route_mrz_strip_item_to_pools(
    mid_y: float,
    text: str,
    band1: Optional[Tuple[float, float]],
    band2: Optional[Tuple[float, float]],
) -> Tuple[bool, bool]:
    """Route one OCR item into Line 1 and/or Line 2 pools (combined MRZ strip)."""
    c2_only = _mrz_clear_line2_only(text)
    c1_frag = _mrz_clear_line1_only_fragment(text)
    g1 = _mrz_fragment_looks_line1(text)
    g2 = _mrz_fragment_looks_line2(text)

    if band1 is None or band2 is None:
        return g1, g2

    in1 = band1[0] <= mid_y <= band1[1]
    in2 = band2[0] <= mid_y <= band2[1]

    if in1 and not in2:
        return (not c2_only) and (g1 or c1_frag), False
    if in2 and not in1:
        l2 = (not (c1_frag and not g2)) or (c2_only and not c1_frag)
        return False, l2
    if in1 and in2:
        return (not c2_only) and (g1 or c1_frag), (not (c1_frag and not g2)) or (c2_only and not c1_frag)
    # Gap / outside both bands: text-only split
    return g1, g2


def _shotgun_ocr_mrz_on_variant_images(
    variants: List["np.ndarray"],
    *,
    source_tag: str = "",
    line1_band: Optional[Tuple[float, float]] = None,
    line2_band: Optional[Tuple[float, float]] = None,
) -> Tuple[List[Tuple[str, float, str]], List[Tuple[str, float, str]]]:
    """Run MRZ-tuned EasyOCR on **pre-built** variant images (no detection, no re-crop).

    Pass 2 must already have produced the combined MRZ strip and ``_build_six_variants``
    must have been run **once** on that crop. This function only runs ``readtext`` per
    variant image — it does **not** repeat MRZ line detection or recompute the ROI.

    Returns ``(line1_pool, line2_pool)``: the same OCR run is **split** by vertical band
    (Pass-2 boxes mapped into the combined ROI) plus TD3-shaped text gates so Line 1 and
    Line 2 items are not duplicated across pools.
    """
    line1_pool: List[Tuple[str, float, str]] = []
    line2_pool: List[Tuple[str, float, str]] = []
    if not variants:
        return line1_pool, line2_pool
    t0 = time.perf_counter() if _OCR_TIMING else None
    prefix = f"{source_tag}/" if (source_tag or "").strip() else ""
    for label, v in zip(_VARIANT_LABELS, variants):
        vkey = f"{prefix}{label}"
        for txt, conf, mid_y in _shotgun_ocr_mrz(v):
            add1, add2 = _route_mrz_strip_item_to_pools(
                float(mid_y), txt, line1_band, line2_band
            )
            if add1:
                line1_pool.append((txt, float(conf), vkey))
            if add2:
                line2_pool.append((txt, float(conf), vkey))
    if _OCR_TIMING and t0 is not None:
        logger.info("[OCR_TIMING] shotgun_ocr_mrz_on_variant_images (5 variants): %.2fs", time.perf_counter() - t0)
    return line1_pool, line2_pool


def _shotgun_ocr_on_mrz_roi(
    roi: "np.ndarray",
    frame_index: int = 0,
    *,
    source_tag: str = "",
) -> List[Tuple[str, float, str]]:
    """MRZ ROI OCR: build variants from *roi* then run :func:`_shotgun_ocr_mrz_on_variant_images`.

    Prefer calling ``_build_six_variants`` once in the caller and
    ``_shotgun_ocr_mrz_on_variant_images`` when the same variants are also needed for
    debug saves (avoids building twice).

    Each returned entry is (raw_text, confidence, variant_label) where *variant_label* is
    ``"{source_tag}/{v#_name}"`` when *source_tag* is non-empty, else a label from
    ``_VARIANT_LABELS``.
    """
    if roi is None or roi.size == 0:
        return []
    variants = _build_six_variants(roi)
    l1, l2 = _shotgun_ocr_mrz_on_variant_images(variants, source_tag=source_tag)
    # Single ad-hoc ROI: no Pass-2 bands; merge text-gated Line 1 / Line 2 pools for callers.
    return l1 + l2


def _shotgun_ocr_on_roi(roi: "np.ndarray", frame_index: int = 0, save_debug: bool = False) -> List[Tuple[str, float]]:
    """Build 5 variants from the ROI and run OCR on every variant (EasyOCR-only).

    All 5 variants are OCR'd; combined pool aggregates EasyOCR results per ROI.
    When save_debug is True, saves f{N}_v1_orig.png ... f{N}_v6_lab_clahe.png once per doc type (first frame with a detected ROI).
    """
    if roi is None or roi.size == 0:
        return []
    variants = _build_six_variants(roi)
    if not variants:
        return []
    if save_debug:
        _save_debug_variants(variants, frame_index, doc_type="card")
    pool: List[Tuple[str, float]] = []
    t0 = time.perf_counter() if _OCR_TIMING else None
    for v in variants:
        pool.extend(_shotgun_ocr(v))
    if _OCR_TIMING and t0 is not None:
        logger.info("[OCR_TIMING] shotgun_ocr_on_roi (5 variants): %.2fs", time.perf_counter() - t0)
    return pool


def _shotgun_ocr_pan(image: "np.ndarray") -> List[Tuple[str, float]]:
    """OCR tuned for credit card PAN stitching.

    Same engines as _shotgun_ocr, but for EasyOCR also returns stitched digit
    rows: detection blocks on the same horizontal line that contain 3+ digits
    and no '/' are sorted left-to-right and concatenated, then all non-digit
    characters are stripped to produce a pure numeric PAN candidate.
    """
    results: List[Tuple[str, float]] = []
    if image is None or image.size == 0:
        return results

    reader = _get_easyocr_reader()
    if reader is None:
        return results

    try:
        dets = reader.readtext(image, detail=1)
    except Exception:
        return results

    blocks: List[Dict[str, Any]] = []
    for bbox, txt, conf in dets:
        if not txt or not str(txt).strip():
            continue
        txt_s = str(txt).strip()
        results.append((txt_s, float(conf) if conf is not None else 0.0))

        digit_count = sum(c.isdigit() for c in txt_s)
        if digit_count < 3 or "/" in txt_s:
            continue
        try:
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            x1, x2 = float(min(xs)), float(max(xs))
            y1, y2 = float(min(ys)), float(max(ys))
        except Exception:
            continue
        blocks.append({
            "x1": x1, "x2": x2,
            "mid_y": (y1 + y2) / 2.0,
            "h": max(1.0, y2 - y1),
            "text": txt_s,
            "conf": float(conf) if conf is not None else 0.0,
        })

    if not blocks:
        return results

    hs = sorted(b["h"] for b in blocks)
    median_h = hs[len(hs) // 2] if hs else 10.0
    line_thresh = max(8.0, 1.2 * median_h)
    blocks.sort(key=lambda b: (b["mid_y"], b["x1"]))

    rows: List[List[Dict[str, Any]]] = []
    for b in blocks:
        placed = False
        for row in rows:
            ref_y = sum(x["mid_y"] for x in row) / max(len(row), 1)
            if abs(b["mid_y"] - ref_y) <= line_thresh:
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])

    for row in rows:
        row.sort(key=lambda b: b["x1"])
        raw_concat = "".join(b["text"] for b in row)
        digits_only = re.sub(r"\D", "", raw_concat)
        if len(digits_only) >= 12:
            avg_conf = sum(b["conf"] for b in row) / max(len(row), 1)
            results.append((digits_only, avg_conf))

    return results


def _shotgun_ocr_on_pan_roi(roi: "np.ndarray", frame_index: int = 0) -> List[Tuple[str, float]]:
    """PAN-only ROI OCR: 5 preprocessing variants + digit-stitching EasyOCR."""
    if roi is None or roi.size == 0:
        return []
    variants = _build_six_variants(roi)
    if not variants:
        return []
    pool: List[Tuple[str, float]] = []
    t0 = time.perf_counter() if _OCR_TIMING else None
    for v in variants:
        pool.extend(_shotgun_ocr_pan(v))
    if _OCR_TIMING and t0 is not None:
        logger.info("[OCR_TIMING] shotgun_ocr_on_pan_roi (5 variants): %.2fs", time.perf_counter() - t0)
    return pool


# ---------------------------------------------------------------------------
# Stage 3: Strict gates (validation filters)
# ---------------------------------------------------------------------------

def _gate_pan(raw_pool: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Gate for card number: normalize, extract 12-19 digit runs, Luhn check.

    Returns list of (valid_pan_string, confidence) that pass all rules.
    """
    valid: List[Tuple[str, float]] = []
    for raw_text, conf in raw_pool:
        normalized = _normalize_ocr_digits_for_card(re.sub(r"\s+", "", raw_text).replace("-", ""))
        digit_runs = re.findall(r"\d{12,19}", normalized)
        all_digits = re.sub(r"\D", "", normalized)
        if not digit_runs and len(all_digits) >= 12:
            for length in (16, 15, 17, 14, 18, 13, 19, 12):
                if length > len(all_digits):
                    continue
                for i in range(len(all_digits) - length + 1):
                    digit_runs.append(all_digits[i: i + length])
        for seq in digit_runs:
            if _luhn_check(seq):
                valid.append((seq, conf))
            else:
                corrected = _try_correct_card_number_ocr(seq) if len(seq) == 16 else None
                if corrected:
                    valid.append((corrected, conf * 0.9))
    return valid


def _gate_expiry(raw_pool: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Gate for expiry: must parse to MM/YY with / and month 01-12."""
    valid: List[Tuple[str, float]] = []
    for raw_text, conf in raw_pool:
        for part in re.split(r"[\s\n]+", raw_text):
            parsed = (
                _parse_expiry_mm_yy(part)
                or _try_correct_expiry_ocr(part)
                or _try_correct_expiry_ocr(_normalize_expiry_ocr(part))
            )
            if parsed:
                valid.append((parsed, conf))
        parsed = (
            _parse_expiry_mm_yy(raw_text)
            or _try_correct_expiry_ocr(raw_text)
            or _try_correct_expiry_ocr(_normalize_expiry_ocr(raw_text))
        )
        if parsed:
            valid.append((parsed, conf))
    return valid


_NAME_BLOCKLIST = {
    "VISA",
    "MASTERCARD",
    "DEBIT",
    "CREDIT",
    "BANK",
    "PLATINUM",
    "WORLD",
    "REWARDS",
    # Common single-word card marketing terms / descriptors.
    "GOLD",
    "SILVER",
    "CLASSIC",
    "SIGNATURE",
    "INFINITE",
    "BUSINESS",
    "CORPORATE",
    "PREPAID",
    "VIRTUAL",
    "ELECTRONIC",
    "CONTACTLESS",
    # Example issuer / bank names that may appear alone on the card.
    "POSB",
    "DBS",
    "OCBC",
    "UOB",
}


def _gate_name(raw_pool: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Gate for cardholder name: no digits, letters/spaces/hyphens only, blocklist filtered."""
    valid: List[Tuple[str, float]] = []
    for raw_text, conf in raw_pool:
        for line in raw_text.splitlines():
            name = _normalize_cardholder_name_ocr(line)
            if not name:
                continue
            if re.search(r"\d", name):
                continue
            # Allow single-word names (e.g. JOLIE); rely on regex + blocklist below
            # to filter non-name marketing/brand text.
            if not re.match(r"^[A-Z\s\-']+$", name):
                continue
            tokens = set(name.split())
            if tokens and tokens <= _NAME_BLOCKLIST:
                continue
            valid.append((name, conf))
    return valid


def _gate_mrz(
    raw_pool: List[Tuple[str, float]],
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], Dict[str, int]]:
    """Separate raw OCR pool into TD3 Line 1 / Line 2 candidates.

    Returns (line1_candidates, valid_line2s, checksum_pass_count).
    - line1_candidates: 44-char TD3 Line 1 strings starting with P< or P[A-Z] (issuing state sanity-checked).
    - valid_line2s: 44-char TD3 Line 2 strings selected by checksum validation (doc#, DOB, expiry, final).
    - checksum_pass_count: {passport_id: count} where doc-number checksum passed (used as ID fallback).
    """
    checksum_pass_count: Dict[str, int] = {}

    line1_candidates: List[Tuple[str, float]] = []
    valid_line2s: List[Tuple[str, float]] = []

    # Each pool entry may contain fragments, multiple lines, or extra junk.
    # We normalize loosely, then extract TD3 candidates via windowing + checksum validation.
    for raw_text, conf in raw_pool:
        loose = _normalize_mrz_text_loose(raw_text or "")
        if not loose:
            continue

        # Line 1 candidates anchored at P< or P[A-Z] (e.g. PP).
        for l1 in _extract_td3_line1_candidates(loose):
            line1_candidates.append((l1, conf))

        # Best Line 2 candidate from this entry (if any); trim merged L2+L1 tail only for Line 2.
        loose_l2 = _trim_line2_loose_if_line1_concatenated(loose)
        best = _best_td3_line2_candidate(loose_l2)
        if best is None:
            continue
        l2, passed = best

        # At this point _best_td3_line2_candidate already enforced relaxed doc-number validity.
        doc_num = l2[0:9]
        passport_id = doc_num.replace("<", "").strip()
        if passport_id:
            checksum_pass_count[passport_id] = checksum_pass_count.get(passport_id, 0) + 1

        # Boost confidence slightly when more checks pass (helps avoid wrong stitches).
        boost = 0.85 + 0.15 * max(0, min(passed, 4)) / 4.0
        valid_line2s.append((l2, float(conf) * boost))

    return line1_candidates, valid_line2s, checksum_pass_count


def _gate_mrz_from_pools(
    line1_pool: List[Tuple[str, float, str]],
    line2_pool: List[Tuple[str, float, str]],
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], Dict[str, int]]:
    """TD3 MRZ gating using ROI-specific pools.

    This is more robust than a single combined pool because it lets us assemble TD3 line 1 and
    TD3 line 2 from OCR fragments that may appear as separate entries (e.g. "P<NGA..." and
    "USMAN<<<<<") within the *same* ROI.
    """
    checksum_pass_count: Dict[str, int] = {}
    line1_candidates: List[Tuple[str, float]] = []
    valid_line2s: List[Tuple[str, float]] = []
    issuer_hint: Optional[str] = None

    def _add_line1_from_loose(loose: str, conf: float) -> None:
        for l1 in _extract_td3_line1_candidates(loose):
            line1_candidates.append((l1, conf))

    def _add_line2_from_loose(loose: str, conf: float) -> None:
        loose = _trim_line2_loose_if_line1_concatenated(loose)
        if not loose:
            return
        best = _best_td3_line2_candidate(loose, issuer_hint=issuer_hint)
        if best is None:
            return
        l2, passed = best
        passport_id = l2[0:9].replace("<", "").strip()
        if passport_id:
            checksum_pass_count[passport_id] = checksum_pass_count.get(passport_id, 0) + 1
        boost = 0.85 + 0.15 * max(0, min(passed, 4)) / 4.0
        valid_line2s.append((l2, float(conf) * boost))

    # Per-entry extraction (baseline).
    for raw_text, conf, variant in line1_pool:
        loose = _normalize_mrz_text_loose(raw_text or "")
        if loose:
            w = float(conf) * _mrz_pool_variant_conf_scale(variant)
            _add_line1_from_loose(loose, w)
    issuer_hint = _majority_td3_issuer_from_line1_candidates(line1_candidates)
    for raw_text, conf, variant in line2_pool:
        loose = _normalize_mrz_text_loose(raw_text or "")
        if loose:
            loose = _trim_line2_loose_if_line1_concatenated(loose)
        if loose:
            w = float(conf) * _mrz_pool_variant_conf_scale(variant)
            _add_line2_from_loose(loose, w)

    # Cross-entry assembly within each ROI (top-N by confidence).
    # This helps when OCR splits line 1 across entries (e.g. P<... and USMAN...).
    try:
        top_l1 = sorted(
            (
                (_normalize_mrz_text_loose(t), float(c) * _mrz_pool_variant_conf_scale(_v))
                for t, c, _v in line1_pool
                if t
            ),
            key=lambda x: _mrz_l1_loose_merge_priority(x[0], x[1]),
            reverse=True,
        )[:8]
        top_l2 = sorted(
            (
                (
                    _trim_line2_loose_if_line1_concatenated(_normalize_mrz_text_loose(t)),
                    float(c) * _mrz_pool_variant_conf_scale(_v),
                )
                for t, c, _v in line2_pool
                if t
            ),
            key=lambda x: _mrz_l2_loose_merge_priority(x[0], x[1]),
            reverse=True,
        )[:8]
        top_l2 = [(s, c) for s, c in top_l2 if s]

        # Combined loose strings (acts like a "bag" of fragments).
        if top_l1:
            combined_l1 = "<".join(s for s, _ in top_l1 if s)
            _add_line1_from_loose(combined_l1, sum(c for _, c in top_l1) / max(len(top_l1), 1))
        issuer_hint = _majority_td3_issuer_from_line1_candidates(line1_candidates)
        # Optional **combined** Line-2 bag: joining fragments recreates the long string sliding-window
        # search needs when each OCR entry alone is too short (common with v3-style preprocessing).
        #
        # Risk: junk fragments (e.g. ``(<06``) plus good text can yield a *misaligned* 44-char window
        # that still passes checksum heuristics (e.g. doc ``3456AAOCA`` for CAN). Mitigation: keep
        # per-entry extraction above as the primary path; add this as an extra candidate source only,
        # omit **very short** pool entries from the join (they add length without MRZ structure and
        # shift sliding windows); refresh issuer after combined Line 1; use issuer-aware window
        # rejection in ``_best_td3_line2_candidate``; then ``_consensus_winning_mrz_lines`` votes on
        # document keys.
        if top_l2:
            top_l2_for_combine = [(s, c) for s, c in top_l2 if len(s or "") >= 12]
            if not top_l2_for_combine:
                top_l2_for_combine = list(top_l2)
            combined_l2 = "<".join(s for s, _ in top_l2_for_combine if s)
            _add_line2_from_loose(
                combined_l2,
                sum(c for _, c in top_l2_for_combine) / max(len(top_l2_for_combine), 1),
            )

        # Targeted pairwise stitch for line 1: TD3 anchor (P< or PP etc.) + name-only fragment.
        #
        # EasyOCR often reads "P<...<<ADEBOYE<<<<<<<<<<<<" or "PPCAN...<<SARAH<<<..."
        # and separately reads "USMAN<<<<". Naively appending puts the fragment beyond
        # 44 chars. Instead we *inject* the fragment into the first filler run ("<<<").
        p_frags = [(s, c) for s, c in top_l1 if "P" in s]
        name_frags = [
            (s, c)
            for s, c in top_l1
            if s and not _has_td3_line1_prefix(s) and not re.search(r"\d", s) and re.search(r"[A-Z]", s)
        ]

        def _inject_name_fragment(base44: str, frag: str) -> Optional[str]:
            if not base44 or len(base44) != 44 or not _has_td3_line1_prefix(base44):
                return None
            frag = (frag or "").strip("<")
            if not frag:
                return None
            run_idx = base44.find("<<<", 5)
            if run_idx < 0:
                run_idx = max(5, min(40, base44.rfind("<") if "<" in base44 else 40))
            injected = (base44[:run_idx] + "<" + frag + base44[run_idx:]).replace("<<<<<", "<<<<")
            return (injected[:44] + "<" * 44)[:44]

        for p_s, p_c in p_frags[:6]:
            base_cands = _extract_td3_line1_candidates(p_s)
            if not base_cands:
                continue
            base44 = base_cands[0]
            for n_s, n_c in name_frags[:10]:
                injected = _inject_name_fragment(base44, n_s)
                if injected and _is_plausible_td3_line1_candidate(injected):
                    line1_candidates.append((injected, (p_c + n_c) / 2.0))
    except Exception:
        pass

    return line1_candidates, valid_line2s, checksum_pass_count


# ---------------------------------------------------------------------------
# Stage 4: Confidence-weighted mass consensus vote
# ---------------------------------------------------------------------------

def _confidence_weighted_vote(bucket: List[Tuple[str, float]]) -> Tuple[Optional[str], float, int]:
    """Pick winner by highest sum of confidence scores (not raw frequency).

    Returns (winner_string, total_confidence, vote_count) or (None, 0.0, 0).
    """
    if not bucket:
        return None, 0.0, 0
    scores: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    for value, conf in bucket:
        scores[value] = scores.get(value, 0.0) + conf
        counts[value] = counts.get(value, 0) + 1
    winner = max(scores, key=scores.get)  # type: ignore[arg-type]
    return winner, scores[winner], counts[winner]


def _line2_document_key(l2: str) -> str:
    """Normalize TD3 Line 2 document field (positions 0-8) for cross-variant voting."""
    if not l2 or len(l2) < 9:
        return ""
    return (l2[0:9].replace("<", "").strip().upper())


def _majority_td3_issuer_from_line1_candidates(line1_cands: List[Tuple[str, float]]) -> Optional[str]:
    """Weighted majority issuing state (MRZ Line 1 indices 2-4, ICAO)."""
    scores: Dict[str, float] = {}
    for l1, conf in line1_cands:
        if not l1 or len(l1) < 5:
            continue
        issuer = l1[2:5].upper()
        if len(issuer) != 3 or not re.match(r"^[A-Z<]{3}$", issuer):
            continue
        issuer = issuer.replace("<", "")
        if len(issuer) < 3:
            continue
        scores[issuer] = scores.get(issuer, 0.0) + float(conf)
    if not scores:
        return None
    return max(scores, key=scores.get)  # type: ignore[arg-type]


def _td3_line2_doc_plausible_for_issuer(doc_key: str, issuer: Optional[str]) -> bool:
    """Reject misaligned 44-char windows that still satisfy checksum heuristics.

    Canadian passports (issuer ``CAN``) use MRZ document numbers that virtually always start with a
    letter (typically ``P``). A key like ``3456AAOCA`` is almost always a sliding-window artifact.
    """
    if not doc_key or not issuer:
        return True
    if issuer == "CAN":
        if doc_key[0].isdigit():
            return False
    return True


def _filter_valid_line2_by_issuer(
    valid_l2s: List[Tuple[str, float]],
    issuer: Optional[str],
) -> List[Tuple[str, float]]:
    if not valid_l2s or not issuer:
        return valid_l2s
    filtered = [
        (l2, c)
        for l2, c in valid_l2s
        if _td3_line2_doc_plausible_for_issuer(_line2_document_key(l2), issuer)
    ]
    return filtered if filtered else valid_l2s


def _consensus_winning_mrz_lines(
    line1_cands: List[Tuple[str, float]],
    valid_l2s: List[Tuple[str, float]],
) -> Tuple[Optional[str], Optional[str]]:
    """Consensus Line 1 + Line 2 with issuer-aware Line 2 filtering and document-key voting.

    Voting on **full 44-char Line 2 strings** splits mass across harmless alignment differences and
    lets rare bogus windows win. We instead:

    1. Pick winning Line 1 via confidence-weighted vote (unchanged).
    2. Infer ICAO issuer (3 letters) from weighted Line 1 candidates; filter Line 2 rows whose
       document field contradicts issuer rules (e.g. CAN + digit-leading doc key).
    3. Confidence-weighted vote on **normalized document keys** (Line 2 chars 0-8).
    4. Choose the **single Line 2 row** with that key and highest confidence (stable decode).
    """
    winning_l1, _, _ = _confidence_weighted_vote(line1_cands)
    issuer = _majority_td3_issuer_from_line1_candidates(line1_cands)
    if issuer is None and winning_l1 and len(winning_l1) >= 5:
        cand = winning_l1[2:5].upper().replace("<", "")
        if len(cand) == 3:
            issuer = cand

    v2 = _filter_valid_line2_by_issuer(valid_l2s, issuer)

    id_bucket: List[Tuple[str, float]] = [
        (dk, float(c))
        for l2, c in v2
        if (dk := _line2_document_key(l2))
    ]
    winning_doc, _, _ = _confidence_weighted_vote(id_bucket)

    if not winning_doc:
        winning_l2, _, _ = _confidence_weighted_vote(v2)
        return winning_l1, winning_l2

    matching = [(l2, c) for l2, c in v2 if _line2_document_key(l2) == winning_doc]
    if not matching:
        winning_l2, _, _ = _confidence_weighted_vote(v2)
        return winning_l1, winning_l2

    matching.sort(key=lambda t: t[1], reverse=True)
    winning_l2 = matching[0][0]
    return winning_l1, winning_l2


def _debug_print_mrz_raw_ocr_pools(
    line1_pool: List[Tuple[str, float, str]],
    line2_pool: List[Tuple[str, float, str]],
    *,
    frame_index: Optional[int] = None,
    max_lines_per_side: int = 120,
) -> None:
    """When DEBUG_ACTIVATE, print every raw MRZ OCR fragment with its variant label."""
    if not DEBUG_ACTIVATE:
        return
    fi = frame_index if frame_index is not None else "?"
    print(f"\n--- MRZ raw OCR (frame {fi}) — variant tagged ---", file=sys.stderr, flush=True)
    for side_name, pool in (("line1_pool", line1_pool), ("line2_pool", line2_pool)):
        print(f"  [{side_name}] {len(pool)} entr(y/ies)", file=sys.stderr, flush=True)
        for i, (txt, conf, vkey) in enumerate(pool[:max_lines_per_side], 1):
            snippet = (txt or "").replace("\n", " ").strip()
            if len(snippet) > 120:
                snippet = snippet[:117] + "..."
            print(f"    {i:3d}. [{vkey}] conf={conf:.3f}  {snippet!r}", file=sys.stderr, flush=True)
        if len(pool) > max_lines_per_side:
            print(f"    ... ({len(pool) - max_lines_per_side} more omitted)", file=sys.stderr, flush=True)


def _print_consensus(
    label: str,
    bucket: List[Tuple[str, float]],
    winner: Optional[str],
    *,
    value_actual_counts: Optional[Dict[str, int]] = None,
    raw_pool_size: int = 0,
) -> None:
    """Print a ranked consensus table for a field.

    value_actual_counts: optional dict mapping value -> count of 'actual' occurrences
    (e.g. check-digit passes for passport ID). Shown to clarify vote(s) when each
    valid read is paired with many candidates (vote count = actual × pairings).
    raw_pool_size: total raw OCR candidates before gating (shown when bucket is empty).
    """
    if not DEBUG_ACTIVATE:
        return
    if not bucket:
        print(f"\n--- {label} consensus ---", file=sys.stderr, flush=True)
        print(f"  (no candidates passed gating — {raw_pool_size} raw pool entries)", file=sys.stderr, flush=True)
        return
    scores: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    for value, conf in bucket:
        scores[value] = scores.get(value, 0.0) + conf
        counts[value] = counts.get(value, 0) + 1
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    print(f"\n--- {label} consensus ---", file=sys.stderr, flush=True)
    for i, (val, score) in enumerate(ranked[:8], 1):
        mark = " [SELECTED]" if val == winner else ""
        vote_str = f"score={score:.2f}, {counts[val]} vote(s)"
        if value_actual_counts is not None and val in value_actual_counts:
            vote_str += f", {value_actual_counts[val]} check-digit pass(es)"
        print(f"  {i}. {val} ({vote_str}){mark}", file=sys.stderr, flush=True)
    if winner:
        win_vote = f"score={scores.get(winner, 0):.2f}, {counts.get(winner, 0)} vote(s)"
        if value_actual_counts is not None and winner in value_actual_counts:
            win_vote += f", {value_actual_counts[winner]} check-digit pass(es)"
        print(f"  -> Selected {label}: {winner} ({win_vote})", file=sys.stderr, flush=True)


def _normalize_expiry_ocr(text: str) -> str:
    """Normalize OCR output for expiry: O/l/I to 0/1 in digit positions, - to /."""
    if not text:
        return text
    s = re.sub(r"\s+", "", text)
    s = s.replace("-", "/").replace(" ", "")
    for old, new in (("O", "0"), ("o", "0"), ("l", "1"), ("|", "1"), ("I", "1"), ("i", "1")):
        s = s.replace(old, new)
    return s


def _try_correct_expiry_ocr(raw: str) -> Optional[str]:
    """Try common OCR digit confusions to get a valid MM/YY from raw text."""
    parsed = _parse_expiry_mm_yy(raw)
    if parsed:
        return parsed
    normalized = _normalize_expiry_ocr(raw)
    parsed = _parse_expiry_mm_yy(normalized)
    if parsed:
        return parsed
    m = re.search(r"(\d|[OolI])(\d|[OolI])[/\-\s]*(\d|[OolI])(\d|[OolI])", normalized)
    if not m:
        return None
    mm_c = m.group(1) + m.group(2)
    yy_c = m.group(3) + m.group(4)
    for a, b in (("O", "0"), ("o", "0"), ("l", "1"), ("I", "1")):
        mm_c = mm_c.replace(a, b)
        yy_c = yy_c.replace(a, b)
    if not (mm_c.isdigit() and yy_c.isdigit()):
        return None
    confusions = {"0": "8", "1": "7", "7": "1", "8": "0", "5": "6", "6": "5", "3": "8", "2": "7"}
    for i in range(2):
        for j in range(2):
            for orig, repl in confusions.items():
                mm_try = mm_c[:i] + repl + mm_c[i + 1:] if mm_c[i] == orig else mm_c
                yy_try = yy_c[:j] + repl + yy_c[j + 1:] if yy_c[j] == orig else yy_c
                if 1 <= int(mm_try) <= 12:
                    candidate = f"{mm_try}/{yy_try}"
                    if _parse_expiry_mm_yy(candidate):
                        return candidate
    if 1 <= int(mm_c) <= 12:
        return f"{mm_c}/{yy_c}"
    return None


# Letter-like OCR confusions for cardholder name (digit/symbol -> letter)
_NAME_OCR_TO_LETTER = {
    "0": "O", "1": "I", "5": "S", "8": "B", "6": "G", "4": "A",
    "|": "I", "§": "S", "¢": "C", "®": "R", "©": "C",
}


def _normalize_cardholder_name_ocr(text: str) -> str:
    """Post-process OCR for cardholder name: fix common confusions, letters/spaces only, collapse spaces."""
    if not text:
        return ""
    s = text.strip()
    for sym, letter in _NAME_OCR_TO_LETTER.items():
        s = s.replace(sym, letter)
    s = re.sub(r"[^a-zA-Z\s]", "", s)
    s = " ".join(s.split())
    return s.upper() if s else ""


def _get_card_zone(card_image: "np.ndarray", x1_frac: float, y1_frac: float, x2_frac: float, y2_frac: float) -> "np.ndarray":
    """Extract a region of the card image by fractional bounds (0-1). Returns the ROI."""
    h, w = card_image.shape[:2]
    x1 = max(0, int(w * x1_frac))
    y1 = max(0, int(h * y1_frac))
    x2 = min(w, int(w * x2_frac))
    y2 = min(h, int(h * y2_frac))
    if x2 <= x1 or y2 <= y1:
        return card_image
    return card_image[y1:y2, x1:x2].copy()


def _normalize_mrz_line(s: str) -> str:
    """Force string to MRZ charset [A-Z0-9<] and length 44 (pad or trim)."""
    if not s:
        return ""
    s = s.upper().replace(" ", "<")
    s = re.sub(r"[^A-Z0-9<]", "", s)
    if len(s) > 44:
        return s[:44]
    return s + "<" * (44 - len(s))


def _parse_mrz_td3(line1: str, line2: str) -> Tuple[Optional[str], Optional[str]]:
    """Parse ICAO 9303 TD3 MRZ. Returns (passport_id, guest_name).

    Line 1 (44 chars): P + type/filler (< or letter, e.g. PP), positions 2-4 = country, positions 5-43 = name.
    Name block format: SURNAME<<GIVEN1<GIVEN2<...<<<
      - Surname before first \"<<\"; given names after, with single \"<\" as separator (e.g. ADEBOYE<USMAN).
    Line 2: positions 1-9 = document number, 10 = check digit, etc.
    """
    if not line1 or not line2 or len(line1) < 44 or len(line2) < 44:
        return None, None
    # Line 1 positions 6-44: primary identifier = surname<<given names (single < = space between given names)
    name_field = (line1[5:44] or "").strip("<")
    surname_given = name_field.split("<<", 1)
    surname = (surname_given[0] or "").replace("<", " ").strip()
    given = (surname_given[1] if len(surname_given) > 1 else "").replace("<", " ").strip()
    # Collapse multiple spaces (e.g. from << inside given names)
    surname = re.sub(r"\s+", " ", surname).strip()
    given = re.sub(r"\s+", " ", given).strip()
    guest_name = f"{given} {surname}".strip() if given else surname
    if not guest_name:
        guest_name = None
    # Line 2 positions 1-9 = document number
    passport_id = (line2[0:9] or "").replace("<", "").strip()
    if not passport_id:
        passport_id = None
    return passport_id, guest_name


def _decode_mrz_winners(
    winning_l1: Optional[str],
    winning_l2: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    """Decode passport_id and guest_name from the two consensus-winning MRZ lines."""
    if winning_l1 and winning_l2 and len(winning_l1) >= 44 and len(winning_l2) >= 44:
        return _parse_mrz_td3(winning_l1, winning_l2)
    if winning_l2 and len(winning_l2) >= 9:
        pid = winning_l2[0:9].replace("<", "").strip() or None
        return pid, None
    return None, None


def _debug_print_mrz_winner(
    winning_l1: Optional[str],
    winning_l2: Optional[str],
    passport_id: Optional[str],
    guest_name: Optional[str],
) -> None:
    """Verbose console debug: show consensus-winning MRZ lines and parsed fields."""
    if not MRZ_DEBUG_VERBOSE or not DEBUG_ACTIVATE:
        return

    if not winning_l1 and not winning_l2:
        print("\n[MRZ_DEBUG] No winning MRZ lines from consensus.", file=sys.stderr, flush=True)
        return

    print("\n=== MRZ winner (consensus) ===", file=sys.stderr, flush=True)
    print(f"L1: {winning_l1 or '[none]'}", file=sys.stderr, flush=True)
    print(f"L2: {winning_l2 or '[none]'}", file=sys.stderr, flush=True)

    if not (winning_l1 and winning_l2 and len(winning_l1) >= 44 and len(winning_l2) >= 44):
        print("[MRZ_DEBUG] Cannot parse structured MRZ fields (need two 44-char lines).", file=sys.stderr, flush=True)
        print(f"  -> passport_id used : {passport_id or '-'}", file=sys.stderr, flush=True)
        print(f"  -> guest_name used  : {guest_name or '-'}", file=sys.stderr, flush=True)
        return

    # Use normalized 44-character lines for parsing.
    l1 = _normalize_mrz_line(winning_l1)
    l2 = _normalize_mrz_line(winning_l2)

    # Line 1
    doc_type = l1[0:2]
    issuing_state = l1[2:5]
    name_field = (l1[5:44] or "").strip("<")
    surname_given = name_field.split("<<", 1)
    surname = (surname_given[0] or "").replace("<", " ").strip()
    given = (surname_given[1] if len(surname_given) > 1 else "").replace("<", " ").strip()
    surname = re.sub(r"\s+", " ", surname).strip()
    given = re.sub(r"\s+", " ", given).strip()
    parsed_guest_name = f"{given} {surname}".strip() if given else surname
    if not parsed_guest_name:
        parsed_guest_name = None

    # Line 2 basic fields
    doc_number_raw = l2[0:9]
    doc_number = doc_number_raw.replace("<", "").strip()
    doc_number_cd = l2[9]
    nationality = l2[10:13]
    dob_raw = l2[13:19]
    dob_cd = l2[19]
    sex = l2[20]
    expiry_raw = l2[21:27]
    expiry_cd = l2[27]
    optional_data = l2[28:42]
    final_cd = l2[43]

    def _cd_status(field: str, digit_ch: str, full_field: Optional[str] = None) -> str:
        """Return human-readable check-digit status for debug output."""
        if not digit_ch.isdigit():
            return f"{digit_ch} (non-digit, cannot verify)"
        expected = _mrz_check_digit(field)
        if expected == int(digit_ch):
            return f"{digit_ch} (OK)"
        return f"{digit_ch} (FAIL, expected {expected})"

    doc_number_cd_status = _cd_status(l2[0:9], doc_number_cd)
    dob_cd_status = _cd_status(dob_raw, dob_cd)
    expiry_cd_status = _cd_status(expiry_raw, expiry_cd)
    # Final check digit uses concatenation of several fields (ICAO 9303).
    final_field = l2[0:10] + l2[13:20] + l2[21:43]
    final_cd_status = _cd_status(final_field, final_cd)

    print("\n=== MRZ fields decoded from winner ===", file=sys.stderr, flush=True)
    print(f"  Document type     : {doc_type}", file=sys.stderr, flush=True)
    print(f"  Issuing state     : {issuing_state}", file=sys.stderr, flush=True)
    print(f"  Surname           : {surname or '-'}", file=sys.stderr, flush=True)
    print(f"  Given names       : {given or '-'}", file=sys.stderr, flush=True)
    print(f"  Guest name (MRZ)  : {parsed_guest_name or '-'}", file=sys.stderr, flush=True)
    print(f"  Passport number   : {doc_number or '-'}  (check digit {doc_number_cd_status})", file=sys.stderr, flush=True)
    print("\n  -> passport_id used : {}".format(passport_id or "-"), file=sys.stderr, flush=True)
    print("  -> guest_name used  : {}".format(guest_name or "-"), file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# MRZ Checksum Engine (ICAO 9303 modulus-10 with 7-3-1 weighting)
# ---------------------------------------------------------------------------

_PASSPORT_MASS_VOTE_MIN = 10  # If this many shotgun results pass doc checksum for same ID, use as winner.


def _passport_id_mrz_likeness(pid: str) -> int:
    """Prefer IDs that look like ICAO MRZ document numbers (often start with a letter, alphanumeric).
    Returns 2 if starts with A-Z, 1 if contains any letter, 0 if all digits. Used to break ties."""
    if not pid:
        return 0
    pid = pid.strip().upper()
    if not pid:
        return 0
    if pid[0].isalpha():
        return 2
    if any(c.isalpha() for c in pid):
        return 1
    return 0


_MRZ_CHAR_VALUE = {str(d): d for d in range(10)}
_MRZ_CHAR_VALUE.update({chr(ord("A") + i): 10 + i for i in range(26)})
_MRZ_CHAR_VALUE["<"] = 0
_MRZ_WEIGHTS = [7, 3, 1]


def _mrz_check_digit(field: str) -> int:
    """Compute ICAO 9303 check digit for a field string using 7-3-1 weighting."""
    total = 0
    for i, ch in enumerate(field):
        total += _MRZ_CHAR_VALUE.get(ch, 0) * _MRZ_WEIGHTS[i % 3]
    return total % 10


def _normalize_mrz_prefix(s: str, length: int) -> str:
    """Normalize string to MRZ charset and pad/trim to length. Used for first-10 extraction."""
    if not s:
        return "<" * length
    s = s.upper().replace(" ", "<")
    s = re.sub(r"[^A-Z0-9<]", "", s)
    if len(s) > length:
        return s[:length]
    return s + "<" * (length - len(s))


def _extract_and_verify_passport_number(line2_prefix: str) -> Tuple[str, str, str, bool]:
    """ICAO position-based extraction: first 10 chars of Line 2; positions 1-9 = ID, 10 = check digit.

    Returns (raw_10, parsed_id, check_digit_char, match). Only match is True when 7-3-1 agrees with pos 10.
    """
    raw_10 = _normalize_mrz_prefix(line2_prefix[:10] if line2_prefix else "", 10)
    field_9 = raw_10[0:9]
    parsed_id = (field_9 or "").replace("<", "").strip()
    check_digit_char = raw_10[9] if len(raw_10) > 9 else "<"
    try:
        expected = _mrz_check_digit(field_9)
        actual = int(check_digit_char) if check_digit_char.isdigit() else None
        match = actual is not None and expected == actual
    except (ValueError, TypeError):
        match = False
    return (raw_10, parsed_id, check_digit_char, match)


_CHECK_DIGIT_LETTER_TO_DIGIT = {
    "O": "0", "D": "0", "Q": "0",
    "I": "1", "L": "1",
    "Z": "2",
    "S": "5",
    "G": "6",
    "T": "7",
    "B": "8",
}


def _try_passport_check_digit_o0(line2_prefix: str) -> Optional[Tuple[str, str, str, bool]]:
    """If document-number checksum fails, try OCR confusions at position 10.

    Strategy:
      1. O/0 swap (original).
      2. Common letter→digit confusions at position 10.
      3. If position 10 is a letter with no obvious digit match, compute the expected
         check digit from positions 1-9 and accept the ID if the parsed doc number
         looks like a real passport ID (contains at least one digit and one letter).
    """
    raw_10, parsed_id, check_digit_char, match = _extract_and_verify_passport_number(line2_prefix)
    if match:
        return (raw_10, parsed_id, check_digit_char, True)
    if len(raw_10) < 10:
        return None

    ch10 = raw_10[9]
    field_9 = raw_10[0:9]

    # Try known letter→digit confusions at position 10
    if ch10 in _CHECK_DIGIT_LETTER_TO_DIGIT:
        candidate = field_9 + _CHECK_DIGIT_LETTER_TO_DIGIT[ch10]
        r10, pid, cd, ok = _extract_and_verify_passport_number(candidate)
        if ok:
            return (r10, pid, cd, True)

    # If pos 10 is a letter (not a digit), the OCR likely merged/misread the check
    # digit. Compute expected check digit from positions 1-9 and accept the ID if
    # it looks like a plausible passport number (has both letters and digits).
    if ch10.isalpha() and parsed_id:
        has_digit = any(c.isdigit() for c in parsed_id)
        has_letter = any(c.isalpha() for c in parsed_id)
        if has_digit and has_letter and len(parsed_id) >= 5:
            try:
                expected = _mrz_check_digit(field_9)
                corrected_raw = field_9 + str(expected)
                return (corrected_raw, parsed_id, str(expected), True)
            except (ValueError, TypeError):
                pass

    return (raw_10, parsed_id, check_digit_char, False)


def _mrz_verify_checksums(line2: str) -> Tuple[int, int]:
    """Verify TD3 line-2 checksums: doc number, DOB, expiry, composite.

    Returns (checks_passed, checks_total). checks_total is 4.
    """
    if len(line2) < 44:
        return 0, 4
    passed = 0
    doc_num = line2[0:9]
    doc_check = line2[9]
    if doc_check.isdigit() and _mrz_check_digit(doc_num) == int(doc_check):
        passed += 1
    dob = line2[13:19]
    dob_check = line2[19]
    if dob_check.isdigit() and _mrz_check_digit(dob) == int(dob_check):
        passed += 1
    expiry = line2[21:27]
    exp_check = line2[27]
    if exp_check.isdigit() and _mrz_check_digit(expiry) == int(exp_check):
        passed += 1
    composite_field = line2[0:10] + line2[13:20] + line2[21:43]
    composite_check = line2[43]
    if composite_check.isdigit() and _mrz_check_digit(composite_field) == int(composite_check):
        passed += 1
    return passed, 4


def _normalize_mrz_text_loose(s: str) -> str:
    """Normalize OCR output to MRZ charset without forcing length.

    - Uppercase
    - Whitespace becomes "<" (MRZ filler)
    - Drop any non [A-Z0-9<]
    """
    if not s:
        return ""
    s = s.upper()
    s = re.sub(r"\s+", "<", s)
    s = re.sub(r"[^A-Z0-9<]", "", s)
    return s


def _has_td3_line1_prefix(s: str) -> bool:
    """True when *s* starts with a valid ICAO 9303 TD3 Line 1 header.

    Position 0 must be 'P' (passport document type).
    Position 1 may be '<' (no subtype) **or** an uppercase letter (subtype,
    e.g. 'P' for Canadian passports → "PP").
    """
    return len(s) >= 2 and s[0] == "P" and (s[1] == "<" or s[1].isalpha())


def _find_td3_line1_start(s: str) -> int:
    """Return the index of the first valid TD3 Line 1 prefix in *s*, or -1."""
    for i, ch in enumerate(s):
        if ch == "P" and i + 1 < len(s) and (s[i + 1] == "<" or s[i + 1].isupper()):
            return i
    return -1


def _trim_line2_loose_if_line1_concatenated(loose: str) -> str:
    """Drop a trailing Line 1 blob when OCR merged Line 2 + Line 1 in one read.

    Example: ``P123456AA0CAN...00PPCANHARTIN<<SARAH...`` — sliding-window Line 2
    extraction on the full string picks a wrong 44-char slice. Keeping only the
    prefix before the embedded ``PPCAN...`` anchor fixes validation without
    requiring 3+/4 checksum passes.
    """
    if not loose or len(loose) < 15:
        return loose
    j = _find_td3_line1_start(loose)
    if j <= 0:
        return loose
    seg44 = (loose[j : j + 44] + "<" * 44)[:44]
    if not _has_td3_line1_prefix(seg44):
        return loose
    if not re.match(r"^P[<A-Z][A-Z]{3}", seg44):
        return loose
    return loose[:j]


def _line2_window_tiebreak_score(w: str) -> Tuple[int, int]:
    """Prefer TD3-like doc numbers (often start with a letter, e.g. P123456AA)."""
    if not w or len(w) < 9:
        return (0, 0)
    letter_start = 1 if w[0].isalpha() else 0
    fill = sum(1 for c in w[0:9] if c != "<")
    return (letter_start, fill)


# TD3 Line 1: positions 5..43 are the name field (letters + '<' mostly). Line 2 is digit-heavy;
# merged OCR often smears Line 2 patterns into a bogus "Line 1" window.
_TD3_LINE1_NAME_MAX_DIGIT_COUNT = 4


def _td3_line1_name_field_digit_count(l1_44: str) -> int:
    """Count digit characters in TD3 Line 1 name field (indices 5..43 inclusive)."""
    if len(l1_44) < 44:
        return 99
    return sum(1 for c in l1_44[5:44] if c.isdigit())


def _td3_line1_has_obvious_line2_leakage(l1_44: str) -> bool:
    """True when *l1_44* embeds patterns that belong on TD3 Line 2 (merged-line OCR).

    Heuristics (name field only, after issuing state):
    - YYMMDD + check + sex + YYMMDD blocks typical of Line 2.
    - Long runs of digits (doc #, dates, optional data).
    - Document-number style \"P\" + long digit run (common when Line 2 is concatenated).
    """
    if len(l1_44) != 44:
        return False
    nf = l1_44[5:44]
    # Line 2: DOB (6) + check + sex + expiry (6) — should not appear inside Line 1 names.
    if re.search(r"\d{6}[0-9<][MF<]\d{6}", nf):
        return True
    # Five+ consecutive digits are rare in names; common in merged Line 2.
    if re.search(r"\d{5,}", nf):
        return True
    # Merged passport Line 2 often starts with a P-type doc number + many digits.
    if re.search(r"P\d{6,}", nf):
        return True
    return False


def _is_plausible_td3_line1_candidate(cand: str) -> bool:
    """False when a 44-char TD3 Line 1 window is clearly contaminated by Line 2 or too digit-heavy."""
    if len(cand) != 44 or not _has_td3_line1_prefix(cand):
        return False
    if _td3_line1_has_obvious_line2_leakage(cand):
        return False
    if _td3_line1_name_field_digit_count(cand) > _TD3_LINE1_NAME_MAX_DIGIT_COUNT:
        return False
    return True


def _extract_td3_line1_candidates(loose: str) -> List[str]:
    """Extract possible TD3 line 1 candidates (44 chars starting with P< or P[A-Z]) from a loose string."""
    if not loose:
        return []
    cands: List[str] = []
    # Find the first valid TD3 Line 1 anchor (P< or P[A-Z], e.g. PP for Canada).
    start = _find_td3_line1_start(loose)
    if start < 0:
        return []
    # Take a small set of start offsets around the anchor to be robust to OCR jitter.
    for off in (0, -1, 1, -2, 2):
        i = start + off
        if i < 0 or i >= len(loose):
            continue
        seg = loose[i : i + 60]
        if not seg:
            continue
        # Re-anchor within the segment if possible.
        j = _find_td3_line1_start(seg)
        if j >= 0:
            seg = seg[j:]
        # Candidate = first 44 chars, pad if short.
        cand = (seg[:44] + "<" * 44)[:44]
        if not _has_td3_line1_prefix(cand):
            continue
        # Basic TD3 sanity: positions 2-4 are issuing state (3 uppercase letters).
        if not re.match(r"^P[<A-Z][A-Z]{3}", cand):
            continue
        if not _is_plausible_td3_line1_candidate(cand):
            continue
        cands.append(cand)
    # De-dup while preserving order
    out: List[str] = []
    seen: Set[str] = set()
    for c in cands:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _best_td3_line2_candidate(
    loose: str,
    *,
    issuer_hint: Optional[str] = None,
) -> Optional[Tuple[str, int]]:
    """Pick the best 44-char TD3 line 2 candidate from a loose string.

    Returns (line2, checks_passed) or None.

    EasyOCR often returns Line 2 *shorter than 44 characters* (missing trailing ``<``
    fillers). Previously we returned None immediately, so good reads like
    ``P123456AA0CAN9008010...`` never reached checksum validation. ICAO pads with ``<``;
    we pad short strings to 44 and score that window like any other.

    issuer_hint: when ``CAN``, skip windows whose document field (chars 0–8) normalizes to a
    digit-leading key — those are almost always misaligned slices on stitched OCR (e.g.
    ``3456AAOCA``), while genuine Canadian passport numbers start with a letter (``P...``).
    """
    if not loose or len(loose) < 20:
        return None

    # OCR often puts letters (K, I, l) inside filler runs that must be '<'.
    loose = _sanitize_td3_line2_loose_filler(loose)

    # Build windows of length 44 from the loose string and pick the one with the best
    # checksum score after corrections. We additionally allow "relaxed" doc-number
    # checksum acceptance when the check digit character was misread as a letter.
    best: Optional[str] = None
    best_passed = -1
    best_doc_ok = False

    windows: List[str] = []
    if len(loose) >= 44:
        max_starts = min(len(loose) - 44, 120)  # cap work per entry
        for i in range(max_starts + 1):
            windows.append(loose[i : i + 44])
    else:
        # Single candidate: pad with MRZ filler to full TD3 line length.
        windows.append((loose + "<" * 44)[:44])

    for w in windows:
        if len(w) != 44:
            continue
        w = _apply_td3_line2_digit_zone_ocr_map(w)
        # Fast reject: Line 2 should not look like a Line 1 header (P< or PP etc.)
        if _has_td3_line1_prefix(w):
            continue
        # Try to improve digit positions (O->0 etc) and evaluate checksums.
        w2 = _mrz_try_single_char_corrections(w) or w
        passed, _ = _mrz_verify_checksums(w2)

        # Relaxed doc-number check: accept if we can compute/repair the doc check digit.
        doc_ok = False
        try:
            o0 = _try_passport_check_digit_o0(w2[0:10])
            doc_ok = bool(o0 and o0[3])
            if doc_ok and passed < 1:
                # If doc checksum was the only thing failing due to a non-digit CD, treat it as a pass signal.
                passed = 1
            # If we repaired the 10th char, reflect that in the candidate string.
            if o0 and o0[3]:
                corrected_raw10 = o0[0]  # 10 chars with corrected check digit when possible
                if corrected_raw10 and len(corrected_raw10) == 10:
                    w2 = corrected_raw10 + w2[10:]
        except Exception:
            pass

        if issuer_hint == "CAN":
            dk = _line2_document_key(w2)
            if dk and dk[0].isdigit():
                continue

        take = False
        if passed > best_passed:
            take = True
        elif passed == best_passed and doc_ok and not best_doc_ok:
            take = True
        elif passed == best_passed and doc_ok == best_doc_ok and best is not None:
            if _line2_window_tiebreak_score(w2) > _line2_window_tiebreak_score(best):
                take = True

        if take:
            best_passed = passed
            best_doc_ok = doc_ok
            best = w2
            if best_passed == 4 and best_doc_ok:
                break

    if best is None:
        return None
    # Require at least checksum strength to avoid stitching the wrong line.
    if not best_doc_ok:
        return None
    # Require at least 2 of 4 TD3 checksum checks (doc / DOB / expiry / composite).
    if best_passed < 2:
        return None
    return best, best_passed


_MRZ_OCR_CORRECTIONS = {
    "O": "0", "D": "0", "Q": "0",
    "I": "1", "L": "1", "l": "1",
    "Z": "2", "S": "5", "B": "8", "G": "6",
}


def _sanitize_td3_line2_loose_filler(loose: str) -> str:
    """Turn stray letters inside chevron runs into MRZ filler ``<`` (common EasyOCR noise: K, I)."""
    if not loose:
        return loose
    return re.sub(r"(?<=<)[KIil]+(?=<)", lambda m: "<" * len(m.group(0)), loose)


def _apply_td3_line2_digit_zone_ocr_map(w44: str) -> str:
    """Map common letter→digit confusions in TD3 Line 2 DOB / expiry / check positions (13–27)."""
    if len(w44) < 28:
        return w44
    chars = list(w44)
    for i in (13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27):
        if i >= len(chars):
            break
        rep = _MRZ_OCR_CORRECTIONS.get(chars[i])
        if rep and rep.isdigit():
            chars[i] = rep
    return "".join(chars)


def _mrz_try_single_char_corrections(line2: str) -> Optional[str]:
    """Try single-character corrections on digit positions of line2 where a letter-like
    OCR confusion might have broken a checksum. Returns corrected line2 or None."""
    digit_positions = [9, 19, 27, 43]
    best_line = None
    best_passed = 0
    original_passed, _ = _mrz_verify_checksums(line2)
    if original_passed == 4:
        return line2
    for pos in digit_positions:
        ch = line2[pos]
        if ch.isdigit():
            continue
        replacement = _MRZ_OCR_CORRECTIONS.get(ch)
        if replacement is None:
            continue
        candidate = line2[:pos] + replacement + line2[pos + 1:]
        p, _ = _mrz_verify_checksums(candidate)
        if p > best_passed:
            best_passed = p
            best_line = candidate
    if best_line and best_passed > original_passed:
        return best_line
    return None


# ---------------------------------------------------------------------------
# Pass 2: Targeted MRZ Hunt (runs on preprocessed passport alignment crop; strip deskew after union)
# ---------------------------------------------------------------------------

# MRZ line length (TD3): 44 characters. For detection, accept wider range because
# EasyOCR may split a line (giving <25 chars) or merge spaces→< (giving >44 chars).
_MRZ_MIN_LEN = 15
_MRZ_MAX_LEN = 70
_MRZ_CHARSET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")
# Minimum `<` density to consider a candidate a real MRZ line (vs. date rows, labels, etc.).
# Real MRZ lines typically have 10–40% `<` filler; non-MRZ text has ~0%.
_MRZ_MIN_CHEVRON_DENSITY = 0.05

# Pass 2 box expansion: 10px vertical buffer, 95% image width (centered). Used for shotgun ROI crop and debug draw.
_VERT_BUFFER_PX = 10
_PASS2_WIDTH_FRAC = 0.95
# MRZ: use slightly wider boxes (98%) so both lines cover full 44 chars; Line 2 gets extra bottom so dark green box is lower.
_MRZ_WIDTH_FRAC = 0.98
_LINE2_EXTRA_BOTTOM_PX = 14
# Debug variant box colors (BGR): Line 1 (PAN / MRZ top) = light green, Line 2 (Expiry / MRZ bottom) = dark green.
_DEBUG_BGR_LINE1 = (144, 238, 144)
_DEBUG_BGR_LINE2 = (0, 128, 0)


def _expand_pass2_box(
    x1: int, y1: int, x2: int, y2: int, img_w: int, img_h: int
) -> Tuple[int, int, int, int]:
    """Apply 10px vertical buffer and 95% width expansion to a Pass 2 bounding box. Clamped to image."""
    center_x = (x1 + x2) / 2.0
    half_w = (img_w * _PASS2_WIDTH_FRAC) / 2.0
    nx1 = max(0, int(center_x - half_w))
    nx2 = min(img_w, int(center_x + half_w))
    ny1 = max(0, y1 - _VERT_BUFFER_PX)
    ny2 = min(img_h, y2 + _VERT_BUFFER_PX)
    return (nx1, ny1, nx2, ny2)


def _expand_mrz_box_full_width(
    x1: int, y1: int, x2: int, y2: int, img_w: int, img_h: int,
    extra_bottom_px: int = 0,
) -> Tuple[int, int, int, int]:
    """Expansion for passport MRZ: full document width (98% of image centered) + vertical buffer.

    EasyOCR often returns a narrow box for the left part of the line; image-centered full
    width ensures both green boxes and ROIs encompass all 44 characters. extra_bottom_px
    extends the box downward (used for Line 2 so the dark green box sits lower and covers the full second line).
    """
    half_w = (img_w * _MRZ_WIDTH_FRAC) / 2.0
    center_img_x = img_w / 2.0
    nx1 = max(0, int(center_img_x - half_w))
    nx2 = min(img_w, int(center_img_x + half_w))
    ny1 = max(0, y1 - _VERT_BUFFER_PX)
    ny2 = min(img_h, y2 + _VERT_BUFFER_PX + extra_bottom_px)
    return (nx1, ny1, nx2, ny2)


def _detect_mrz_lines_with_easyocr(
    passport_page: "np.ndarray",
    frame_index: Optional[int] = None,
) -> List[Tuple[int, int, int, int]]:
    """Pass 2: Targeted MRZ hunt on the preprocessed passport alignment crop (not full-frame deskewed).

    Runs a dedicated EasyOCR pass on the full crop to find two horizontal blocks that match
    the 44-character MRZ pattern anywhere in the frame — regardless of passport position or tilt.
    Returns raw boxes in the same coordinate system as *passport_page*; caller applies vertical buffer
    and full-width expansion before cropping the combined MRZ strip (then strip-only deskew).

    Uses chevron (`<`) density and TD3 Line 1 anchor (P< or P[A-Z]) to distinguish real MRZ
    lines from other passport text (dates, labels) that passes basic length/charset filters.
    """
    reader = _get_easyocr_reader()
    if reader is None or passport_page is None or passport_page.size == 0:
        return []
    h, w = passport_page.shape[:2]
    # Search the full image — MRZ can be anywhere when passport is shifted or tilted.
    y_crop_start = 0
    crop = passport_page
    if crop.size == 0:
        return []

    clahe_master = _build_clahe_master(crop)
    try:
        t0 = time.perf_counter() if _OCR_TIMING else None
        results = reader.readtext(clahe_master, width_ths=1.0, add_margin=0.15)
        if _OCR_TIMING and t0 is not None:
            logger.info("[OCR_TIMING] EasyOCR readtext (MRZ detect): %.2fs", time.perf_counter() - t0)
    except Exception:
        return []
    if not results:
        return []

    crop_h, crop_w = crop.shape[:2]
    mrz_candidates: List[Dict[str, Any]] = []

    # --- Pre-scan: find TD3 Line 1 anchor before any filtering ---
    # EasyOCR may split MRZ Line 1 into two blocks (e.g. "P<NGADEBOYEWA<<ADEBOYE"
    # and "USMAN<<<..."). Scan ALL results for any block whose text starts with a TD3 prefix
    # to locate Line 1 even if that block alone is too short to pass length filters.
    all_blocks: List[Dict[str, Any]] = []
    p_anchor_block: Optional[Dict[str, Any]] = None
    logger.debug("[MRZ_DETECT] EasyOCR returned %d results on full frame (%dx%d)", len(results), crop_w, crop_h)
    for bbox, txt, conf in results:
        if not txt:
            continue
        normalized = re.sub(r"[^A-Z0-9<]", "", txt.upper().replace(" ", "<"))
        ys = [p[1] for p in bbox]
        xs = [p[0] for p in bbox]
        x1, y1 = int(max(0, min(xs))), int(max(0, min(ys)))
        x2, y2 = int(min(crop_w, max(xs))), int(min(crop_h, max(ys)))
        box_w = x2 - x1
        box_h = max(1, y2 - y1)
        aspect = box_w / max(box_h, 1)
        logger.debug("  [MRZ_DETECT] raw=%r  norm=%r  len=%d  aspect=%.1f  y=%d..%d", txt, normalized, len(normalized), aspect, y1, y2)
        block = {
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "mid_y": (y1 + y2) / 2.0,
            "text": normalized, "text_len": len(normalized),
            "box_w": box_w, "box_h": box_h,
        }
        all_blocks.append(block)
        # Anchor on TD3 Line 1 specifically: P + (<|letter) + 3-letter country code.
        # This avoids anchoring on Line 2 (e.g. "P123456AA0CAN...") which also starts
        # with P but has a digit at position 1, not a country code.
        if re.match(r"^P[<A-Z][A-Z]{3}", normalized) and len(normalized) >= 10 and aspect >= 3.0:
            if p_anchor_block is None or block["mid_y"] > p_anchor_block["mid_y"]:
                p_anchor_block = block

    # --- TD3 anchor: early return if we found a definitive MRZ Line 1 ---
    if p_anchor_block is not None:
        ay1 = p_anchor_block["y1"]
        ay2 = p_anchor_block["y2"]
        ax1 = p_anchor_block["x1"]
        ax2 = p_anchor_block["x2"]
        line1_h = ay2 - ay1

        # Merge any blocks on the same visual line as the P< block (EasyOCR may split Line 1).
        # Use a slightly generous threshold because box midpoints can jitter between runs/variants.
        merge_thresh = max(12, int(0.05 * crop_h))
        for blk in all_blocks:
            if blk is p_anchor_block:
                continue
            overlap = min(ay2, blk["y2"]) - max(ay1, blk["y1"])
            min_h = max(1, min(ay2 - ay1, blk["y2"] - blk["y1"]))
            overlap_ok = overlap >= 0.30 * min_h
            mid_ok = abs(blk["mid_y"] - p_anchor_block["mid_y"]) <= merge_thresh
            if mid_ok or overlap_ok:
                ax1 = min(ax1, blk["x1"])
                ax2 = max(ax2, blk["x2"])
                ay1 = min(ay1, blk["y1"])
                ay2 = max(ay2, blk["y2"])
        line1_h = ay2 - ay1

        # Find Line 2: any block below Line 1 that's wide and in the MRZ area
        line2_block = None
        for blk in all_blocks:
            if blk["mid_y"] <= p_anchor_block["mid_y"]:
                continue
            if blk["box_w"] >= 3 * max(blk["box_h"], 1):
                if line2_block is None or blk["text_len"] > line2_block["text_len"]:
                    line2_block = blk

        y1_line1 = y_crop_start + ay1
        y2_line1 = y_crop_start + ay2

        if line2_block is not None:
            y1_line2 = y_crop_start + line2_block["y1"]
            y2_line2 = y_crop_start + line2_block["y2"]
        else:
            gap = max(2, line1_h // 4)
            y1_line2 = min(h, y2_line1 + gap)
            y2_line2 = min(h, y1_line2 + int(line1_h * 1.35))

        boxes = [
            (ax1, y1_line1, ax2, min(h, y2_line1)),
            (ax1, y1_line2, ax2, min(h, y2_line2)),
        ]
        logger.debug(
            "[MRZ_DETECT] TD3 anchor at y=%d..%d; Line2 %s at y=%d..%d",
            y1_line1, y2_line1, "detected" if line2_block else "generated", y1_line2, y2_line2,
        )
        return boxes

    # --- Standard candidate filtering (no TD3 anchor found) ---
    for blk in all_blocks:
        normalized = blk["text"]
        if not (_MRZ_MIN_LEN <= len(normalized) <= _MRZ_MAX_LEN):
            continue
        if blk["box_w"] < 5 * max(blk["box_h"], 1):
            continue
        chevron_count = normalized.count("<")
        chevron_density = chevron_count / max(len(normalized), 1)
        blk["chevron_density"] = chevron_density
        blk["starts_with_p"] = normalized.startswith("P")
        logger.debug(
            "  [MRZ_DETECT] CANDIDATE: chevron=%d(%.0f%%) P<=%s y=%d..%d",
            chevron_count, chevron_density*100, blk['starts_with_p'], blk['y1'], blk['y2'],
        )
        mrz_candidates.append(blk)

    logger.debug("[MRZ_DETECT] %d candidates passed basic filters (fallback path)", len(mrz_candidates))
    if not mrz_candidates:
        return []

    # --- Fallback: score-based selection (no TD3 anchor found) ---
    # Filter out low-chevron candidates (likely date rows / labels, not MRZ).
    mrz_candidates = [c for c in mrz_candidates if c["chevron_density"] >= _MRZ_MIN_CHEVRON_DENSITY]
    if not mrz_candidates:
        return []

    mrz_candidates.sort(key=lambda c: (c["mid_y"], -c["text_len"]))

    # Group detections on the same visual line.
    line_merge_thresh_px = max(5, int(0.012 * crop_h))
    lines: List[List[Dict[str, Any]]] = []
    for cand in mrz_candidates:
        placed = False
        for line_group in lines:
            if abs(line_group[0]["mid_y"] - cand["mid_y"]) <= line_merge_thresh_px:
                line_group.append(cand)
                placed = True
                break
        if not placed:
            lines.append([cand])

    # Score each line group purely on chevron density — no position bias.
    # This ensures MRZ lines are ranked the same whether the passport is at the
    # top, middle, or bottom of the frame.
    for group in lines:
        max_chevron = max(c["chevron_density"] for c in group)
        group[0]["_line_score"] = max_chevron

    lines.sort(key=lambda g: g[0].get("_line_score", 0), reverse=True)
    lines = lines[:2]
    lines.sort(key=lambda g: g[0]["mid_y"])

    boxes: List[Tuple[int, int, int, int]] = []
    for group in lines:
        x1 = min(c["x1"] for c in group)
        y1 = min(c["y1"] for c in group)
        x2 = max(c["x2"] for c in group)
        y2 = max(c["y2"] for c in group)
        box_w = x2 - x1
        box_h = max(1, y2 - y1)
        if box_w < 5 * box_h:
            continue
        y1_full = y_crop_start + y1
        y2_full = y_crop_start + y2
        boxes.append((x1, y1_full, x2, min(h, y2_full)))

    # If EasyOCR returned one tall bbox spanning both MRZ lines, split into two boxes.
    if len(boxes) == 1 and crop_h > 0:
        x1, y1_full, x2, y2_full = boxes[0]
        single_h = y2_full - y1_full
        if single_h >= 0.10 * h:
            mid_y_full = (y1_full + y2_full) // 2
            boxes = [
                (x1, y1_full, x2, mid_y_full),
                (x1, mid_y_full, x2, y2_full),
            ]

    # If we still have only one box, add a second box for the strip directly below (second MRZ line).
    if len(boxes) == 1:
        x1, y1_full, x2, y2_full = boxes[0]
        line_h = y2_full - y1_full
        gap = max(2, line_h // 4)
        y2_start = min(h, y2_full + gap)
        y2_end = min(h, y2_start + int(line_h * 1.35))
        if y2_end > y2_start + 5:
            boxes.append((x1, y2_start, x2, y2_end))

    return boxes


def _passport_mrz_ocr_combined_strip(
    passport_page: "np.ndarray",
    used_boxes: List[Tuple[int, int, int, int]],
    *,
    detection_source: str,
    frame_index: int,
) -> Tuple[List[Tuple[str, float, str]], List[Tuple[str, float, str]], float]:
    """Passport MRZ recognition: variants are built **only** on the combined MRZ strip (never the full page).

    Flow (identical whether ``DEBUG_ACTIVATE`` is on or off — debug only writes PNGs):

    1. Vertical union of *used_boxes* → ``combined_roi`` from *passport_page*.
    2. :func:`_deskew_passport_mrz_combined_roi` — when ``DESKEW_ENABLE`` is on, measure tilt on the strip
       and rotate it; when off, returns ``combined_roi.copy()`` unchanged (variants use the **non-deskewed** strip).
    3. ``_build_six_variants(strip_for_ocr)`` **once** on that strip → five preprocessing images.
    4. Optional: ``_save_debug_variants_plain`` → ``f*_mrzroi_*`` under ``debug/variants/passport/``.
    5. ``_shotgun_ocr_mrz_on_variant_images`` — y-bands scaled if strip height changed after deskew.

    Does **not** re-run :func:`_detect_mrz_lines_with_easyocr`; boxes must already be in *used_boxes*.

    Returns ``(line1_pool, line2_pool, mrz_measured_tilt_deg)`` for confidence boost when strip was rotated.
    """
    empty_pools: Tuple[List[Tuple[str, float, str]], List[Tuple[str, float, str]]] = ([], [])
    if passport_page is None or passport_page.size == 0 or not used_boxes:
        return empty_pools[0], empty_pools[1], 0.0
    cx1 = min(b[0] for b in used_boxes)
    cy1 = min(b[1] for b in used_boxes)
    cx2 = max(b[2] for b in used_boxes)
    cy2 = max(b[3] for b in used_boxes)
    if cx2 <= cx1 or cy2 <= cy1:
        return empty_pools[0], empty_pools[1], 0.0
    combined_roi = passport_page[cy1:cy2, cx1:cx2].copy()
    if combined_roi.size == 0:
        return empty_pools[0], empty_pools[1], 0.0
    roi_h_before = int(combined_roi.shape[0])

    strip_for_variants, mrz_tilt_deg = _deskew_passport_mrz_combined_roi(
        combined_roi, frame_index=frame_index
    )
    if strip_for_variants is None or strip_for_variants.size == 0:
        return empty_pools[0], empty_pools[1], 0.0

    roi_h_after = int(strip_for_variants.shape[0])
    mrz_variant_images = _build_six_variants(strip_for_variants)
    if not mrz_variant_images:
        return empty_pools[0], empty_pools[1], mrz_tilt_deg
    if DEBUG_ACTIVATE:
        try:
            _save_debug_variants_plain(
                mrz_variant_images,
                frame_index,
                doc_type="passport",
                tag=f"mrzroi_{detection_source}_combined",
            )
        except Exception:
            pass
    band1, band2 = _mrz_combined_roi_bands_y(used_boxes, cy1, cy2)
    band1, band2 = _scale_mrz_roi_bands_y(band1, band2, roi_h_before, roi_h_after)
    return (
        *_shotgun_ocr_mrz_on_variant_images(
            mrz_variant_images,
            source_tag=f"{detection_source}_combined",
            line1_band=band1,
            line2_band=band2,
        ),
        mrz_tilt_deg,
    )


def _collect_passport_raw_pool(
    frame: "np.ndarray",
    frame_index: Optional[int] = None,
    fallback_boxes: Optional[List[Tuple[int, int, int, int]]] = None,
    require_detection: bool = False,
) -> Tuple[List[Tuple[str, float, str]], List[Tuple[str, float, str]], Optional["np.ndarray"], List[Tuple[int, int, int, int]]]:
    """Stage 1+2 for one passport frame: MRZ line detection on alignment crop, strip deskew, MRZ OCR.

    MRZ **recognition** uses :func:`_passport_mrz_ocr_combined_strip`: union of Pass-2 boxes, optional
    strip deskew (``DESKEW_ENABLE``), **one** variant build on that strip only (no full-page variants),
    then OCR — **same pipeline with ``DEBUG_ACTIVATE`` off or on** (debug only adds PNG saves).
    Line 1 and Line 2 **raw** pools are filled separately (same combined strip, split by y-band + gates).

    When require_detection=True and Pass 2 finds no lines, returns empty pools immediately
    (no OCR on other regions).

    Applies 1.2x confidence boost when the **MRZ strip** was rotated by deskew.
    Returns ``(line1_pool, line2_pool, passport_alignment_image, detected_boxes)`` — third value is the
    full preprocessed passport crop (not globally deskewed), for ``passport_image_base64`` / API.
    """
    empty_boxes: List[Tuple[int, int, int, int]] = []
    if frame is None or frame.size == 0 or not HAS_EASYOCR:
        return [], [], None, empty_boxes
    _save_debug_passport_original_frame(frame, frame_index)
    crop = _crop_passport_alignment_region(frame)
    if crop is None or crop.size == 0:
        return [], [], None, empty_boxes

    # Gamma + global brightness/contrast (SCAN_GAMMA, SCAN_GLOBAL_*). No full-page deskew here.
    passport_page = _preprocess_passport_alignment_crop(crop)
    if passport_page is None or passport_page.size == 0:
        return [], [], None, empty_boxes

    # Pass 2 (Targeted MRZ Hunt): EasyOCR on the full alignment crop (may be tilted).
    img_h, img_w = passport_page.shape[:2]
    line_boxes = _detect_mrz_lines_with_easyocr(passport_page, frame_index=frame_index)
    line1_pool: List[Tuple[str, float, str]] = []
    line2_pool: List[Tuple[str, float, str]] = []
    used_boxes: List[Tuple[int, int, int, int]] = []
    detection_source = "none"
    mrz_tilt_deg = 0.0

    if line_boxes:
        used_boxes = []
        for box_idx, (dx1, dy1, dx2, dy2) in enumerate(line_boxes):
            extra_bottom = _LINE2_EXTRA_BOTTOM_PX if box_idx == 1 else 0
            used_boxes.append(_expand_mrz_box_full_width(dx1, dy1, dx2, dy2, img_w, img_h, extra_bottom_px=extra_bottom))
        detection_source = "easyocr"
    elif require_detection:
        logger.debug("Frame %s: no MRZ detected (require_detection=True), skipping frame", frame_index)
        return [], [], passport_page, []
    elif fallback_boxes:
        for fbx1, fby1, fbx2, fby2 in fallback_boxes:
            bx1 = max(0, min(fbx1, img_w - 1))
            by1 = max(0, min(fby1, img_h - 1))
            bx2 = max(bx1 + 1, min(fbx2, img_w))
            by2 = max(by1 + 1, min(fby2, img_h))
            used_boxes.append((bx1, by1, bx2, by2))
        detection_source = "coord_memory"

    if used_boxes:
        roi_l1, roi_l2, mrz_tilt_deg = _passport_mrz_ocr_combined_strip(
            passport_page,
            used_boxes,
            detection_source=detection_source,
            frame_index=frame_index or 0,
        )
        line1_pool.extend(roi_l1)
        line2_pool.extend(roi_l2)
        logger.debug(
            "Frame %s: %s %d MRZ box(es) → combined ROI OCR, l1_pool=%d l2_pool=%d",
            frame_index,
            detection_source,
            len(used_boxes),
            len(line1_pool),
            len(line2_pool),
        )

    if abs(mrz_tilt_deg) > 0.05:
        line1_pool = _apply_deskew_boost_mrz(line1_pool)
        line2_pool = _apply_deskew_boost_mrz(line2_pool)

    _debug_print_mrz_raw_ocr_pools(line1_pool, line2_pool, frame_index=frame_index)

    return line1_pool, line2_pool, passport_page, line_boxes


def scan_passport_from_frame(
    frame: "np.ndarray",
    frame_index: Optional[int] = None,
    require_detection: bool = False,
) -> Optional[Dict[str, Any]]:
    """Process one passport frame through the unified mass consensus pipeline (Stages 1-4).

    When called with a single frame (e.g. from the API), the pipeline builds filter
    variants, runs shotgun OCR, gates MRZ pairs, and confidence-votes on that frame.

    require_detection=True returns None immediately when Pass 2 finds no MRZ lines (no OCR).
    Use in the poll loop to avoid EasyOCR on frames where no passport is visible.

    The returned ``deskewed_image`` key is the **full preprocessed passport alignment crop**
    (not globally deskewed). MRZ deskew applies only to the combined MRZ strip inside the pipeline.
    """
    if frame is None or frame.size == 0 or not HAS_EASYOCR:
        return None
    l1_pool, l2_pool, deskewed, _boxes = _collect_passport_raw_pool(
        frame, frame_index=frame_index, require_detection=require_detection
    )
    if not l1_pool and not l2_pool:
        return None

    line1_cands, valid_l2s, checksum_pass_count = _gate_mrz_from_pools(l1_pool, l2_pool)

    winning_l1, winning_l2 = _consensus_winning_mrz_lines(line1_cands, valid_l2s)

    passport_id, guest_name = _decode_mrz_winners(winning_l1, winning_l2)

    if DEBUG_ACTIVATE:
        _debug_print_mrz_winner(winning_l1, winning_l2, passport_id, guest_name)
        id_bucket: List[Tuple[str, float]] = [
            (l2[0:9].replace("<", "").strip(), conf)
            for l2, conf in valid_l2s
            if l2[0:9].replace("<", "").strip()
        ]
        name_bucket: List[Tuple[str, float]] = []
        if winning_l1:
            for l2, conf in valid_l2s:
                _, gname = _parse_mrz_td3(winning_l1, l2)
                if gname:
                    name_bucket.append((gname, conf))
        _print_consensus("Passport ID", id_bucket, passport_id, value_actual_counts=checksum_pass_count, raw_pool_size=len(l2_pool))
        _print_consensus("Guest Name", name_bucket, guest_name, raw_pool_size=len(l1_pool))

    if not passport_id and not guest_name:
        return None
    return {
        "passport_id": passport_id,
        "guest_name": guest_name,
        "raw_text": "",
        # Legacy key name: full alignment crop (gamma/contrast), not full-page deskew.
        "deskewed_image": deskewed,
    }


def _passport_image_to_base64(image: "np.ndarray") -> str:
    """Encode BGR image to PNG base64 string."""
    if image is None or image.size == 0:
        return ""
    try:
        _, buf = cv2.imencode(".png", image)
        return base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return ""


def capture_passport_image_only() -> Optional[str]:
    """Capture one frame of the passport (align + verify), return base64 of the alignment crop. No MRZ decode.

    Image is preprocessed (gamma/contrast) but **not** globally deskewed; MRZ-only deskew runs only
    during a full MRZ scan on the combined strip. Use when guest entered passport number manually
    so we still save the page image.
    """
    if not HAS_OPENCV:
        return None
    reset_deskew_angle_cache("passport")
    frames = _capture_frames_from_camera()
    if not frames:
        return None
    frame = frames[0]
    crop = _preprocess_passport_alignment_crop(_crop_passport_alignment_region(frame))
    if crop is None or crop.size == 0:
        return None
    return _passport_image_to_base64(crop)


def scan_passport() -> Optional[Dict[str, Any]]:
    """Scan passport via camera: capture sharpest 1-of-3 raw → verify → MRZ detect, MRZ-strip deskew,
    shotgun OCR, gate, confidence-weighted vote. Saved image = full alignment crop (not globally deskewed).
    """
    if not HAS_OPENCV or not HAS_EASYOCR:
        logger.info("MOCK HARDWARE/OCR: Simulating passport scan")
        return {"passport_id": "MOCK123456", "guest_name": "John Doe", "raw_text": "", "passport_image_base64": None}

    _clear_roi_debug_images("passport")
    logger.info("Scanning passport with camera (sharpest 1-of-3 raw capture, MRZ pipeline)...")

    while True:
        frames = _capture_frames_from_camera()
        if not frames:
            return None
        if _show_capture_for_verification(frames[0]):
            break
        print("Retaking passport image...")

    if DEBUG_ACTIVATE:
        print("Processing images (MRZ detect + strip deskew + MRZ decode, mass consensus)...")

    global _debug_mrz_plain_variants_saved_tags
    _debug_mrz_plain_variants_saved_tags.clear()
    reset_deskew_angle_cache("passport")

    all_l1: List[Tuple[str, float, str]] = []
    all_l2: List[Tuple[str, float, str]] = []
    last_deskewed = None
    last_good_boxes: Optional[List[Tuple[int, int, int, int]]] = None

    for idx, one in enumerate(frames, start=1):
        l1_pool, l2_pool, deskewed, detected_boxes = _collect_passport_raw_pool(
            one, frame_index=idx, fallback_boxes=last_good_boxes
        )
        all_l1.extend(l1_pool)
        all_l2.extend(l2_pool)
        if deskewed is not None:
            last_deskewed = deskewed
        if detected_boxes:
            last_good_boxes = detected_boxes
        logger.debug("Passport frame %d: l1_raw=%d l2_raw=%d", idx, len(l1_pool), len(l2_pool))

    line1_cands, valid_l2s, checksum_pass_count = _gate_mrz_from_pools(all_l1, all_l2)

    winning_l1, winning_l2 = _consensus_winning_mrz_lines(line1_cands, valid_l2s)

    passport_id, guest_name = _decode_mrz_winners(winning_l1, winning_l2)
    deskewed = last_deskewed

    # Passport ID fallback from checksum_pass_count
    if passport_id is None:
        mass_winner_id: Optional[str] = None
        best_checksum_id: Optional[str] = None
        for pid, count in checksum_pass_count.items():
            if not pid:
                continue
            if count >= _PASSPORT_MASS_VOTE_MIN:
                if mass_winner_id is None or count > checksum_pass_count.get(mass_winner_id, 0):
                    mass_winner_id = pid
        if checksum_pass_count:
            best_checksum_id = max(
                checksum_pass_count.items(),
                key=lambda t: (t[1] + 0.6 * _passport_id_mrz_likeness(t[0]), t[1]),
            )[0]
        if mass_winner_id is not None:
            passport_id = mass_winner_id
        elif best_checksum_id is not None:
            passport_id = best_checksum_id

    # Verbose MRZ debug: show winning lines + parsed fields.
    _debug_print_mrz_winner(winning_l1, winning_l2, passport_id, guest_name)

    id_bucket: List[Tuple[str, float]] = [
        (l2[0:9].replace("<", "").strip(), conf)
        for l2, conf in valid_l2s
        if l2[0:9].replace("<", "").strip()
    ]
    name_bucket: List[Tuple[str, float]] = []
    if winning_l1:
        for l2, conf in valid_l2s:
            _, gname = _parse_mrz_td3(winning_l1, l2)
            if gname:
                name_bucket.append((gname, conf))

    _print_consensus("Passport ID", id_bucket, passport_id, value_actual_counts=checksum_pass_count, raw_pool_size=len(all_l2))
    _print_consensus("Guest Name", name_bucket, guest_name, raw_pool_size=len(all_l1))

    if not (winning_l1 or winning_l2):
        logger.warning("MRZ decode failed on all frames; saving image from last confirmed frame only")
        if deskewed is None and frames:
            deskewed = _preprocess_passport_alignment_crop(_crop_passport_alignment_region(frames[0]))

    passport_image_base64 = _passport_image_to_base64(deskewed) if deskewed is not None else None

    return {
        "passport_id": passport_id,
        "guest_name": guest_name,
        "raw_text": "",
        "passport_image_base64": passport_image_base64,
    }


def scan_passport_from_frames(frames: List["np.ndarray"]) -> Optional[Dict[str, Any]]:
    """Same pipeline as scan_passport() but using a list of frames (e.g. from a file).
    MRZ detect on alignment crop → combined-strip deskew → 5-variant OCR, mass consensus. No camera UI."""
    if not frames or not HAS_EASYOCR:
        return None
    for f in frames:
        if f is None or f.size == 0:
            return None

    _clear_roi_debug_images("passport")
    logger.info(
        "Processing passport from %d frame(s) (MRZ detect + strip deskew + MRZ mass consensus)...",
        len(frames),
    )
    global _debug_mrz_plain_variants_saved_tags
    _debug_mrz_plain_variants_saved_tags.clear()
    reset_deskew_angle_cache("passport")

    all_l1: List[Tuple[str, float, str]] = []
    all_l2: List[Tuple[str, float, str]] = []
    last_deskewed = None
    last_good_boxes: Optional[List[Tuple[int, int, int, int]]] = None

    for idx, one in enumerate(frames, start=1):
        l1_pool, l2_pool, deskewed, detected_boxes = _collect_passport_raw_pool(
            one, frame_index=idx, fallback_boxes=last_good_boxes
        )
        all_l1.extend(l1_pool)
        all_l2.extend(l2_pool)
        if deskewed is not None:
            last_deskewed = deskewed
        if detected_boxes:
            last_good_boxes = detected_boxes
        logger.debug("Passport frame %d: l1_raw=%d l2_raw=%d", idx, len(l1_pool), len(l2_pool))

    line1_cands, valid_l2s, checksum_pass_count = _gate_mrz_from_pools(all_l1, all_l2)

    winning_l1, winning_l2 = _consensus_winning_mrz_lines(line1_cands, valid_l2s)

    passport_id, guest_name = _decode_mrz_winners(winning_l1, winning_l2)
    deskewed = last_deskewed

    # Passport ID fallback from checksum_pass_count
    if passport_id is None:
        mass_winner_id = None
        best_checksum_id = None
        for pid, count in checksum_pass_count.items():
            if not pid:
                continue
            if count >= _PASSPORT_MASS_VOTE_MIN:
                if mass_winner_id is None or count > checksum_pass_count.get(mass_winner_id, 0):
                    mass_winner_id = pid
        if checksum_pass_count:
            best_checksum_id = max(
                checksum_pass_count.items(),
                key=lambda t: (t[1] + 0.6 * _passport_id_mrz_likeness(t[0]), t[1]),
            )[0]
        if mass_winner_id is not None:
            passport_id = mass_winner_id
        elif best_checksum_id is not None:
            passport_id = best_checksum_id

    # Verbose MRZ debug: show winning lines + parsed fields.
    _debug_print_mrz_winner(winning_l1, winning_l2, passport_id, guest_name)

    id_bucket: List[Tuple[str, float]] = [
        (l2[0:9].replace("<", "").strip(), conf)
        for l2, conf in valid_l2s
        if l2[0:9].replace("<", "").strip()
    ]
    name_bucket: List[Tuple[str, float]] = []
    if winning_l1:
        for l2, conf in valid_l2s:
            _, gname = _parse_mrz_td3(winning_l1, l2)
            if gname:
                name_bucket.append((gname, conf))

    _print_consensus("Passport ID", id_bucket, passport_id, value_actual_counts=checksum_pass_count, raw_pool_size=len(all_l2))
    _print_consensus("Guest Name", name_bucket, guest_name, raw_pool_size=len(all_l1))

    if not (winning_l1 or winning_l2):
        logger.warning("MRZ decode failed on all frames")
        if deskewed is None and frames:
            deskewed = _preprocess_passport_alignment_crop(_crop_passport_alignment_region(frames[0]))

    passport_image_base64 = _passport_image_to_base64(deskewed) if deskewed is not None else None

    return {
        "passport_id": passport_id,
        "guest_name": guest_name,
        "raw_text": "",
        "passport_image_base64": passport_image_base64,
    }


def _clear_roi_debug_images(doc_type: Optional[str] = None) -> None:
    """Remove previous run's debug images for the given doc type so passport and card don't overwrite each other.

    doc_type: "passport" clears only debug/variants/passport/; "card" clears only debug/variants/card/.
    If None, clears both subdirs and any legacy *.png in the flat debug/variants/ folder.
    """
    try:
        if doc_type is not None:
            doc = (doc_type or "").strip().lower()
            dirs = [_get_debug_variants_dir(doc)] if doc in ("passport", "card") else []
        else:
            # Clear subdirs and the flat base (legacy files from before passport/card subdirs)
            dirs = [
                _DEBUG_VARIANTS_BASE,  # flat folder first (legacy)
                _get_debug_variants_dir("passport"),
                _get_debug_variants_dir("card"),
            ]
        for d in dirs:
            if d.exists():
                for p in d.glob("*.png"):
                    try:
                        p.unlink()
                        logger.debug("Removed previous image: %s", p.name)
                    except OSError as e:
                        logger.warning("Could not remove %s: %s", p, e)
    except Exception:
        pass


def capture_card_frames() -> List["np.ndarray"]:
    """Capture top-2 raw (unenhanced) card frames via the shared camera capture dialog.
    Uses the card alignment box (RECT_W x RECT_H). The caller is responsible for
    showing the verification dialog and for all post-confirmation processing."""
    return _capture_frames_from_camera(doc_type="card")


def _build_clahe_master(card: "np.ndarray") -> "np.ndarray":
    """Build CLAHE-enhanced master image used only for EasyOCR coordinate detection."""
    try:
        gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY) if card.ndim == 3 else card.copy()
        clahe_obj = cv2.createCLAHE(clipLimit=_SCAN_CLAHE_MASTER_CLIP, tileGridSize=(8, 8))
        return clahe_obj.apply(gray)
    except Exception:
        return card


# ---------------------------------------------------------------------------
# Text-Centric Deskew  (replaces edge / contour quad detection)
# ---------------------------------------------------------------------------
_DESKEW_MAX_ANGLE = 15.0
_DESKEW_CONFIDENCE_BOOST = 1.2


def reset_deskew_angle_cache(label: Optional[str] = None) -> None:
    """Clear cached deskew tilt (degrees). Call at the start of each multi-frame passport/card scan.

    Omit *label* to clear all; pass ``\"passport\"`` or ``\"card\"`` to clear one pipeline only.
    Starting a passport scan clears both full-page ``passport`` (legacy, unused) and
    ``passport_mrz`` (combined MRZ strip deskew cache).
    Polling loops that call ``scan_passport_from_frame`` repeatedly reuse the MRZ cache until the
    process exits or you call this (e.g. before a new guest in a long-lived app).
    """
    global _deskew_cached_tilt_degrees
    if label is None:
        _deskew_cached_tilt_degrees.clear()
    elif str(label) == "passport":
        _deskew_cached_tilt_degrees.pop("passport", None)
        _deskew_cached_tilt_degrees.pop("passport_mrz", None)
    else:
        _deskew_cached_tilt_degrees.pop(str(label), None)


def _rotate_crop_by_measured_tilt(raw_crop: "np.ndarray", measured_tilt_deg: float) -> "np.ndarray":
    """Rotate *raw_crop* to compensate for text tilt *measured_tilt_deg* (same convention as :func:`_text_based_deskew`)."""
    rotation_angle = float(measured_tilt_deg)
    if not HAS_OPENCV or raw_crop is None or raw_crop.size == 0:
        return raw_crop
    if abs(rotation_angle) <= 0.05:
        return raw_crop.copy()
    applied_angle = -rotation_angle
    h, w = raw_crop.shape[:2]
    center = (w / 2.0, h / 2.0)
    M = cv2.getRotationMatrix2D(center, applied_angle, 1.0)
    cos_a = abs(M[0, 0])
    sin_a = abs(M[0, 1])
    new_w = int(h * sin_a + w * cos_a)
    new_h = int(h * cos_a + w * sin_a)
    M[0, 2] += (new_w - w) / 2.0
    M[1, 2] += (new_h - h) / 2.0
    return cv2.warpAffine(
        raw_crop,
        M,
        (new_w, new_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _refine_passport_skew_angle(raw_crop: "np.ndarray", measured_tilt_deg: float) -> float:
    """Fine-tune document tilt (degrees) so MRZ-scale text is closer to horizontal.

    Coarse angle comes from Hough / box median; EasyOCR boxes are often axis-aligned, so Hough
    dominates and can be off by a fraction of a degree. This scans a small window around
    *measured_tilt_deg* on the **bottom** of the alignment crop (MRZ-heavy), rotating a gray ROI
    and picking the angle that **maximizes variance of the horizontal projection** (sharper text rows).

    Same sign convention as :func:`_text_based_deskew` (*measured_tilt_deg* = clockwise tilt of text
    in the image; output is the refined tilt to pass to :func:`_rotate_crop_by_measured_tilt`).
    """
    if not HAS_OPENCV or raw_crop is None or raw_crop.size == 0:
        return measured_tilt_deg
    try:
        h, w = raw_crop.shape[:2]
        # Bottom ~40%: MRZ usually lives here in the passport alignment crop.
        y0 = int(h * 0.60)
        if h - y0 < 28 or w < 80:
            return measured_tilt_deg
        roi = raw_crop[y0:h, :]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi.copy()
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        rh, rw = gray.shape[:2]
        cx, cy = rw / 2.0, rh / 2.0
        try:
            half = float(os.environ.get("DESKEW_REFINE_HALF_DEG", "2.2"))
            step = float(os.environ.get("DESKEW_REFINE_STEP_DEG", "0.2"))
        except ValueError:
            half, step = 2.2, 0.2
        half = max(0.5, min(half, 4.0))
        step = max(0.08, min(step, 0.5))
        m0 = float(measured_tilt_deg)
        best_score = -1.0
        best_tilt = m0
        n_steps = int(math.ceil((2 * half) / step)) + 1
        tilt = m0 - half
        for _ in range(max(1, n_steps)):
            if tilt > m0 + half + 1e-9:
                break
            M = cv2.getRotationMatrix2D((cx, cy), -tilt, 1.0)
            warped = cv2.warpAffine(
                gray,
                M,
                (rw, rh),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            )
            proj = np.sum(warped.astype(np.float32), axis=1)
            score = float(np.var(proj))
            if score > best_score:
                best_score = score
                best_tilt = float(tilt)
            tilt += step
        if DEBUG_ACTIVATE and abs(best_tilt - m0) > 0.06:
            logger.debug("Passport deskew refine: %.3f° -> %.3f° (row-projection)", m0, best_tilt)
        return best_tilt
    except Exception:
        return measured_tilt_deg


# Cache key for tilt measured on the **combined MRZ strip** only (not full passport page).
_MRZ_COMBINED_DESKEW_LABEL = "passport_mrz"


def _mrz_strip_projection_score(strip: "np.ndarray", tilt_deg: float) -> float:
    """Score how well *tilt_deg* straightens the MRZ strip.

    The old grayscale row-sum score could be dominated by the bright page background,
    which made slightly tilted strips still look "good enough" and under-corrected the
    saved `f*_mrzroi_*` variants. This version emphasizes dark text using blackhat /
    thresholded text pixels, then rewards concentrated horizontal rows.
    """
    if not HAS_OPENCV or strip is None or strip.size == 0:
        return -1.0
    try:
        gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if strip.ndim == 3 else strip.copy()
        h, w = gray.shape[:2]
        if h < 24 or w < 80:
            return -1.0

        # Trim page margins so the score is driven more by MRZ glyph rows than blank borders.
        x_margin = max(2, int(w * 0.02))
        y_margin = max(1, int(h * 0.08))
        if (w - 2 * x_margin) >= 40 and (h - 2 * y_margin) >= 16:
            gray = gray[y_margin : h - y_margin, x_margin : w - x_margin]

        rh, rw = gray.shape[:2]
        if rh < 16 or rw < 40:
            return -1.0

        M = cv2.getRotationMatrix2D((rw / 2.0, rh / 2.0), -float(tilt_deg), 1.0)
        warped = cv2.warpAffine(
            gray,
            M,
            (rw, rh),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )

        warped = cv2.GaussianBlur(warped, (3, 3), 0)
        clahe_obj = cv2.createCLAHE(clipLimit=max(1.5, float(_SCAN_CLAHE_MASTER_CLIP)), tileGridSize=(8, 8))
        boosted = clahe_obj.apply(warped)

        kw = max(9, min(rw, max(9, rw // 10)))
        kh = max(3, min(rh, max(3, rh // 14)))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh))
        text_emphasis = cv2.morphologyEx(boosted, cv2.MORPH_BLACKHAT, kernel)

        _, bw = cv2.threshold(text_emphasis, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        if int(np.count_nonzero(bw)) < max(20, bw.size // 300):
            # Fallback when blackhat under-separates faint text on bright backgrounds.
            _, bw = cv2.threshold(boosted, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        row_sums = np.sum((bw > 0).astype(np.float32), axis=1)
        if row_sums.size < 4:
            return -1.0

        score = float(np.var(row_sums))
        peak_count = min(3, row_sums.size)
        if peak_count > 0:
            top_rows = np.partition(row_sums, -peak_count)[-peak_count:]
            score += 0.25 * float(np.sum(top_rows))
        return score
    except Exception:
        return -1.0


def _refine_mrz_strip_skew_angle(strip: "np.ndarray", measured_tilt_deg: float) -> float:
    """Fine-tune MRZ strip tilt using horizontal projection variance on the **entire** strip.

    Same sign convention as :func:`_text_based_deskew`. The combined MRZ ROI is almost
    entirely MRZ lines, so we refine on the full image (unlike :func:`_refine_passport_skew_angle`
    which uses only the bottom of the alignment crop).
    """
    if not HAS_OPENCV or strip is None or strip.size == 0:
        return measured_tilt_deg
    try:
        h, w = strip.shape[:2]
        if h < 24 or w < 80:
            return measured_tilt_deg
        try:
            half = float(os.environ.get("DESKEW_REFINE_HALF_DEG", "3.2"))
            step = float(os.environ.get("DESKEW_REFINE_STEP_DEG", "0.1"))
        except ValueError:
            half, step = 3.2, 0.1
        half = max(1.0, min(half, 5.0))
        step = max(0.05, min(step, 0.5))
        m0 = float(measured_tilt_deg)
        best_score = _mrz_strip_projection_score(strip, m0)
        best_tilt = m0
        n_steps = int(math.ceil((2 * half) / step)) + 1
        tilt = m0 - half
        for _ in range(max(1, n_steps)):
            if tilt > m0 + half + 1e-9:
                break
            score = _mrz_strip_projection_score(strip, tilt)
            if score > best_score:
                best_score = score
                best_tilt = float(tilt)
            tilt += step
        if DEBUG_ACTIVATE and abs(best_tilt - m0) > 0.06:
            logger.debug(
                "MRZ strip deskew refine: %.3f° -> %.3f° (text-row projection, score %.2f)",
                m0,
                best_tilt,
                best_score,
            )
        return best_tilt
    except Exception:
        return measured_tilt_deg


def _scale_mrz_roi_bands_y(
    band1: Optional[Tuple[float, float]],
    band2: Optional[Tuple[float, float]],
    roi_h_before: int,
    roi_h_after: int,
) -> Tuple[Optional[Tuple[float, float]], Optional[Tuple[float, float]]]:
    """After strip deskew, output height may change; scale y-bands proportionally (small-angle OK)."""
    if roi_h_before <= 0 or roi_h_after <= 0:
        return band1, band2
    s = float(roi_h_after) / float(roi_h_before)
    if abs(s - 1.0) < 1e-6:
        return band1, band2

    def _sc(b: Optional[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
        if b is None:
            return None
        lo, hi = b[0] * s, b[1] * s
        rh = float(roi_h_after)
        return (max(0.0, lo), min(rh, hi))

    return _sc(band1), _sc(band2)


def _deskew_passport_mrz_combined_roi(
    combined_roi: "np.ndarray",
    frame_index: Optional[int] = None,
) -> Tuple["np.ndarray", float]:
    """Measure tilt on the combined MRZ strip only, then rotate **that strip** (not the full page).

    When ``DESKEW_ENABLE`` is false, returns ``(combined_roi.copy(), 0.0)`` so callers build OCR
    variants from the **non-deskewed** strip only.

    Uses EasyOCR boxes + Hough on the **full** strip (``bottom_frac=1.0``), optional projection
    refine via :func:`_refine_mrz_strip_skew_angle`. Caches tilt under :data:`_MRZ_COMBINED_DESKEW_LABEL`
    when ``DESKEW_CACHE_ANGLE`` is on (same batch behavior as full-page deskew).

    Returns ``(strip_bgr, rotation_angle)`` where *rotation_angle* is the estimated text tilt
    in degrees (same convention as :func:`_text_based_deskew`).
    """
    label = _MRZ_COMBINED_DESKEW_LABEL
    if not HAS_OPENCV or combined_roi is None or combined_roi.size == 0:
        return combined_roi, 0.0

    if not DESKEW_ENABLE:
        if DEBUG_ACTIVATE:
            logger.info("MRZ strip deskew: skipped (DESKEW_ENABLE is False).")
        return combined_roi.copy(), 0.0

    # Fast path: reuse tilt from first frame of this passport batch.
    if DESKEW_CACHE_ANGLE and label in _deskew_cached_tilt_degrees:
        rotation_angle = float(_deskew_cached_tilt_degrees[label])
        base_image = _rotate_crop_by_measured_tilt(combined_roi, rotation_angle)
        applied_angle = -rotation_angle
        if _OCR_TIMING:
            logger.info(
                "[OCR_TIMING] MRZ strip deskew: reused tilt %.2f° — warp applied; skipped EasyOCR remeasure",
                rotation_angle,
            )
        if frame_index is not None and DEBUG_ACTIVATE and HAS_OPENCV:
            try:
                ddir = _get_debug_variants_dir("passport")
                ddir.mkdir(parents=True, exist_ok=True)
                dbg = base_image.copy()
                if dbg.ndim == 2:
                    dbg = cv2.cvtColor(dbg, cv2.COLOR_GRAY2BGR)
                _warped = abs(float(rotation_angle)) > 0.05
                cv2.putText(
                    dbg,
                    f"MRZ strip tilt={rotation_angle:+.2f} deg (reused)",
                    (6, 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (0, 255, 255),
                    2,
                )
                cv2.putText(
                    dbg,
                    "warpAffine on MRZ strip | skipped EasyOCR remeasure"
                    if _warped
                    else "no warp (|tilt|<=0.05 deg) | skipped remeasure",
                    (6, 44),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 255, 255),
                    2,
                )
                cv2.imwrite(
                    str((ddir / f"mrz_strip_deskew_debug_frame_{frame_index}.png").resolve()),
                    dbg,
                )
                _write_deskew_tilt_and_zone_debug(
                    "passport_mrz",
                    int(frame_index),
                    base_image,
                    rotation_angle,
                    applied_angle,
                    zone_source_bgr=dbg,
                    cached=True,
                )
            except Exception:
                pass
        return base_image, rotation_angle

    clahe_master, easyocr_results = _build_clahe_and_detect_boxes(combined_roi, label=label)

    if frame_index is not None and DEBUG_ACTIVATE:
        try:
            ddir = _get_debug_variants_dir("passport")
            ddir.mkdir(parents=True, exist_ok=True)
            vis = combined_roi.copy()
            if vis.ndim == 2:
                vis = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR)
            for bbox, txt, _conf in easyocr_results:
                pts = np.array(bbox, dtype=np.int32)
                cv2.polylines(vis, [pts], True, (0, 255, 0), 2)
            cv2.putText(
                vis,
                f"MRZ strip detection ({len(easyocr_results)} blocks)",
                (6, 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 255),
                2,
            )
            cv2.imwrite(
                str((ddir / f"mrz_strip_detection_boxes_frame_{frame_index}.png").resolve()),
                vis,
            )
        except Exception:
            pass

    weighted_angles: List[Tuple[float, float]] = []
    for bbox, txt, _conf in easyocr_results:
        if not txt:
            continue
        norm_txt = re.sub(r"[^A-Za-z0-9<]", "", txt)
        if len(norm_txt) < 10:
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        width = max(1.0, x2 - x1)
        height = max(1.0, y2 - y1)
        if width < height * 3.0:
            continue
        a = _box_angle(bbox)
        if a is None:
            continue
        weighted_angles.append((a, 1.0))

    rotation_angle = 0.0
    if weighted_angles:
        weighted_angles.sort(key=lambda t: t[0])
        total_w = sum(w for _, w in weighted_angles)
        threshold = total_w / 2.0
        acc = 0.0
        median_angle = 0.0
        for angle, w in weighted_angles:
            acc += w
            if acc >= threshold:
                median_angle = angle
                break
        if abs(median_angle) <= _DESKEW_MAX_ANGLE:
            rotation_angle = median_angle

    # Hough on the **entire** MRZ strip only (not a fraction of the passport page).
    # Compare it against the current seed using the MRZ text-row projection score, so
    # slightly non-zero EasyOCR box angles do not block a clearly better Hough estimate.
    hough_angle = _dominant_line_angle_hough(clahe_master, bottom_frac=1.0)
    if hough_angle is not None and abs(hough_angle) <= _DESKEW_MAX_ANGLE:
        seed_angle = rotation_angle
        current_score = _mrz_strip_projection_score(combined_roi, rotation_angle)
        hough_score = _mrz_strip_projection_score(combined_roi, hough_angle)
        if hough_score > current_score:
            rotation_angle = hough_angle
            logger.debug(
                "MRZ strip frame %s: using Hough tilt %.2f° over seed %.2f° (scores %.2f > %.2f)",
                frame_index,
                rotation_angle,
                seed_angle,
                hough_score,
                current_score,
            )

    if DESKEW_REFINE_PASSPORT and abs(rotation_angle) <= _DESKEW_MAX_ANGLE:
        rotation_angle = _refine_mrz_strip_skew_angle(combined_roi, rotation_angle)

    applied_angle = -rotation_angle
    base_image = _rotate_crop_by_measured_tilt(combined_roi, rotation_angle)

    if DESKEW_ENABLE and DESKEW_CACHE_ANGLE:
        _deskew_cached_tilt_degrees[label] = float(rotation_angle)

    if frame_index is not None and DEBUG_ACTIVATE and DESKEW_ENABLE:
        try:
            ddir = _get_debug_variants_dir("passport")
            ddir.mkdir(parents=True, exist_ok=True)
            vis = base_image.copy()
            if vis.ndim == 2:
                vis = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR)
            if applied_angle != 0.0 and easyocr_results:
                h, w = combined_roi.shape[:2]
                center = (w / 2.0, h / 2.0)
                M = cv2.getRotationMatrix2D(center, applied_angle, 1.0)
                cos_a = abs(M[0, 0])
                sin_a = abs(M[0, 1])
                new_w = int(h * sin_a + w * cos_a)
                new_h = int(h * cos_a + w * sin_a)
                M[0, 2] += (new_w - w) / 2.0
                M[1, 2] += (new_h - h) / 2.0
                for bbox, _txt, _conf in easyocr_results:
                    pts_src = np.array(bbox, dtype=np.float64)
                    ones = np.ones((pts_src.shape[0], 1), dtype=np.float64)
                    pts_h = np.hstack([pts_src, ones])
                    pts_rot = (M @ pts_h.T).T.astype(np.int32)
                    cv2.polylines(vis, [pts_rot], True, (0, 255, 0), 2)
            else:
                for bbox, _txt, _conf in easyocr_results:
                    pts = np.array(bbox, dtype=np.int32)
                    cv2.polylines(vis, [pts], True, (0, 255, 0), 2)
            cv2.putText(
                vis,
                f"MRZ strip tilt={rotation_angle:+.2f} deg ({len(weighted_angles)} blocks)",
                (6, 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 255),
                2,
            )
            cv2.imwrite(
                str((ddir / f"mrz_strip_deskew_debug_frame_{frame_index}.png").resolve()),
                vis,
            )
            vis_bgr = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR) if vis.ndim == 2 else vis
            _write_deskew_tilt_and_zone_debug(
                "passport_mrz",
                int(frame_index),
                base_image,
                rotation_angle,
                applied_angle,
                zone_source_bgr=vis_bgr,
                cached=False,
            )
        except Exception:
            pass

    if DEBUG_ACTIVATE:
        if abs(rotation_angle) > 0.05:
            logger.info(
                "MRZ strip deskew: estimated tilt=%.2f°, applied rotation=%.2f°.",
                rotation_angle,
                applied_angle,
            )
        else:
            logger.info(
                "MRZ strip deskew: tilt small (%.2f°) — no rotation.",
                rotation_angle,
            )

    return base_image, rotation_angle


def _box_angle(bbox: list) -> Optional[float]:
    """Return the tilt angle (degrees) of an EasyOCR bounding box.

    bbox is [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] (TL, TR, BR, BL).
    We measure the angle of the top edge (TL→TR).
    Note: EasyOCR often returns axis-aligned boxes, so this is usually 0.
    """
    try:
        (x0, y0), (x1, y1) = bbox[0], bbox[1]
        dx = x1 - x0
        dy = y1 - y0
        if abs(dx) < 1:
            return None
        return math.degrees(math.atan2(dy, dx))
    except Exception:
        return None


def _dominant_line_angle_hough(clahe: "np.ndarray", bottom_frac: float = 0.5) -> Optional[float]:
    """Estimate document tilt from dominant line angle in the bottom part of the image (Hough).

    EasyOCR returns axis-aligned bboxes so box-based angle is always 0. This uses Canny + HoughLinesP
    to find line segments, then the median angle of near-horizontal lines (weighted by length).

    To avoid outlier lines (holograms, photo edges, decorative elements) dominating the
    result, we use IQR-based outlier rejection: only lines whose angle falls within
    [Q1 - 1.5*IQR, Q3 + 1.5*IQR] of the distribution are kept. This means the majority
    of nearly-parallel lines win and a few steep outliers are discarded.

    Returns angle in degrees; None if no lines or failure.
    """
    if not HAS_OPENCV or clahe is None or clahe.size == 0:
        return None
    try:
        h, w = clahe.shape[:2]
        y_start = int(h * (1.0 - bottom_frac))
        y_start = max(0, min(y_start, h - 20))
        roi = clahe[y_start:h, 0:w]
        if roi.size == 0:
            return None
        edges = cv2.Canny(roi, 50, 150)
        lines = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=math.pi / 180,
            threshold=40,
            minLineLength=max(30, w // 8),
            maxLineGap=20,
        )
        if lines is None or len(lines) == 0:
            return None
        angles: List[Tuple[float, float]] = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = x2 - x1
            dy = y2 - y1
            length = math.sqrt(dx * dx + dy * dy)
            if length < 20:
                continue
            angle_deg = math.degrees(math.atan2(dy, dx))
            if abs(angle_deg) > 25:
                continue
            angles.append((angle_deg, length))
        if not angles:
            return None

        # IQR-based outlier rejection: keep only lines within the interquartile fence
        # so the majority of nearly-parallel lines dominate over stray diagonals.
        raw_angles = sorted(a for a, _ in angles)
        n = len(raw_angles)
        q1 = raw_angles[n // 4] if n >= 4 else raw_angles[0]
        q3 = raw_angles[(3 * n) // 4] if n >= 4 else raw_angles[-1]
        iqr = q3 - q1
        lo = q1 - 1.5 * iqr
        hi = q3 + 1.5 * iqr
        angles = [(a, l) for a, l in angles if lo <= a <= hi]
        if not angles:
            return None

        angles.sort(key=lambda t: t[0])
        total_len = sum(l for _, l in angles)
        half = total_len / 2.0
        acc = 0.0
        for a, l in angles:
            acc += l
            if acc >= half:
                return a
        return angles[len(angles) // 2][0]
    except Exception:
        return None


def _build_clahe_and_detect_boxes(
    raw_crop: "np.ndarray",
    label: str = "doc",
) -> Tuple["np.ndarray", List[list]]:
    """Build CLAHE from raw_crop and run EasyOCR to get text bounding boxes.

    Primary job: find text locations regardless of tilt. No angle or rotation.
    Returns (clahe_master, easyocr_results). Used by _text_based_deskew; tilt/rotation
    is optional and gated by DESKEW_ENABLE.
    """
    clahe_master = _build_clahe_master(raw_crop)
    easyocr_results: list = []
    reader = _get_easyocr_reader()
    if reader is not None:
        try:
            t0 = time.perf_counter() if _OCR_TIMING else None
            easyocr_results = reader.readtext(clahe_master)
            if _OCR_TIMING and t0 is not None:
                logger.info("[OCR_TIMING] EasyOCR readtext (deskew %s): %.2fs", label, time.perf_counter() - t0)
        except Exception:
            pass
    return clahe_master, easyocr_results


def _write_deskew_tilt_and_zone_debug(
    label: str,
    frame_index: int,
    base_image: "np.ndarray",
    rotation_angle: float,
    applied_angle: float,
    *,
    zone_source_bgr: "np.ndarray",
    cached: bool = False,
) -> None:
    """Write ``deskew_tilt_*`` and per-frame ``deskew_debug_zone_*`` (same *base_image* MRZ pipeline uses)."""
    if not DEBUG_ACTIVATE or not DESKEW_ENABLE or not HAS_OPENCV:
        return
    try:
        ddir = _get_debug_variants_dir(label)
        ddir.mkdir(parents=True, exist_ok=True)

        tilt_vis = base_image.copy()
        if tilt_vis.ndim == 2:
            tilt_vis = cv2.cvtColor(tilt_vis, cv2.COLOR_GRAY2BGR)
        est_angle = rotation_angle
        rot_angle = applied_angle
        abs_est = abs(est_angle)
        tilt_status = "applied" if abs_est > 0.05 else "skipped"
        est_text = f"estimated tilt: {est_angle:+.2f} deg"
        if abs(rot_angle) > 0.05:
            rot_dir = "anticlockwise" if rot_angle > 0 else "clockwise"
            rot_text = f"applied rotation: {rot_angle:+.2f} deg ({rot_dir})"
        else:
            rot_text = "applied rotation: 0.00 deg (none)"
        if cached:
            est_text = f"{est_text}  [CACHED]"
        cv2.putText(
            tilt_vis,
            est_text,
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 255),
            2,
        )
        cv2.putText(
            tilt_vis,
            rot_text,
            (10, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 255),
            2,
        )
        if tilt_status == "applied" and abs(rot_angle) > 0.05:
            h_t, w_t = tilt_vis.shape[:2]
            x_mid, y_mid = w_t // 2, h_t // 2
            length = max(40, w_t // 6)
            if rot_angle < 0:
                p1 = (x_mid - length, y_mid - length // 2)
                p2 = (x_mid + length, y_mid + length // 2)
            else:
                p1 = (x_mid - length, y_mid + length // 2)
                p2 = (x_mid + length, y_mid - length // 2)
            cv2.arrowedLine(tilt_vis, p1, p2, (0, 255, 0), 3, tipLength=0.2)

        tilt_path = ddir / f"deskew_tilt_{label}_frame_{frame_index}.png"
        cv2.imwrite(str(tilt_path.resolve()), tilt_vis)

        zones_vis = zone_source_bgr.copy()
        if zones_vis.ndim == 2:
            zones_vis = cv2.cvtColor(zones_vis, cv2.COLOR_GRAY2BGR)
        zh, zw = zones_vis.shape[:2]
        zone_specs = [
            (int(zh * 0.55), "45%", (255, 0, 0)),
            (int(zh * 0.65), "35%", (0, 255, 0)),
            (int(zh * 0.75), "25%", (0, 0, 255)),
            (int(zh * 0.85), "15%", (255, 255, 0)),
        ]
        for y, zone_lbl, color in zone_specs:
            if 0 <= y < zh:
                cv2.line(zones_vis, (0, y), (zw, y), color, 2)
                cv2.putText(
                    zones_vis,
                    f"bottom {zone_lbl}",
                    (10, y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    1,
                )
        zones_path = ddir / f"deskew_debug_zone_{label}_frame_{frame_index}.png"
        cv2.imwrite(str(zones_path.resolve()), zones_vis)
    except Exception:
        pass


def _text_based_deskew(
    raw_crop: "np.ndarray",
    frame_index: Optional[int] = None,
    label: str = "doc",
) -> Tuple["np.ndarray", List[list], float]:
    """CLAHE + detection; tilt/rotation when DESKEW_ENABLE is True.

    Pipeline:
      A. If DESKEW_ENABLE + DESKEW_CACHE_ANGLE and a tilt was cached for *label* (same scan batch),
         apply :func:`_rotate_crop_by_measured_tilt` only — **no** deskew EasyOCR ``readtext``.
      B. Else: _build_clahe_and_detect_boxes: CLAHE + EasyOCR → bounding boxes (always).
      C. If DESKEW_ENABLE: compute angle from boxes (weighted median + Hough for passport), rotate
         raw_crop and store tilt in cache when DESKEW_CACHE_ANGLE; else return raw_crop unchanged.

    Returns (base_image, easyocr_results, rotation_angle_degrees) where *rotation_angle* is the
    estimated text tilt (degrees), not the applied warp angle.
    """
    if not HAS_OPENCV or raw_crop is None or raw_crop.size == 0:
        return raw_crop, [], 0.0

    # Fast path: reuse tilt from the first frame of this batch (no deskew readtext).
    if DESKEW_ENABLE and DESKEW_CACHE_ANGLE and label in _deskew_cached_tilt_degrees:
        rotation_angle = float(_deskew_cached_tilt_degrees[label])
        base_image = _rotate_crop_by_measured_tilt(raw_crop, rotation_angle)
        applied_angle = -rotation_angle
        if _OCR_TIMING:
            logger.info(
                "[OCR_TIMING] Deskew %s: reused tilt %.2f° — warp still applied; skipped EasyOCR remeasure",
                label,
                rotation_angle,
            )
        if DEBUG_ACTIVATE:
            if abs(rotation_angle) > 0.05:
                logger.info(
                    "Deskew %s: estimated tilt=%.2f°, applied rotation=%.2f° (cached).",
                    label,
                    rotation_angle,
                    applied_angle,
                )
            else:
                logger.info(
                    "Deskew %s: estimated tilt small (%.2f°) — no rotation (cached).",
                    label,
                    rotation_angle,
                )
        # Same deskewed pixels as MRZ; without this, zone PNG had no frame id and cache frames wrote nothing.
        if frame_index is not None and DEBUG_ACTIVATE and DESKEW_ENABLE and HAS_OPENCV:
            try:
                ddir = _get_debug_variants_dir(label)
                ddir.mkdir(parents=True, exist_ok=True)
                dbg = base_image.copy()
                if dbg.ndim == 2:
                    dbg = cv2.cvtColor(dbg, cv2.COLOR_GRAY2BGR)
                # "Cached" = reuse angle from first frame in batch. Rotation (warp) still runs unless |tilt|<=0.05 deg.
                _warped = abs(float(rotation_angle)) > 0.05
                cv2.putText(
                    dbg,
                    f"tilt={rotation_angle:+.2f} deg (reused angle)",
                    (10, 28),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 255),
                    2,
                )
                cv2.putText(
                    dbg,
                    "warpAffine APPLIED | skipped EasyOCR remeasure (speed)"
                    if _warped
                    else "no warp (|tilt|<=0.05 deg) | skipped EasyOCR remeasure",
                    (10, 54),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (0, 255, 255),
                    2,
                )
                cv2.imwrite(
                    str((ddir / f"deskew_debug_{label}_frame_{frame_index}.png").resolve()),
                    dbg,
                )
                _write_deskew_tilt_and_zone_debug(
                    label,
                    frame_index,
                    base_image,
                    rotation_angle,
                    applied_angle,
                    zone_source_bgr=dbg,
                    cached=True,
                )
            except Exception:
                pass
        return base_image, [], rotation_angle

    clahe_master, easyocr_results = _build_clahe_and_detect_boxes(raw_crop, label=label)

    # Save detection boxes debug image whenever debug is on (even when DESKEW_ENABLE is False).
    if frame_index is not None and DEBUG_ACTIVATE:
        try:
            ddir = _get_debug_variants_dir(label)
            ddir.mkdir(parents=True, exist_ok=True)
            vis = raw_crop.copy()
            if vis.ndim == 2:
                vis = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR)
            for bbox, txt, _conf in easyocr_results:
                pts = np.array(bbox, dtype=np.int32)
                cv2.polylines(vis, [pts], True, (0, 255, 0), 2)
            cv2.putText(
                vis,
                f"detection boxes ({len(easyocr_results)} blocks)",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )
            detection_path = ddir / f"detection_boxes_{label}_frame_{frame_index}.png"
            cv2.imwrite(str(detection_path.resolve()), vis)
        except Exception:
            pass

    if not DESKEW_ENABLE:
        if DEBUG_ACTIVATE:
            logger.info("Deskew %s: skipped (DESKEW_ENABLE is False).", label)
        return raw_crop.copy(), easyocr_results, 0.0

    # Collect candidate angles from long horizontal text lines (MRZ, titles).
    # Short or steep blocks (signatures, dates) are skipped.
    # All text lines are weighted equally regardless of vertical position.
    weighted_angles: List[Tuple[float, float]] = []
    for bbox, txt, _conf in easyocr_results:
        if not txt:
            continue
        norm_txt = re.sub(r"[^A-Za-z0-9<]", "", txt)
        if len(norm_txt) < 10:
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        width = max(1.0, x2 - x1)
        height = max(1.0, y2 - y1)
        if width < height * 3.0:
            continue
        a = _box_angle(bbox)
        if a is None:
            continue
        weighted_angles.append((a, 1.0))

    rotation_angle = 0.0
    if weighted_angles:
        weighted_angles.sort(key=lambda t: t[0])
        total_w = sum(w for _, w in weighted_angles)
        threshold = total_w / 2.0
        acc = 0.0
        median_angle = 0.0
        for angle, w in weighted_angles:
            acc += w
            if acc >= threshold:
                median_angle = angle
                break
        if abs(median_angle) <= _DESKEW_MAX_ANGLE:
            rotation_angle = median_angle

    # EasyOCR returns axis-aligned bboxes, so box angles are usually 0. Use Hough line fallback.
    # Passport MRZ uses strip-only deskew elsewhere; full-page deskew here applies only to *card*
    # and any legacy callers — use the full CLAHE image for Hough (no passport bottom-fraction bias).
    # For cards Hough is disabled entirely because decorative lines produce misleading angles.
    if label != "card" and abs(rotation_angle) < 0.15:
        hough_angle = _dominant_line_angle_hough(clahe_master, bottom_frac=1.0)
        if hough_angle is not None and abs(hough_angle) <= _DESKEW_MAX_ANGLE:
            rotation_angle = hough_angle
            logger.debug(
                "%s frame %s: using Hough line angle %.2f° (bottom_frac=1.0, EasyOCR boxes axis-aligned)",
                label,
                frame_index,
                rotation_angle,
            )

    # Applied correction is the opposite of the measured tilt.
    applied_angle = -rotation_angle
    base_image = _rotate_crop_by_measured_tilt(raw_crop, rotation_angle)
    if abs(rotation_angle) > 0.05:
        logger.debug(
            "%s frame %s: text-deskew rotated %.2f° (estimated tilt=%.2f°, %d text blocks)",
            label,
            frame_index,
            applied_angle,
            rotation_angle,
            len(weighted_angles),
        )
    else:
        logger.debug(
            "%s frame %s: text-deskew skipped (angle=%.2f°, %d weighted blocks)",
            label,
            frame_index,
            rotation_angle,
            len(weighted_angles),
        )

    if DESKEW_ENABLE and DESKEW_CACHE_ANGLE:
        _deskew_cached_tilt_degrees[label] = float(rotation_angle)

    if frame_index is not None and DEBUG_ACTIVATE and DESKEW_ENABLE:
        try:
            ddir = _get_debug_variants_dir(label)
            ddir.mkdir(parents=True, exist_ok=True)

            # Standard deskew debug with detection boxes overlaid on the (possibly rotated) base image.
            vis = base_image.copy()
            if applied_angle != 0.0 and easyocr_results:
                h, w = raw_crop.shape[:2]
                center = (w / 2.0, h / 2.0)
                M = cv2.getRotationMatrix2D(center, applied_angle, 1.0)
                cos_a = abs(M[0, 0])
                sin_a = abs(M[0, 1])
                new_w = int(h * sin_a + w * cos_a)
                new_h = int(h * cos_a + w * sin_a)
                M[0, 2] += (new_w - w) / 2.0
                M[1, 2] += (new_h - h) / 2.0
                for bbox, txt, conf in easyocr_results:
                    pts_src = np.array(bbox, dtype=np.float64)
                    ones = np.ones((pts_src.shape[0], 1), dtype=np.float64)
                    pts_h = np.hstack([pts_src, ones])
                    pts_rot = (M @ pts_h.T).T.astype(np.int32)
                    cv2.polylines(vis, [pts_rot], True, (0, 255, 0), 2)
            else:
                for bbox, txt, conf in easyocr_results:
                    pts = np.array(bbox, dtype=np.int32)
                    cv2.polylines(vis, [pts], True, (0, 255, 0), 2)
            cv2.putText(
                vis,
                f"tilt={rotation_angle:+.2f} deg  ({len(weighted_angles)} blocks)",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )
            debug_path = ddir / f"deskew_debug_{label}_frame_{frame_index}.png"
            cv2.imwrite(str(debug_path.resolve()), vis)

            if vis.ndim == 2:
                vis_bgr = cv2.cvtColor(vis, cv2.COLOR_GRAY2BGR)
            else:
                vis_bgr = vis
            _write_deskew_tilt_and_zone_debug(
                label,
                frame_index,
                base_image,
                rotation_angle,
                applied_angle,
                zone_source_bgr=vis_bgr,
                cached=False,
            )
        except Exception:
            pass

    if DEBUG_ACTIVATE:
        if abs(rotation_angle) > 0.05:
            logger.info(
                "Deskew %s: estimated tilt=%.2f°, applied rotation=%.2f°.",
                label,
                rotation_angle,
                applied_angle,
            )
        else:
            logger.info(
                "Deskew %s: estimated tilt small (%.2f°) — no rotation applied.",
                label,
                rotation_angle,
            )

    return base_image, easyocr_results, rotation_angle


def _detect_rois_via_easyocr(
    clahe_master: "np.ndarray", card_h: int, card_w: int
) -> Tuple[
    Optional[Tuple[int, int, int, int]],
    Optional[Tuple[int, int, int, int]],
    Optional[Tuple[int, int, int, int]],
]:
    """Pass 2 (Card): Targeted search on straightened base image for PAN, expiry, and name.

    Runs EasyOCR.readtext() on the CLAHE master. Filters for:
      - PAN: 12–19 digit horizontal blocks on the same row (longest digit row wins).
      - Expiry: MM/YY pattern (with some separators).
      - Name: text below the PAN row with no digits, at least 2 words (normalized as in _gate_name).

    Returns (pan_box, expiry_box, name_box) in card coordinates for use as crop coordinates.
    No CARD_ZONES fallback – boxes are derived purely from EasyOCR detections.
    """
    reader = _get_easyocr_reader()
    if reader is None:
        return None, None
    try:
        t0 = time.perf_counter() if _OCR_TIMING else None
        results = reader.readtext(clahe_master)
        if _OCR_TIMING and t0 is not None:
            logger.info("[OCR_TIMING] EasyOCR readtext (card ROI detect): %.2fs", time.perf_counter() - t0)
    except Exception:
        return None, None
    if not results:
        return None, None

    pan_box: Optional[Tuple[int, int, int, int]] = None
    expiry_box: Optional[Tuple[int, int, int, int]] = None
    name_box: Optional[Tuple[int, int, int, int]] = None

    rows: List[Dict[str, Any]] = []
    expiry_pattern = re.compile(r"(0[1-9]|1[0-2])[/\s\-]*\d{2}")

    for bbox, txt, conf in results:
        if not txt:
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        top_y, bottom_y = min(ys), max(ys)
        mid_y = (top_y + bottom_y) / 2.0
        digits = sum(c.isdigit() for c in txt)

        if "/" in txt and expiry_pattern.search(txt) and expiry_box is None:
            x1 = max(0, int(min(xs)))
            x2 = min(card_w, int(max(xs)))
            y1 = max(0, int(min(ys)))
            y2 = min(card_h, int(max(ys)))
            margin = max(2, int(0.02 * min(card_h, card_w)))
            expiry_box = (max(0, x1 - margin), max(0, y1 - margin), min(card_w, x2 + margin), min(card_h, y2 + margin))

        if digits >= 4 and "/" not in txt:
            assigned = False
            for row in rows:
                if abs(row["mid_y"] - mid_y) <= 0.04 * card_h:
                    row["boxes"].append((xs, ys, digits))
                    row["mid_y"] = (row["mid_y"] + mid_y) / 2.0
                    assigned = True
                    break
            if not assigned:
                rows.append({"mid_y": mid_y, "boxes": [(xs, ys, digits)]})

    best_score = -1
    best_row_mid_y: Optional[float] = None
    for row in rows:
        all_x: List[float] = []
        all_y: List[float] = []
        total_digits = 0
        for rxs, rys, d in row["boxes"]:
            all_x.extend(rxs)
            all_y.extend(rys)
            total_digits += d
        if not all_x or total_digits == 0:
            continue
        x1 = int(max(0, min(all_x)))
        x2 = int(min(card_w, max(all_x)))
        y1 = int(max(0, min(all_y)))
        y2 = int(min(card_h, max(all_y)))
        if x2 <= x1 or y2 <= y1:
            continue
        in_range = 12 <= total_digits <= 19
        score = (2 if in_range else 1) * total_digits
        if score > best_score:
            best_score = score
            my = max(2, int(0.01 * card_h))
            mx = max(4, int(0.01 * card_w))
            pan_box = (max(0, x1 - mx), max(0, y1 - my), min(card_w, x2 + mx), min(card_h, y2 + my))
            best_row_mid_y = row["mid_y"]

    # Derive a name box purely from EasyOCR: look for name-like text below the PAN row.
    if pan_box is not None and best_row_mid_y is not None:
        px1, py1, px2, py2 = pan_box
        pan_mid_y = (py1 + py2) / 2.0
        name_top = min(card_h, int(pan_mid_y + 0.02 * card_h))
        name_bottom = min(card_h, int(card_h * 0.9))
        name_xs: List[int] = []
        name_ys: List[int] = []
        for bbox, txt, conf in results:
            if not txt:
                continue
            # Skip anything with digits – we want pure name-like text.
            if any(c.isdigit() for c in txt):
                continue
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            top_y, bottom_y = min(ys), max(ys)
            mid_y = (top_y + bottom_y) / 2.0
            if mid_y < name_top or mid_y > name_bottom:
                continue
            norm = _normalize_cardholder_name_ocr(txt)
            # At detection time accept any non-empty normalized name; later gates
            # (blocklist, regex) filter out non-name text like MASTERCARD, etc.
            if not norm:
                continue
            name_xs.extend(xs)
            name_ys.extend(ys)

        if name_xs and name_ys:
            nx1 = max(0, int(min(name_xs)))
            nx2 = min(card_w, int(max(name_xs)))
            ny1 = max(0, int(min(name_ys)))
            ny2 = min(card_h, int(max(name_ys)))
            if nx2 > nx1 and ny2 > ny1:
                name_box = (nx1, ny1, nx2, ny2)

    return pan_box, expiry_box, name_box


def _get_card_rois(
    frame: "np.ndarray", frame_index: Optional[int] = None, save_debug_images: bool = True
) -> Dict[str, Any]:
    """Two-pass card ROI: straighten then targeted search. No reuse of deskew boxes.

    Pass 1 (Straighten): Text-based deskew → median tilt, rotate raw crop → Base Image. Upscale 2x.
    Pass 2 (Targeted Search): Dedicated EasyOCR on Base Image (CLAHE) to find PAN (12–19 digits)
    and MM/YY expiry only. Use Pass 2 boxes for cropping and 5-variant shotgun; fall back to
    CARD_ZONES only if Pass 2 finds nothing.

    save_debug_images: if False, do not write deskew/name_roi debug files (e.g. when running
    from test image so passport-sized debug images are not overwritten by smaller card images).

    Returns dict including 'num_roi', 'exp_roi', 'name_roi', 'strip', 'processed_card',
    'was_rotated', 'detected_pan_box', 'detected_expiry_box'.
    """
    result: Dict[str, Any] = {
        "num_roi": None,
        "exp_roi": None,
        "name_roi": None,
        "strip": None,
        "processed_card": None,
        "was_rotated": False,
        "detected_pan_box": None,
        "detected_expiry_box": None,
        "detected_name_box": None,
    }
    if not HAS_OPENCV or frame is None or frame.size == 0:
        return result
    raw_crop = _preprocess_card_alignment_crop(_crop_to_alignment_region(frame))

    # Pass 1 (The Straighten): median tilt angle only; do not use any boxes from this step.
    deskew_frame_index = frame_index if save_debug_images else None
    card, _ocr_results, angle = _text_based_deskew(raw_crop, frame_index=deskew_frame_index, label="card")
    result["was_rotated"] = abs(angle) > 0.05

    h_pre, w_pre = card.shape[:2]
    # Keep original card resolution; no resizing / stretching.
    result["processed_card"] = card

    try:
        h, w = card.shape[:2]

        # Pass 2 (Targeted Search): dedicated EasyOCR on straightened base image for PAN (12–19 digits),
        # MM/YY expiry, and name. No CARD_ZONES fallback here; boxes are derived purely from detections.
        clahe_master = _build_clahe_master(card)
        pan_box, expiry_box, name_box = _detect_rois_via_easyocr(clahe_master, h, w)

        if pan_box is not None:
            pan_box = _expand_pass2_box(pan_box[0], pan_box[1], pan_box[2], pan_box[3], w, h)
        if expiry_box is not None:
            expiry_box = _expand_pass2_box(expiry_box[0], expiry_box[1], expiry_box[2], expiry_box[3], w, h)
        result["detected_pan_box"] = pan_box
        result["detected_expiry_box"] = expiry_box
        result["detected_name_box"] = name_box

        # Number ROI and strip: only when PAN detection succeeded.
        if pan_box is not None:
            x1n, y1n, x2n, y2n = pan_box
            logger.debug(
                "Frame %s: EasyOCR detected PAN box (expanded) (%d,%d,%d,%d)",
                frame_index,
                x1n,
                y1n,
                x2n,
                y2n,
            )
            if x2n > x1n and y2n > y1n:
                result["num_roi"] = card[y1n:y2n, x1n:x2n]

            gap = max(2, int(0.005 * h))
            # Start the strip slightly *below* the PAN bottom so it focuses on
            # the typical name region rather than overlapping the number row.
            y1_strip = min(h, y2n + gap)
            y2_strip = min(h, int(h * 0.82))
            # Use full card width for the strip so single-word names that start
            # left or right of the PAN box are not clipped.
            x1_strip, x2_strip = 0, w
            if y2_strip > y1_strip and x2_strip > x1_strip:
                result["strip"] = card[y1_strip:y2_strip, x1_strip:x2_strip].copy()
        else:
            logger.warning("Card frame %s: PAN detection failed; num_roi and strip are empty", frame_index)

        # Expiry ROI: only when expiry detection succeeded.
        if expiry_box is not None:
            ex1, ey1, ex2, ey2 = expiry_box
            if ex2 > ex1 and ey2 > ey1:
                result["exp_roi"] = card[ey1:ey2, ex1:ex2]
            logger.debug(
                "Frame %s: EasyOCR detected expiry box (expanded) (%d,%d,%d,%d)",
                frame_index,
                ex1,
                ey1,
                ex2,
                ey2,
            )
        else:
            logger.warning("Card frame %s: expiry detection failed; exp_roi is empty", frame_index)

        # Name ROI: only when name_box was found.
        if name_box is not None:
            nx1, ny1, nx2, ny2 = name_box
            if nx2 > nx1 and ny2 > ny1:
                result["name_roi"] = card[ny1:ny2, nx1:nx2]
        else:
            logger.warning("Card frame %s: name detection failed; name_roi is empty", frame_index)

        if DEBUG_ACTIVATE and save_debug_images and frame_index is not None:
            try:
                ddir = _get_debug_variants_dir("card")
                ddir.mkdir(parents=True, exist_ok=True)
                deskew_path = ddir / f"deskewed_frame_{frame_index}.png"
                cv2.imwrite(str(deskew_path.resolve()), card)
            except Exception:
                pass
    except Exception:
        pass
    return result


def _apply_deskew_boost(
    pool: List[Tuple[str, float]],
) -> List[Tuple[str, float]]:
    """Multiply every confidence score in *pool* by _DESKEW_CONFIDENCE_BOOST."""
    return [(txt, conf * _DESKEW_CONFIDENCE_BOOST) for txt, conf in pool]


def _apply_deskew_boost_mrz(
    pool: List[Tuple[str, float, str]],
) -> List[Tuple[str, float, str]]:
    """Same as _apply_deskew_boost but preserve MRZ variant/source tag on each entry."""
    return [(txt, conf * _DESKEW_CONFIDENCE_BOOST, vkey) for txt, conf, vkey in pool]


def _collect_card_raw_pools(
    frame: "np.ndarray", frame_index: Optional[int] = None, save_debug_images: bool = True
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], List[Tuple[str, float]]]:
    """Stage 1+2 for one card frame: text-based deskew, per-frame ROI detection,
    then 5-variant shotgun OCR.  If the frame was rotated (deskewed), every
    OCR result gets a 1.2x confidence boost since straightened text is more
    reliable.
    save_debug_images: if False, do not write card debug/variant files (e.g. when
    running from test image after passport so all debug stays at passport size).
    Returns (pan_pool, expiry_pool, name_pool) — raw (text, confidence) lists.
    """
    pan_pool: List[Tuple[str, float]] = []
    expiry_pool: List[Tuple[str, float]] = []
    name_pool: List[Tuple[str, float]] = []

    rois = _get_card_rois(frame, frame_index=frame_index, save_debug_images=save_debug_images)
    num_roi = rois["num_roi"]
    exp_roi = rois["exp_roi"]
    name_roi = rois["name_roi"]
    strip = rois["strip"]
    was_rotated = rois.get("was_rotated", False)
    detected_pan = rois.get("detected_pan_box")
    detected_expiry = rois.get("detected_expiry_box")
    detected_name = rois.get("detected_name_box")

    if num_roi is not None and num_roi.size > 0:
        pan_pool.extend(_shotgun_ocr_on_pan_roi(num_roi, frame_index=frame_index or 0))

    # Save 6 full-frame variants with all classified ROI boxes.
    if (detected_pan is not None or detected_expiry is not None) and rois.get("processed_card") is not None:
        if (
            DEBUG_ACTIVATE
            and DEBUG_SAVE_VARIANTS
            and HAS_OPENCV
            and frame_index is not None
            and not _debug_variants_saved_card
        ):
            try:
                card_full = rois["processed_card"]
                ch, cw = card_full.shape[:2]
                variants = _build_six_variants(card_full)

                # Compute strip box coordinates (mirrors _get_card_rois logic).
                strip_box = None
                if detected_pan is not None:
                    _px1, _py1, _px2, py2n = detected_pan
                    gap = max(2, int(0.005 * ch))
                    # Start the strip slightly below the PAN bottom so the band
                    # tracks the expected name region.
                    sy1 = min(ch, py2n + gap)
                    sy2 = min(ch, int(ch * 0.82))
                    if sy2 > sy1:
                        strip_box = (0, sy1, cw, sy2)

                if len(variants) == 5:
                    for i in range(len(variants)):
                        v = variants[i]
                        if v.ndim == 2:
                            v = cv2.cvtColor(v, cv2.COLOR_GRAY2BGR)
                            variants[i] = v
                        if detected_pan is not None:
                            x1, y1, x2, y2 = detected_pan
                            cv2.rectangle(variants[i], (x1, y1), (x2, y2), (255, 0, 0), 2)        # blue: PAN
                        if detected_expiry is not None:
                            x1, y1, x2, y2 = detected_expiry
                            cv2.rectangle(variants[i], (x1, y1), (x2, y2), (0, 255, 255), 2)      # yellow: expiry
                        if detected_name is not None:
                            x1, y1, x2, y2 = detected_name
                            cv2.rectangle(variants[i], (x1, y1), (x2, y2), (255, 0, 255), 2)      # magenta: name
                        if strip_box is not None:
                            x1, y1, x2, y2 = strip_box
                            cv2.rectangle(variants[i], (x1, y1), (x2, y2), (0, 255, 0), 2)        # green: strip
                    _save_debug_variants(variants, frame_index, doc_type="card")
            except Exception:
                pass

    if strip is not None and strip.size > 0:
        name_strip = strip.copy()
        name_pool.extend(_shotgun_ocr_on_roi(name_strip, frame_index=frame_index or 0))

    if exp_roi is not None and exp_roi.size > 0:
        expiry_pool.extend(_shotgun_ocr_on_roi(exp_roi, frame_index=frame_index or 0))

    if name_roi is not None and name_roi.size > 0:
        name_pool.extend(_shotgun_ocr_on_roi(name_roi, frame_index=frame_index or 0))

    if was_rotated:
        pan_pool = _apply_deskew_boost(pan_pool)
        expiry_pool = _apply_deskew_boost(expiry_pool)
        name_pool = _apply_deskew_boost(name_pool)

    return pan_pool, expiry_pool, name_pool


def scan_card_from_frame(frame: "np.ndarray", frame_index: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Process one card frame through the unified mass consensus pipeline (Stages 1-4).

    When called with a single frame (e.g. from the API), the pipeline still
    builds filter variants and runs shotgun OCR, then gates + votes on that
    single frame's pool.
    """
    if frame is None or frame.size == 0:
        return None
    pan_pool, expiry_pool, name_pool = _collect_card_raw_pools(frame, frame_index=frame_index)

    valid_pans = _gate_pan(pan_pool)
    valid_expiries = _gate_expiry(expiry_pool)
    valid_names = _gate_name(name_pool)

    card_no, _pan_score, _pan_cnt = _confidence_weighted_vote(valid_pans)
    expiry, _exp_score, _exp_cnt = _confidence_weighted_vote(valid_expiries)
    cardholder_name, _nm_score, _nm_cnt = _confidence_weighted_vote(valid_names)

    if not card_no and not expiry and not cardholder_name:
        return None
    return {
        "card_no": card_no,
        "expiry": expiry,
        "cvv": None,
        "cardholder_name": cardholder_name,
        "raw_text": "",
    }



def scan_card() -> Optional[Dict[str, Any]]:
    """Scan credit card via camera: capture top-2 raw → verify → then process
    through the mass consensus pipeline (deskew, detection master, shotgun OCR,
    gate, confidence-weighted vote).
    """
    if not HAS_OPENCV or not HAS_EASYOCR:
        logger.info("MOCK HARDWARE/OCR: Simulating card scan")
        return {
            "card_no": "1234567890123456",
            "expiry": "12/25",
            "cvv": "123",
            "cardholder_name": "JOHN DOE",
        }

    _clear_roi_debug_images("card")
    logger.info("Scanning card with camera (top-2 raw capture, 5-variant x 3-engine shotgun)...")

    global _debug_variants_saved_card
    _debug_variants_saved_card = False
    reset_deskew_angle_cache("card")

    while True:
        frames = capture_card_frames()
        if not frames:
            logger.warning("No frames captured")
            return None
        if _show_capture_for_verification(frames[0], doc_type="card"):
            break
        print("Retaking card image...")

    if DEBUG_ACTIVATE:
        print("Processing images (deskew + detection master + shotgun OCR, mass consensus)...")

    all_pan: List[Tuple[str, float]] = []
    all_expiry: List[Tuple[str, float]] = []
    all_name: List[Tuple[str, float]] = []

    for idx, one_frame in enumerate(frames, start=1):
        pan_pool, exp_pool, name_pool = _collect_card_raw_pools(one_frame, frame_index=idx)
        if not pan_pool and not exp_pool and not name_pool:
            logger.debug("Frame %d: detection failed — skipping to next frame", idx)
            continue
        all_pan.extend(pan_pool)
        all_expiry.extend(exp_pool)
        all_name.extend(name_pool)
        logger.debug("Frame %d: pan_raw=%d expiry_raw=%d name_raw=%d", idx, len(pan_pool), len(exp_pool), len(name_pool))

    valid_pans = _gate_pan(all_pan)
    valid_expiries = _gate_expiry(all_expiry)
    valid_names = _gate_name(all_name)

    card_no, pan_score, pan_cnt = _confidence_weighted_vote(valid_pans)
    expiry, exp_score, exp_cnt = _confidence_weighted_vote(valid_expiries)
    cardholder_name, nm_score, nm_cnt = _confidence_weighted_vote(valid_names)

    _print_consensus("PAN", valid_pans, card_no, raw_pool_size=len(all_pan))
    _print_consensus("Expiry", valid_expiries, expiry, raw_pool_size=len(all_expiry))
    _print_consensus("Name", valid_names, cardholder_name, raw_pool_size=len(all_name))

    if card_no is None:
        logger.warning("Card scan consensus failed: no Luhn-valid PAN from %d raw pool entries", len(all_pan))

    has_any = card_no or expiry or cardholder_name
    if not has_any:
        return None

    return {
        "card_no": card_no,
        "expiry": expiry,
        "cvv": None,
        "cardholder_name": cardholder_name,
        "raw_text": "",
    }


def scan_card_from_frames(
    frames: List["np.ndarray"], skip_clear_roi: bool = False
) -> Optional[Dict[str, Any]]:
    """Same pipeline as scan_card() but using a list of frames (e.g. from a file).
    Uses 3 frames → deskew + Pass 2 + 5 variants, mass consensus. No camera or verification UI.
    skip_clear_roi: if True, do not clear ROI/debug images (e.g. when running after passport in test script)."""
    if not frames or not HAS_EASYOCR:
        return None
    for f in frames:
        if f is None or f.size == 0:
            return None

    _clear_roi_debug_images("card")
    logger.info("Processing card from %d frame(s) (deskew + detection + shotgun consensus)...", len(frames))
    global _debug_variants_saved_card
    _debug_variants_saved_card = False
    reset_deskew_angle_cache("card")

    all_pan: List[Tuple[str, float]] = []
    all_expiry: List[Tuple[str, float]] = []
    all_name: List[Tuple[str, float]] = []

    save_debug = not skip_clear_roi
    for idx, one_frame in enumerate(frames, start=1):
        pan_pool, exp_pool, name_pool = _collect_card_raw_pools(
            one_frame, frame_index=idx, save_debug_images=save_debug
        )
        if not pan_pool and not exp_pool and not name_pool:
            logger.debug("Frame %d: detection failed — skipping", idx)
            continue
        all_pan.extend(pan_pool)
        all_expiry.extend(exp_pool)
        all_name.extend(name_pool)
        logger.debug("Frame %d: pan_raw=%d expiry_raw=%d name_raw=%d", idx, len(pan_pool), len(exp_pool), len(name_pool))

    valid_pans = _gate_pan(all_pan)
    valid_expiries = _gate_expiry(all_expiry)
    valid_names = _gate_name(all_name)

    card_no, pan_score, pan_cnt = _confidence_weighted_vote(valid_pans)
    expiry, exp_score, exp_cnt = _confidence_weighted_vote(valid_expiries)
    cardholder_name, nm_score, nm_cnt = _confidence_weighted_vote(valid_names)

    _print_consensus("PAN", valid_pans, card_no, raw_pool_size=len(all_pan))
    _print_consensus("Expiry", valid_expiries, expiry, raw_pool_size=len(all_expiry))
    _print_consensus("Name", valid_names, cardholder_name, raw_pool_size=len(all_name))

    if card_no is None:
        logger.warning("Card scan consensus failed: no Luhn-valid PAN from %d raw pool entries", len(all_pan))

    has_any = card_no or expiry or cardholder_name
    if not has_any:
        return None

    return {
        "card_no": card_no,
        "expiry": expiry,
        "cvv": None,
        "cardholder_name": cardholder_name,
        "raw_text": "",
    }


def scan_all() -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Scan both passport and card. Returns (passport_data, card_data)."""
    return scan_passport(), scan_card()
