"""Camera OCR and Passport/Card scanning functionality.

Architecture: Two-Pass "Straighten-then-Search". Pass 1 uses EasyOCR only to get
median text tilt and rotate the crop to a level Base Image; no boxes from Pass 1
are used for recognition. Pass 2 runs a dedicated EasyOCR detection on the straightened
image for document-specific targets (MRZ lines in bottom 40% for passport; PAN + MM/YY
for card). Only Pass 2 coordinates, expanded by 10px vertical and 95% width, feed the
6-variant shotgun OCR and the debug/variants/ visuals.
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

# MRZ zone: fractional (x1, y1, x2, y2) on deskewed passport; bottom strip with two 44-char lines.
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

try:
    import pytesseract  # Wrapper for Tesseract OCR engine
    HAS_TESSERACT = True

    # On Windows, pytesseract needs the path to tesseract.exe if it's not in PATH
    if sys.platform == "win32":
        _tesseract_paths = [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
            os.path.expandvars(r"%USERPROFILE%\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]
        for _path in _tesseract_paths:
            if os.path.isfile(_path):
                pytesseract.pytesseract.tesseract_cmd = _path
                logger.info("Using Tesseract at: %s", _path)
                break
except ImportError:
    HAS_TESSERACT = False
    logger.warning("pytesseract not available - OCR will be limited")

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
    Set DISABLE_EASYOCR=1 to force-disable EasyOCR and use Tesseract-only fallback.
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


def _sharpen_for_ocr(image: "np.ndarray") -> "np.ndarray":
    """Light sharpen for OCR variant images. Clipped to avoid artifacts."""
    if not HAS_OPENCV or image is None or image.size == 0:
        return image
    try:
        blurred = cv2.medianBlur(image, 5)
        sharpened = cv2.addWeighted(image, 1.5, blurred, -0.5, 0)
        return np.clip(sharpened, 0, 255).astype(np.uint8)
    except Exception:
        return image


def _capture_frame_via_tkinter(cap: "cv2.VideoCapture", doc_type: str = "passport") -> List["np.ndarray"]:
    """Tkinter camera preview. Returns top-2 raw (unenhanced) frames on capture.
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
        captured_frames = _capture_best_frames(cap, num_frames=10, interval_ms=75, top_k=2)
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
        height, width = frame.shape[:2]
        if use_card_rect:
            rect_w = min(RECT_W, width - 20)
            rect_h = min(RECT_H, height - 20)
        else:
            rect_w = min(PASSPORT_RECT_W, width - 20)
            rect_h = min(PASSPORT_RECT_H, height - 20)
        x1 = (width - rect_w) // 2
        y1 = (height - rect_h) // 2
        x2 = x1 + rect_w
        y2 = y1 + rect_h
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
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
    """Open camera, show live preview (OpenCV window; fallback to tkinter), and capture top-2 sharpest frames.
    doc_type: 'passport' uses PASSPORT_RECT_*, 'card' uses RECT_* (card crop).

    Returns a list of up to 2 raw frames (best-first), or empty list on failure / cancel.
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

                height, width = frame.shape[:2]
                if use_card_rect:
                    rect_w = min(RECT_W, width - 20)
                    rect_h = min(RECT_H, height - 20)
                else:
                    rect_w = min(PASSPORT_RECT_W, width - 20)
                    rect_h = min(PASSPORT_RECT_H, height - 20)
                x1 = (width - rect_w) // 2
                y1 = (height - rect_h) // 2
                x2 = x1 + rect_w
                y2 = y1 + rect_h

                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.imshow(window_name, frame)
                key = cv2.waitKey(1) & 0xFF

                # Space or Enter to capture
                if key in (32, 13):
                    time.sleep(0.5)
                    top2 = _capture_best_frames(cap, num_frames=10, interval_ms=75, top_k=2)
                    cap.release()
                    cv2.destroyWindow(window_name)
                    return top2
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
            top2 = _capture_best_frames(cap, num_frames=10, interval_ms=75, top_k=2)
            cap.release()
            try:
                cv2.destroyAllWindows()
            except Exception:
                pass
            return top2

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
    """Crop frame to the center PASSPORT_RECT_W x PASSPORT_RECT_H region (passport data page)."""
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
        height, width = display.shape[:2]
        max_side = 800
        if width > 0 and height > 0:
            scale = max_side / max(width, height)
            new_w = int(width * scale)
            new_h = int(height * scale)
            if scale > 1.0:
                interp = cv2.INTER_LANCZOS4 if hasattr(cv2, "INTER_LANCZOS4") else cv2.INTER_CUBIC
            else:
                interp = cv2.INTER_AREA
            display = cv2.resize(display, (new_w, new_h), interpolation=interp)
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
# When False, no deskew_debug_zone, crop_debug_region, deskew_debug_passport,
# variants (v1–v6) images are written. Set in .env as DEBUG_ACTIVATE.
# ---------------------------------------------------------------------------
DEBUG_ACTIVATE = os.environ.get("DEBUG_ACTIVATE", "").strip().lower() in ("1", "true", "yes")
_DEBUG_VARIANTS_BASE = _PROJECT_ROOT / "debug" / "variants"
# Backward compat: flat dir used when doc_type is unknown; prefer _get_debug_variants_dir().
_DEBUG_VARIANTS_DIR = _DEBUG_VARIANTS_BASE

# When True, compute tilt from detection boxes and rotate the crop; when False, no angle or rotation (image used as-is). Set in .env as DESKEW_ENABLE.
DESKEW_ENABLE = os.environ.get("DESKEW_ENABLE", "").strip().lower() in ("1", "true", "yes")

TESSERACT_DEFAULT_CONFIDENCE = 0.5
DEBUG_SAVE_VARIANTS = True
# One save per doc type per scan session: first frame with a detected ROI for that type.
_debug_variants_saved_passport = False
_debug_variants_saved_card = False
# Legacy single flag for callers that don't pass doc_type (treat as passport).
_debug_variants_saved_this_session = False

# Master key for OCR timing logs: set OCR_TIMING=true in .env to log duration of heavy OCR steps; false = no timing logs.
_OCR_TIMING = os.environ.get("OCR_TIMING", "").strip().lower() in ("1", "true", "yes")

# Set OCR_USE_V3_BASE=1 to build v4/v5/v6 from v3 (clean sharp); default uses v2 (sharp) as base. See docs/OCR_VARIANTS.md.
_USE_V3_BASE_FOR_DERIVED = os.environ.get("OCR_USE_V3_BASE", "").strip().lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Why the pipeline is slow (main time consumers):
# 1. EasyOCR model load at import: Reader(["en"]) loads PyTorch + detection + recognition
#    models once; on CPU this can take 30–90+ seconds (first run may download).
# 2. Many EasyOCR readtext() calls: each is a neural net forward pass. Per passport frame:
#    deskew (1 full crop) + MRZ detect (1 bottom crop) + 2 MRZ lines × 6 variants = 14 EasyOCR
#    calls. Per card frame: deskew (1) + ROI detect (1) + 4 ROIs × 6 variants = 26 EasyOCR.
#    run_test_image uses 3 passport + 3 card frames → ~120 EasyOCR calls total.
# 3. Tesseract: 2 PSM runs per variant (PSM 6 and 7). ~24 Tesseract calls per passport frame,
#    ~48 per card frame; faster than EasyOCR but still significant.
# 4. All of the above run on CPU unless CUDA/MPS is available; GPU greatly reduces EasyOCR time.
# ---------------------------------------------------------------------------


def _get_debug_variants_dir(doc_type: str) -> Path:
    """Return debug/variants/passport or debug/variants/card so passport and card debug don't overwrite each other."""
    doc = (doc_type or "").strip().lower()
    if doc not in ("passport", "card"):
        doc = "passport"
    return _DEBUG_VARIANTS_BASE / doc


def _build_six_variants(base_roi: "np.ndarray") -> List["np.ndarray"]:
    """Build 6 image variants from a single ROI crop (always .copy() to avoid aliasing).

    v1_orig:       Raw baseline crop.
    v2_sharp:      v1 + sharpen.
    v3_clean_sharp: v1 -> medianBlur(k=5) -> sharpen.
    v4_gray:       Grayscale of v2 or v3 (per OCR_USE_V3_BASE; default v2). v5 and v6 are derived from v4.
    v5_clahe:      CLAHE (clipLimit=1.2) applied to v4.
    v6_thresh:     Otsu threshold of v5 (CLAHE before Otsu; v6 built from v5).
    """
    if base_roi is None or base_roi.size == 0:
        return []
    v1_orig = base_roi.copy()
    v2_sharp = _sharpen_for_ocr(v1_orig.copy())
    v3_clean_sharp = _sharpen_for_ocr(cv2.medianBlur(v1_orig.copy(), 5))
    base_for_gray = v3_clean_sharp if _USE_V3_BASE_FOR_DERIVED else v2_sharp
    try:
        v4_gray = cv2.cvtColor(base_for_gray, cv2.COLOR_BGR2GRAY) if base_for_gray.ndim == 3 else base_for_gray.copy()
    except Exception:
        v4_gray = base_for_gray.copy()
    try:
        clahe_obj = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(8, 8))
        v5_clahe = clahe_obj.apply(v4_gray.copy())
    except Exception:
        v5_clahe = v4_gray.copy()
    try:
        _, v6_thresh = cv2.threshold(v5_clahe.copy(), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    except Exception:
        v6_thresh = v5_clahe.copy()
    return [v1_orig, v2_sharp, v3_clean_sharp, v4_gray, v5_clahe, v6_thresh]


_VARIANT_LABELS = ["v1_orig", "v2_sharp", "v3_clean_sharp", "v4_gray", "v5_clahe", "v6_thresh"]


def _save_debug_variants(variants: List["np.ndarray"], frame_index: int, doc_type: str = "passport") -> None:
    """Save 6 full-frame variants with Pass 2 bounding boxes drawn to debug/variants/{doc_type}/.

    Boxes are from the second-pass (targeted) detection only. Colors: Line 1 (PAN/MRZ top) = light
    green BGR (144,238,144), Line 2 (Expiry/MRZ bottom) = dark green BGR (0,128,0). Saves at most
    once per doc type per scan session. Files: f{N}_v1_orig.png ... f{N}_v6_thresh.png.
    """
    global _debug_variants_saved_passport, _debug_variants_saved_card, _debug_variants_saved_this_session
    doc = (doc_type or "passport").strip().lower()
    if doc not in ("passport", "card"):
        doc = "passport"
    saved = _debug_variants_saved_passport if doc == "passport" else _debug_variants_saved_card
    if not DEBUG_ACTIVATE or not DEBUG_SAVE_VARIANTS or not HAS_OPENCV or saved:
        return
    if len(variants) != 6:
        return
    try:
        ddir = _get_debug_variants_dir(doc)
        ddir.mkdir(parents=True, exist_ok=True)
        for name, img in zip(_VARIANT_LABELS, variants):
            path = ddir / f"f{frame_index}_{name}.png"
            cv2.imwrite(str(path.resolve()), img)
        if doc == "passport":
            _debug_variants_saved_passport = True
            _debug_variants_saved_this_session = True
        else:
            _debug_variants_saved_card = True
        logger.debug("Saved 6 variant debug images (frame %d) to %s", frame_index, ddir)
    except Exception as e:
        logger.debug("Could not save debug variants: %s", e)


def _shotgun_ocr(image: "np.ndarray") -> List[Tuple[str, float]]:
    """Run Tesseract (PSM 6 + 7) and EasyOCR on a single image variant.

    Returns list of (raw_text, confidence). Tesseract gets fixed 0.5 confidence;
    EasyOCR uses the engine's real confidence score.
    """
    results: List[Tuple[str, float]] = []
    if image is None or image.size == 0:
        return results
    if HAS_TESSERACT:
        for psm in (6, 7):
            try:
                t = pytesseract.image_to_string(image, config=f"--oem 3 --psm {psm}")
                if t.strip():
                    results.append((t.strip(), TESSERACT_DEFAULT_CONFIDENCE))
            except Exception:
                pass
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


def _shotgun_ocr_mrz(image: "np.ndarray") -> List[Tuple[str, float]]:
    """OCR tuned for MRZ stitching.

    Same engines as _shotgun_ocr, but for EasyOCR also returns stitched line(s)
    by concatenating detections on the same visual line (sorted left→right).
    """
    results: List[Tuple[str, float]] = []
    if image is None or image.size == 0:
        return results

    # Tesseract: keep raw multi-line string (useful for later normalization/windowing)
    if HAS_TESSERACT:
        for psm in (6, 7):
            try:
                t = pytesseract.image_to_string(image, config=f"--oem 3 --psm {psm}")
                if t and t.strip():
                    results.append((t.strip(), TESSERACT_DEFAULT_CONFIDENCE))
            except Exception:
                pass

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
        blocks.append(
            {
                "x1": x1,
                "x2": x2,
                "y1": y1,
                "y2": y2,
                "mid_y": (y1 + y2) / 2.0,
                "h": max(1.0, y2 - y1),
                "text": str(txt).strip(),
                "conf": float(conf) if conf is not None else 0.0,
            }
        )
        # Keep the original detection too.
        results.append((str(txt).strip(), float(conf) if conf is not None else 0.0))

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
            results.append((stitched, avg_conf))
            mid_y = sum(b["mid_y"] for b in line) / max(len(line), 1)
            stitched_lines.append((mid_y, stitched, avg_conf))

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
                    results.append((merged, (p_conf + other_conf) / 2.0))
    except Exception:
        pass

    return results


def _shotgun_ocr_on_mrz_roi(roi: "np.ndarray", frame_index: int = 0) -> List[Tuple[str, float]]:
    """MRZ-only ROI OCR: 6 variants + MRZ-tuned EasyOCR stitching."""
    if roi is None or roi.size == 0:
        return []
    variants = _build_six_variants(roi)
    if not variants:
        return []
    pool: List[Tuple[str, float]] = []
    t0 = time.perf_counter() if _OCR_TIMING else None
    for v in variants:
        pool.extend(_shotgun_ocr_mrz(v))
    if _OCR_TIMING and t0 is not None:
        logger.info("[OCR_TIMING] shotgun_ocr_on_mrz_roi (6 variants): %.2fs", time.perf_counter() - t0)
    return pool


def _shotgun_ocr_on_roi(roi: "np.ndarray", frame_index: int = 0, save_debug: bool = False) -> List[Tuple[str, float]]:
    """Build 6 variants from the ROI and run OCR on every variant (Tesseract PSM 6/7 + EasyOCR per variant).

    All 6 variants are OCR'd; combined pool = 6 variants × 3 engines = up to 18 results per ROI.
    When save_debug is True, saves f{N}_v1_orig.png ... f{N}_v6_thresh.png once per doc type (first frame with a detected ROI).
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
        logger.info("[OCR_TIMING] shotgun_ocr_on_roi (6 variants): %.2fs", time.perf_counter() - t0)
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

    if HAS_TESSERACT:
        for psm in (6, 7):
            try:
                t = pytesseract.image_to_string(image, config=f"--oem 3 --psm {psm}")
                if t.strip():
                    results.append((t.strip(), TESSERACT_DEFAULT_CONFIDENCE))
            except Exception:
                pass

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
    """PAN-only ROI OCR: 6 variants + digit-stitching EasyOCR."""
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
        logger.info("[OCR_TIMING] shotgun_ocr_on_pan_roi (6 variants): %.2fs", time.perf_counter() - t0)
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

        # Best Line 2 candidate from this entry (if any).
        best = _best_td3_line2_candidate(loose)
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
    line1_pool: List[Tuple[str, float]],
    line2_pool: List[Tuple[str, float]],
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], Dict[str, int]]:
    """TD3 MRZ gating using ROI-specific pools.

    This is more robust than a single combined pool because it lets us assemble TD3 line 1 and
    TD3 line 2 from OCR fragments that may appear as separate entries (e.g. "P<NGA..." and
    "USMAN<<<<<") within the *same* ROI.
    """
    checksum_pass_count: Dict[str, int] = {}
    line1_candidates: List[Tuple[str, float]] = []
    valid_line2s: List[Tuple[str, float]] = []

    def _add_line1_from_loose(loose: str, conf: float) -> None:
        for l1 in _extract_td3_line1_candidates(loose):
            line1_candidates.append((l1, conf))

    def _add_line2_from_loose(loose: str, conf: float) -> None:
        best = _best_td3_line2_candidate(loose)
        if best is None:
            return
        l2, passed = best
        passport_id = l2[0:9].replace("<", "").strip()
        if passport_id:
            checksum_pass_count[passport_id] = checksum_pass_count.get(passport_id, 0) + 1
        boost = 0.85 + 0.15 * max(0, min(passed, 4)) / 4.0
        valid_line2s.append((l2, float(conf) * boost))

    # Per-entry extraction (baseline).
    for raw_text, conf in line1_pool:
        loose = _normalize_mrz_text_loose(raw_text or "")
        if loose:
            _add_line1_from_loose(loose, float(conf))
    for raw_text, conf in line2_pool:
        loose = _normalize_mrz_text_loose(raw_text or "")
        if loose:
            _add_line2_from_loose(loose, float(conf))

    # Cross-entry assembly within each ROI (top-N by confidence).
    # This helps when OCR splits line 1 across entries (e.g. P<... and USMAN...).
    try:
        top_l1 = sorted(
            ((_normalize_mrz_text_loose(t), float(c)) for t, c in line1_pool if t),
            key=lambda x: x[1],
            reverse=True,
        )[:8]
        top_l2 = sorted(
            ((_normalize_mrz_text_loose(t), float(c)) for t, c in line2_pool if t),
            key=lambda x: x[1],
            reverse=True,
        )[:8]

        # Combined loose strings (acts like a "bag" of fragments).
        if top_l1:
            combined_l1 = "<".join(s for s, _ in top_l1 if s)
            _add_line1_from_loose(combined_l1, sum(c for _, c in top_l1) / max(len(top_l1), 1))
        if top_l2:
            combined_l2 = "<".join(s for s, _ in top_l2 if s)
            _add_line2_from_loose(combined_l2, sum(c for _, c in top_l2) / max(len(top_l2), 1))

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
                if injected and _has_td3_line1_prefix(injected):
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
        print(f"\n--- {label} consensus ---")
        print(f"  (no candidates passed gating — {raw_pool_size} raw pool entries)")
        return
    scores: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    for value, conf in bucket:
        scores[value] = scores.get(value, 0.0) + conf
        counts[value] = counts.get(value, 0) + 1
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    print(f"\n--- {label} consensus ---")
    for i, (val, score) in enumerate(ranked[:8], 1):
        mark = " [SELECTED]" if val == winner else ""
        vote_str = f"score={score:.2f}, {counts[val]} vote(s)"
        if value_actual_counts is not None and val in value_actual_counts:
            vote_str += f", {value_actual_counts[val]} check-digit pass(es)"
        print(f"  {i}. {val} ({vote_str}){mark}")
    if winner:
        win_vote = f"score={scores.get(winner, 0):.2f}, {counts.get(winner, 0)} vote(s)"
        if value_actual_counts is not None and winner in value_actual_counts:
            win_vote += f", {value_actual_counts[winner]} check-digit pass(es)"
        print(f"  -> Selected {label}: {winner} ({win_vote})")


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
        print("\n[MRZ_DEBUG] No winning MRZ lines from consensus.")
        return

    print("\n=== MRZ winner (consensus) ===")
    print(f"L1: {winning_l1 or '[none]'}")
    print(f"L2: {winning_l2 or '[none]'}")

    if not (winning_l1 and winning_l2 and len(winning_l1) >= 44 and len(winning_l2) >= 44):
        print("[MRZ_DEBUG] Cannot parse structured MRZ fields (need two 44-char lines).")
        print(f"  -> passport_id used : {passport_id or '-'}")
        print(f"  -> guest_name used  : {guest_name or '-'}")
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

    print("\n=== MRZ fields decoded from winner ===")
    print(f"  Document type     : {doc_type}")
    print(f"  Issuing state     : {issuing_state}")
    print(f"  Surname           : {surname or '-'}")
    print(f"  Given names       : {given or '-'}")
    print(f"  Guest name (MRZ)  : {parsed_guest_name or '-'}")
    print(f"  Passport number   : {doc_number or '-'}  (check digit {doc_number_cd_status})")
    print("\n  -> passport_id used : {}".format(passport_id or "-"))
    print("  -> guest_name used  : {}".format(guest_name or "-"))


# Multiple vertical bands where the MRZ may appear (fraction of height from top).
# Used as fallback when CLAHE+EasyOCR line detection fails.
PASSPORT_MRZ_BAND_STARTS = [0.60, 0.65, 0.70, 0.72, 0.74]
PASSPORT_MRZ_BAND_HEIGHT = 0.24

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
        cands.append(cand)
    # De-dup while preserving order
    out: List[str] = []
    seen: Set[str] = set()
    for c in cands:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _best_td3_line2_candidate(loose: str) -> Optional[Tuple[str, int]]:
    """Pick the best 44-char TD3 line 2 candidate from a loose string.

    Returns (line2, checks_passed) or None.
    """
    if not loose or len(loose) < 20:
        return None

    # Build windows of length 44 from the loose string and pick the one with the best
    # checksum score after corrections. We additionally allow "relaxed" doc-number
    # checksum acceptance when the check digit character was misread as a letter.
    best: Optional[str] = None
    best_passed = -1
    best_doc_ok = False

    if len(loose) < 44:
        return None

    max_starts = min(len(loose) - 44, 120)  # cap work per entry
    for i in range(max_starts + 1):
        w = loose[i : i + 44]
        if len(w) != 44:
            continue
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

        if (passed > best_passed) or (passed == best_passed and doc_ok and not best_doc_ok):
            best_passed = passed
            best_doc_ok = doc_ok
            best = w2
            if best_passed == 4 and best_doc_ok:
                break

    if best is None:
        return None
    # Require at least relaxed doc-number validity to avoid stitching the wrong line.
    if not best_doc_ok:
        return None
    return best, best_passed


_MRZ_OCR_CORRECTIONS = {
    "O": "0", "D": "0", "Q": "0",
    "I": "1", "L": "1", "l": "1",
    "Z": "2", "S": "5", "B": "8", "G": "6",
}


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
# Pass 2: Targeted MRZ Hunt (decoupled from Pass 1 deskew; runs on deskewed image only)
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
    deskewed: "np.ndarray",
    frame_index: Optional[int] = None,
) -> List[Tuple[int, int, int, int]]:
    """Pass 2: Targeted MRZ hunt on the deskewed image only.

    Does NOT use any text blocks from the deskew step. Runs a dedicated EasyOCR
    pass on the bottom 25% of the image to find two horizontal blocks that match
    the 44-character MRZ pattern. Returns raw boxes in full deskewed coordinates;
    caller applies vertical buffer and full-width expansion before cropping.

    Uses chevron (`<`) density and TD3 Line 1 anchor (P< or P[A-Z]) to distinguish real MRZ
    lines from other passport text (dates, labels) that passes basic length/charset filters.
    """
    reader = _get_easyocr_reader()
    if reader is None or deskewed is None or deskewed.size == 0:
        return []
    h, w = deskewed.shape[:2]
    bottom_frac = 0.25
    y_crop_start = int(h * (1.0 - bottom_frac))
    y_crop_start = max(0, min(y_crop_start, h - 10))
    crop = deskewed[y_crop_start:h, 0:w]
    if crop.size == 0:
        return []

    if DEBUG_ACTIVATE and HAS_OPENCV and frame_index is not None:
        try:
            ddir = _get_debug_variants_dir("passport")
            ddir.mkdir(parents=True, exist_ok=True)
            crop_debug_path = ddir / f"crop_debug_region_frame_{frame_index}.png"
            cv2.imwrite(str(crop_debug_path.resolve()), crop)
        except Exception:
            pass

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
    logger.debug("[MRZ_DETECT] EasyOCR returned %d results on bottom %.0f%% crop (%dx%d)", len(results), bottom_frac*100, crop_w, crop_h)
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

    # Score each line group: prefer high chevron density + bottom position.
    for group in lines:
        max_chevron = max(c["chevron_density"] for c in group)
        avg_y = sum(c["mid_y"] for c in group) / len(group)
        bottom_bonus = avg_y / max(crop_h, 1)
        group[0]["_line_score"] = max_chevron + bottom_bonus

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


def _collect_passport_raw_pool(
    frame: "np.ndarray",
    frame_index: Optional[int] = None,
    fallback_boxes: Optional[List[Tuple[int, int, int, int]]] = None,
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], Optional["np.ndarray"], List[Tuple[int, int, int, int]]]:
    """Stage 1+2 for one passport frame: text-based deskew, then detect MRZ lines
    on the straightened image, run 6-variant shotgun OCR per MRZ line ROI.

    Fallback chain when MRZ line detection fails:
      1. Use fallback_boxes (coordinates from a previous successful frame).
      2. Multi-band search (generic yellow bands).

    Applies 1.2x confidence boost when the frame was actually rotated.
    Returns (line1_pool, line2_pool, deskewed_image, detected_boxes).
    """
    empty_boxes: List[Tuple[int, int, int, int]] = []
    if frame is None or frame.size == 0 or not (HAS_TESSERACT or HAS_EASYOCR):
        return [], [], None, empty_boxes
    crop = _crop_passport_alignment_region(frame)
    if crop is None or crop.size == 0:
        return [], [], None, empty_boxes

    # Pass 1 (Global Angle): deskew only; no MRZ logic, OCR results from this step are not used for MRZ.
    deskewed, _ocr_results, rotation_angle = _text_based_deskew(
        crop, frame_index=frame_index, label="passport"
    )
    was_rotated = abs(rotation_angle) > 0.05
    if deskewed is None or deskewed.size == 0:
        return [], [], None, empty_boxes

    # Pass 2 (Targeted MRZ Hunt): dedicated search on deskewed image for two 44-char lines in bottom 40%.
    desk_h, desk_w = deskewed.shape[:2]
    line_boxes = _detect_mrz_lines_with_easyocr(deskewed, frame_index=frame_index)
    line1_pool: List[Tuple[str, float]] = []
    line2_pool: List[Tuple[str, float]] = []
    used_boxes: List[Tuple[int, int, int, int]] = []
    detection_source = "none"

    if line_boxes:
        used_boxes = []
        for box_idx, (dx1, dy1, dx2, dy2) in enumerate(line_boxes):
            extra_bottom = _LINE2_EXTRA_BOTTOM_PX if box_idx == 1 else 0
            used_boxes.append(_expand_mrz_box_full_width(dx1, dy1, dx2, dy2, desk_w, desk_h, extra_bottom_px=extra_bottom))
        detection_source = "easyocr"
    elif fallback_boxes:
        for fbx1, fby1, fbx2, fby2 in fallback_boxes:
            bx1 = max(0, min(fbx1, desk_w - 1))
            by1 = max(0, min(fby1, desk_h - 1))
            bx2 = max(bx1 + 1, min(fbx2, desk_w))
            by2 = max(by1 + 1, min(fby2, desk_h))
            used_boxes.append((bx1, by1, bx2, by2))
        detection_source = "coord_memory"

    if used_boxes:
        for idx, (dx1, dy1, dx2, dy2) in enumerate(used_boxes):
            if dx2 <= dx1 or dy2 <= dy1:
                continue
            line_roi = deskewed[dy1:dy2, dx1:dx2].copy()
            if line_roi.size > 0:
                # MRZ ROIs benefit from stitching EasyOCR split boxes into full-line candidates.
                roi_pool = _shotgun_ocr_on_mrz_roi(line_roi, frame_index=frame_index or 0)
                if idx == 0:
                    line1_pool.extend(roi_pool)
                elif idx == 1:
                    line2_pool.extend(roi_pool)
                else:
                    # Safety: if more than 2 boxes, treat as mixed.
                    line1_pool.extend(roi_pool)
                    line2_pool.extend(roi_pool)
        logger.debug(
            "Frame %s: %s detected %d MRZ line(s), l1_pool=%d l2_pool=%d",
            frame_index, detection_source, len(used_boxes), len(line1_pool), len(line2_pool),
        )
        # Save 6 full-frame variants with Pass 2 expanded boxes only (no fallbacks). Line 1 = light green, Line 2 = dark green.
        if (
            line_boxes
            and DEBUG_ACTIVATE
            and DEBUG_SAVE_VARIANTS
            and HAS_OPENCV
            and frame_index is not None
            and not _debug_variants_saved_passport
        ):
            try:
                variants = _build_six_variants(deskewed)
                if len(variants) == 6:
                    for i in range(len(variants)):
                        v = variants[i]
                        if v.ndim == 2:
                            v = cv2.cvtColor(v, cv2.COLOR_GRAY2BGR)
                            variants[i] = v
                        for box_idx, (dx1, dy1, dx2, dy2) in enumerate(used_boxes):
                            color = _DEBUG_BGR_LINE1 if box_idx == 0 else _DEBUG_BGR_LINE2
                            cv2.rectangle(variants[i], (dx1, dy1), (dx2, dy2), color, 2)
                    _save_debug_variants(variants, frame_index, doc_type="passport")
            except Exception:
                pass
    else:
        logger.debug("Frame %s: MRZ line detection failed, using band fallback", frame_index)
        for idx, start_frac in enumerate(PASSPORT_MRZ_BAND_STARTS):
            y1 = max(0, int(desk_h * start_frac))
            y2 = min(desk_h, int(desk_h * (start_frac + PASSPORT_MRZ_BAND_HEIGHT)))
            if y2 <= y1:
                continue
            band_roi = deskewed[y1:y2, 0:desk_w].copy()
            if band_roi.size == 0:
                continue
            # Band ROI may include both MRZ lines; add to both pools and let TD3 gating decide.
            band_pool = _shotgun_ocr_on_mrz_roi(band_roi, frame_index=frame_index or 0)
            line1_pool.extend(band_pool)
            line2_pool.extend(band_pool)

    if was_rotated:
        line1_pool = _apply_deskew_boost(line1_pool)
        line2_pool = _apply_deskew_boost(line2_pool)

    return line1_pool, line2_pool, deskewed, line_boxes


def scan_passport_from_frame(frame: "np.ndarray", frame_index: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Process one passport frame through the unified mass consensus pipeline (Stages 1-4).

    When called with a single frame (e.g. from the API), the pipeline builds filter
    variants, runs shotgun OCR, gates MRZ pairs, and confidence-votes on that frame.
    """
    if frame is None or frame.size == 0 or not (HAS_TESSERACT or HAS_EASYOCR):
        return None
    l1_pool, l2_pool, deskewed, _boxes = _collect_passport_raw_pool(frame, frame_index=frame_index)
    if not l1_pool and not l2_pool:
        return None

    line1_cands, valid_l2s, _ = _gate_mrz_from_pools(l1_pool, l2_pool)

    winning_l1, _l1_score, _l1_cnt = _confidence_weighted_vote(line1_cands)
    winning_l2, _l2_score, _l2_cnt = _confidence_weighted_vote(valid_l2s)

    passport_id, guest_name = _decode_mrz_winners(winning_l1, winning_l2)
    if not passport_id and not guest_name:
        return None
    return {
        "passport_id": passport_id,
        "guest_name": guest_name,
        "raw_text": "",
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
    """Capture one frame of the passport (align + verify), deskew it, and return base64. No MRZ decode. Use when guest entered passport number manually so we still save the image."""
    if not HAS_OPENCV:
        return None
    frames = _capture_frames_from_camera()
    if not frames:
        return None
    frame = frames[0]
    crop = _crop_passport_alignment_region(frame)
    deskewed, _ocr, _angle = _text_based_deskew(crop, label="passport")
    if deskewed is None or deskewed.size == 0:
        return None
    return _passport_image_to_base64(deskewed)


def scan_passport() -> Optional[Dict[str, Any]]:
    """Scan passport via camera: capture top-2 raw → verify → then process
    through the mass consensus pipeline (deskew, detection master, shotgun OCR,
    gate, confidence-weighted vote).
    """
    if not HAS_OPENCV or not (HAS_TESSERACT or HAS_EASYOCR):
        logger.info("MOCK HARDWARE/OCR: Simulating passport scan")
        return {"passport_id": "MOCK123456", "guest_name": "John Doe", "raw_text": "", "passport_image_base64": None}

    _clear_roi_debug_images("passport")
    logger.info("Scanning passport with camera (top-2 raw capture, MRZ mass consensus)...")

    while True:
        frames = _capture_frames_from_camera()
        if not frames:
            return None
        if _show_capture_for_verification(frames[0]):
            break
        print("Retaking passport image...")

    if DEBUG_ACTIVATE:
        print("Processing images (deskew + detection master + MRZ decode, mass consensus)...")

    global _debug_variants_saved_this_session, _debug_variants_saved_passport
    _debug_variants_saved_this_session = False
    _debug_variants_saved_passport = False

    all_l1: List[Tuple[str, float]] = []
    all_l2: List[Tuple[str, float]] = []
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

    winning_l1, _l1_score, _l1_cnt = _confidence_weighted_vote(line1_cands)
    winning_l2, _l2_score, _l2_cnt = _confidence_weighted_vote(valid_l2s)

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
            crop = _crop_passport_alignment_region(frames[0])
            deskewed, _, _ = _text_based_deskew(crop, label="passport")

    passport_image_base64 = _passport_image_to_base64(deskewed) if deskewed is not None else None

    return {
        "passport_id": passport_id,
        "guest_name": guest_name,
        "raw_text": "",
        "passport_image_base64": passport_image_base64,
    }


def scan_passport_from_frames(frames: List["np.ndarray"]) -> Optional[Dict[str, Any]]:
    """Same pipeline as scan_passport() but using a list of frames (e.g. from a file).
    Uses 3 frames → deskew + Pass 2 + 6 variants, mass consensus. No camera or verification UI."""
    if not frames or not (HAS_TESSERACT or HAS_EASYOCR):
        return None
    for f in frames:
        if f is None or f.size == 0:
            return None

    _clear_roi_debug_images("passport")
    logger.info("Processing passport from %d frame(s) (deskew + detection + MRZ mass consensus)...", len(frames))
    global _debug_variants_saved_this_session, _debug_variants_saved_passport
    _debug_variants_saved_this_session = False
    _debug_variants_saved_passport = False

    all_l1: List[Tuple[str, float]] = []
    all_l2: List[Tuple[str, float]] = []
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

    winning_l1, _l1_score, _l1_cnt = _confidence_weighted_vote(line1_cands)
    winning_l2, _l2_score, _l2_cnt = _confidence_weighted_vote(valid_l2s)

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
            crop = _crop_passport_alignment_region(frames[0])
            deskewed, _, _ = _text_based_deskew(crop, label="passport")

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
        clahe_obj = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return clahe_obj.apply(gray)
    except Exception:
        return card


# ---------------------------------------------------------------------------
# Text-Centric Deskew  (replaces edge / contour quad detection)
# ---------------------------------------------------------------------------
_DESKEW_MAX_ANGLE = 15.0
_DESKEW_CONFIDENCE_BOOST = 1.2


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


def _text_based_deskew(
    raw_crop: "np.ndarray",
    frame_index: Optional[int] = None,
    label: str = "doc",
) -> Tuple["np.ndarray", List[list], float]:
    """CLAHE + detection always; tilt/rotation only when DESKEW_ENABLE is True.

    Pipeline:
      A. _build_clahe_and_detect_boxes: CLAHE + EasyOCR → bounding boxes (always).
      B. If DESKEW_ENABLE: compute angle from boxes (weighted median + Hough), rotate
         raw_crop; else return raw_crop unchanged (rotation_angle 0.0).

    Returns (base_image, easyocr_results, rotation_angle_degrees).
    """
    if not HAS_OPENCV or raw_crop is None or raw_crop.size == 0:
        return raw_crop, [], 0.0

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

    h_img, w_img = raw_crop.shape[:2]

    # Collect candidate angles with weights. We deliberately ignore short or
    # highly vertical blocks (e.g. signatures, dates) and focus on long,
    # horizontal text lines such as MRZ or long titles. Blocks in the bottom
    # 40% of the image (MRZ band) get higher weight so local straight MRZ
    # lines dominate over skewed signatures elsewhere.
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
        mid_y = (y1 + y2) / 2.0
        a = _box_angle(bbox)
        if a is None:
            continue
        weight = 2.0 if mid_y >= h_img * 0.6 else 1.0
        weighted_angles.append((a, weight))

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

    # EasyOCR returns axis-aligned bboxes, so box angles are always 0. Use Hough line fallback.
    # Focus on the bottom 30% (MRZ band) for passports; for cards Hough is disabled entirely
    # because decorative lines and photo edges elsewhere produce misleading angles.
    if label != "card" and abs(rotation_angle) < 0.15:
        hough_angle = _dominant_line_angle_hough(clahe_master, bottom_frac=0.30)
        if hough_angle is not None and abs(hough_angle) <= _DESKEW_MAX_ANGLE:
            rotation_angle = hough_angle
            logger.debug("%s frame %s: using Hough line angle %.2f° (EasyOCR boxes axis-aligned)", label, frame_index, rotation_angle)

    # Applied correction is the opposite of the measured tilt.
    applied_angle = -rotation_angle

    if abs(rotation_angle) > 0.05:
        h, w = raw_crop.shape[:2]
        center = (w / 2.0, h / 2.0)
        M = cv2.getRotationMatrix2D(center, applied_angle, 1.0)
        cos_a = abs(M[0, 0])
        sin_a = abs(M[0, 1])
        new_w = int(h * sin_a + w * cos_a)
        new_h = int(h * cos_a + w * sin_a)
        M[0, 2] += (new_w - w) / 2.0
        M[1, 2] += (new_h - h) / 2.0
        base_image = cv2.warpAffine(
            raw_crop, M, (new_w, new_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        logger.debug(
            "%s frame %s: text-deskew rotated %.2f° (estimated tilt=%.2f°, %d text blocks)",
            label,
            frame_index,
            applied_angle,
            rotation_angle,
            len(weighted_angles),
        )
    else:
        base_image = raw_crop.copy()
        logger.debug(
            "%s frame %s: text-deskew skipped (angle=%.2f°, %d weighted blocks)",
            label,
            frame_index,
            rotation_angle,
            len(weighted_angles),
        )

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

            # Extra: dedicated "tilt applied" debug image (not used for variants).
            # Shows whether tilt was applied, magnitude, and direction (clockwise / anticlockwise).
            tilt_vis = base_image.copy()
            est_angle = rotation_angle
            rot_angle = applied_angle
            abs_est = abs(est_angle)
            if abs_est > 0.05:
                tilt_status = "applied"
            else:
                tilt_status = "skipped"

            est_text = f"estimated tilt: {est_angle:+.2f} deg"
            if abs(rot_angle) > 0.05:
                rot_dir = "anticlockwise" if rot_angle > 0 else "clockwise"
                rot_text = f"applied rotation: {rot_angle:+.2f} deg ({rot_dir})"
            else:
                rot_text = "applied rotation: 0.00 deg (none)"

            h_t, w_t = tilt_vis.shape[:2]
            org1 = (10, 30)
            org2 = (10, 60)
            cv2.putText(
                tilt_vis,
                est_text,
                org1,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )
            cv2.putText(
                tilt_vis,
                rot_text,
                org2,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
            )

            # Optional arrow indicating direction when tilt was applied.
            if tilt_status == "applied" and abs(rot_angle) > 0.05:
                x_mid = w_t // 2
                y_mid = h_t // 2
                length = max(40, w_t // 6)
                if rot_angle < 0:
                    # Negative applied angle = clockwise rotation.
                    p1 = (x_mid - length, y_mid - length // 2)
                    p2 = (x_mid + length, y_mid + length // 2)
                else:  # positive applied angle = anticlockwise rotation.
                    p1 = (x_mid - length, y_mid + length // 2)
                    p2 = (x_mid + length, y_mid - length // 2)
                cv2.arrowedLine(tilt_vis, p1, p2, (0, 255, 0), 3, tipLength=0.2)

            tilt_path = ddir / f"deskew_tilt_{label}_frame_{frame_index}.png"
            cv2.imwrite(str(tilt_path.resolve()), tilt_vis)

            # Duplicate with zone lines: bottom 45%, 35%, 25%, 15% (top edge of each zone).
            zones_vis = vis.copy()
            if zones_vis.ndim == 2:
                zones_vis = cv2.cvtColor(zones_vis, cv2.COLOR_GRAY2BGR)
            zh, zw = zones_vis.shape[:2]
            zone_specs = [
                (int(zh * 0.55), "45%", (255, 0, 0)),    # BGR: blue
                (int(zh * 0.65), "35%", (0, 255, 0)),    # green
                (int(zh * 0.75), "25%", (0, 0, 255)),    # red
                (int(zh * 0.85), "15%", (255, 255, 0)),  # cyan
            ]
            for y, zone_label, color in zone_specs:
                if 0 <= y < zh:
                    cv2.line(zones_vis, (0, y), (zw, y), color, 2)
                    cv2.putText(zones_vis, f"bottom {zone_label}", (10, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            zones_path = ddir / f"deskew_debug_zone_{label}.png"
            cv2.imwrite(str(zones_path.resolve()), zones_vis)
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
    and MM/YY expiry only. Use Pass 2 boxes for cropping and 6-variant shotgun; fall back to
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
    raw_crop = _crop_to_alignment_region(frame)

    # Pass 1 (The Straighten): median tilt angle only; do not use any boxes from this step.
    deskew_frame_index = frame_index if save_debug_images else None
    card, _ocr_results, angle = _text_based_deskew(raw_crop, frame_index=deskew_frame_index, label="card")
    result["was_rotated"] = abs(angle) > 0.05

    h_pre, w_pre = card.shape[:2]
    card = cv2.resize(card, (w_pre * 2, h_pre * 2), interpolation=cv2.INTER_CUBIC)
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


def _collect_card_raw_pools(
    frame: "np.ndarray", frame_index: Optional[int] = None, save_debug_images: bool = True
) -> Tuple[List[Tuple[str, float]], List[Tuple[str, float]], List[Tuple[str, float]]]:
    """Stage 1+2 for one card frame: text-based deskew, per-frame ROI detection,
    then 6-variant shotgun OCR.  If the frame was rotated (deskewed), every
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

                if len(variants) == 6:
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
    if not HAS_OPENCV or not (HAS_TESSERACT or HAS_EASYOCR):
        logger.info("MOCK HARDWARE/OCR: Simulating card scan")
        return {
            "card_no": "1234567890123456",
            "expiry": "12/25",
            "cvv": "123",
            "cardholder_name": "JOHN DOE",
        }

    _clear_roi_debug_images("card")
    logger.info("Scanning card with camera (top-2 raw capture, 6-variant x 3-engine shotgun)...")

    global _debug_variants_saved_card
    _debug_variants_saved_card = False

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
    Uses 3 frames → deskew + Pass 2 + 6 variants, mass consensus. No camera or verification UI.
    skip_clear_roi: if True, do not clear ROI/debug images (e.g. when running after passport in test script)."""
    if not frames or not (HAS_TESSERACT or HAS_EASYOCR):
        return None
    for f in frames:
        if f is None or f.size == 0:
            return None

    _clear_roi_debug_images("card")
    logger.info("Processing card from %d frame(s) (deskew + detection + shotgun consensus)...", len(frames))
    global _debug_variants_saved_card
    _debug_variants_saved_card = False

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
