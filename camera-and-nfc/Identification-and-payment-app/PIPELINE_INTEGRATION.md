# Linking an Upstream Pipeline to the Payment & Identity Detection System

This document describes how to connect another pipeline (e.g., a camera capture, video stream, or image-processing pipeline) **before** this detection system, and what to call to run passport and card detection. For installation and edge deployment (including EasyOCR models), see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Quick Reference: What to Call

| Use Case | Entry Point | How to Invoke |
|----------|-------------|---------------|
| **Full check-in flow** (passport → stay details → card → submit) | `main.py` | `python main.py` or import `main()` |
| **Detection only** (you provide frames) | `core.scanner` | `scan_passport_from_frames()`, `scan_card_from_frames()` |
| **Detection only** (use built-in camera) | `core.scanner` | `scan_passport()`, `scan_card()` |
| **Test with a static image** | `run_test_image.py` | `python run_test_image.py [path/to/image.jpg]` |

---

## 1. Running the Full System as a Subprocess

If your upstream pipeline wants to **launch** this detection system as a separate process:

```bash
# From the project root
python "Payment and Identity System/main.py"
```

Or from the `Payment and Identity System` directory:

```bash
cd "Payment and Identity System"
python main.py
```

**What `main.py` does:**
- Runs the full check-in flow: passport scan → fetch stay details → credit card capture → review & submit
- Uses the built-in camera for passport and card capture
- Interactive (prompts user for confirmation, manual entry fallbacks, etc.)

**Exit codes:** `0` = success, `1` = error, `0` on `Ctrl+C`

---

## 2. Importing and Calling Programmatically

If your upstream pipeline runs in the **same Python process** and wants to hand off to this system:

### Option A: Run the full check-in flow

```python
import sys
from pathlib import Path

# Add the Payment and Identity System directory to the path
PAS_ROOT = Path(__file__).resolve().parent / "Payment and Identity System"
sys.path.insert(0, str(PAS_ROOT))

from main import main

# Run the full flow (interactive, uses camera)
main()
```

### Option B: Run only the detection logic (you provide frames)

```python
import sys
from pathlib import Path

PAS_ROOT = Path(__file__).resolve().parent / "Payment and Identity System"
sys.path.insert(0, str(PAS_ROOT))

from core.scanner import (
    scan_passport_from_frames,
    scan_card_from_frames,
    _clear_roi_debug_images,
)
from core.data_model import CheckInData

# Your upstream pipeline provides frames (list of numpy arrays, BGR)
frames = [...]  # your frames from camera, video, or image sequence

# Optional: clear previous debug images
_clear_roi_debug_images()

# Passport detection
passport_data = scan_passport_from_frames(frames)
if passport_data:
    passport_id = passport_data.get("passport_id")
    guest_name = passport_data.get("guest_name")
    passport_image_base64 = passport_data.get("passport_image_base64")

# Card detection (use skip_clear_roi=True if running after passport in same session)
card_data = scan_card_from_frames(frames, skip_clear_roi=True)
if card_data:
    card_no = card_data.get("card_no")
    expiry = card_data.get("expiry")
    cardholder_name = card_data.get("cardholder_name")
```

---

## 3. Frame Requirements for Your Upstream Pipeline

If you **provide frames** to `scan_passport_from_frames()` or `scan_card_from_frames()`:

| Requirement | Details |
|-------------|---------|
| **Format** | BGR image (OpenCV `cv2.imread` / `cv2.VideoCapture` format) |
| **Type** | `numpy.ndarray` (uint8) |
| **Size** | Recommended: passport ~1060×660 px or larger; card ~580×420 px or larger. The scanner crops to 1040×640 (passport) and 560×400 (card) internally. |
| **Count** | 2 frames recommended (same as camera capture; improves consensus) |
| **Quality** | Clear, well-lit; document aligned in frame |

**Example** (from `run_test_image.py`):

```python
import cv2
import numpy as np

# Load or resize your image
img = cv2.imread("path/to/image.jpg")
img = cv2.resize(img, (1060, 660), interpolation=cv2.INTER_AREA)

# Duplicate to 2 frames (same as camera top-2)
frames = [img.copy() for _ in range(2)]

passport_data = scan_passport_from_frames(frames)
card_data = scan_card_from_frames(frames, skip_clear_roi=True)
```

---

## 4. Scanner API Reference

| Function | Purpose | Input | Output |
|----------|---------|-------|--------|
| `scan_passport_from_frames(frames)` | Passport MRZ detection from frames | `List[np.ndarray]` | `dict` with `passport_id`, `guest_name`, `passport_image_base64` |
| `scan_card_from_frames(frames, skip_clear_roi=False)` | Card OCR from frames | `List[np.ndarray]` | `dict` with `card_no`, `expiry`, `cardholder_name`, `cvv` |
| `scan_passport_from_frame(frame)` | Single-frame passport scan | `np.ndarray` | Same as above |
| `scan_card_from_frame(frame)` | Single-frame card scan | `np.ndarray` | Same as above |
| `scan_passport()` | Camera capture + passport scan | — | Same as above |
| `scan_card()` | Camera capture + card scan | — | Same as above |
| `detect_hardware()` | Check if camera/OCR available | — | `bool` |
| `capture_passport_image_only()` | Capture image only (no MRZ decode) | — | `str` (base64) |
| `_clear_roi_debug_images()` | Clear debug output from previous run | — | — |

---

## 5. Data Flow: `CheckInData` Container

When integrating with the full flow, data is held in `CheckInData`:

```python
from core.data_model import CheckInData

data = CheckInData()
data.guest_name = "John Doe"
data.passport_id = "AB1234567"
data.passport_image_base64 = "..."  # base64 PNG string (uploaded to Supabase Storage on submit)
data.nfc_uid = "A1B2C3D4"           # NFC card UID (optional, set when NFC tap is used)
data.card_details = {
    "card_no": "4111111111111111",
    "expiry": "12/25",
    "cvv": "123",
    "cardholder_name": "John Doe",
}
```

You can pass a pre-populated `CheckInData` into the flow if your upstream pipeline has already captured some data.

---

## 6. Environment and Dependencies

Before running, ensure:

1. **`.env`** in `Payment and Identity System/` contains:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) for server communication
   - `CAMERA_INDEX` (optional, default `0`) for camera selection
   - `NFC_SERIAL_PORT` (optional) for NFC card tap (used by both the standalone `guest_card_tap.py` script and the NFC option inside the full `main.py` flow)

2. **Dependencies** installed (`pip install -r requirements.txt`):
   - `opencv-python`, `numpy`, `Pillow`
   - `pytesseract`, `easyocr`
   - `requests`, `python-dotenv`, `supabase`, `pyserial`

3. **Tesseract** installed and on PATH (see the Tesseract Setup section in [DEPLOYMENT.md](DEPLOYMENT.md))

---

## 7. Summary: Upstream Pipeline → This System

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR UPSTREAM PIPELINE                                          │
│  (camera capture, video stream, image preprocessing, etc.)       │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              │  Option A: Subprocess
                              │  → python main.py
                              │
                              │  Option B: Import + frames
                              │  → scan_passport_from_frames(frames)
                              │  → scan_card_from_frames(frames)
                              │
                              │  Option C: Import + full flow
                              │  → main()  (uses built-in camera)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PAYMENT & IDENTITY DETECTION SYSTEM                             │
│  (main.py, core.scanner, core.validator, network.transmitter)    │
└─────────────────────────────────────────────────────────────────┘
```

**Recommended for upstream pipelines that already capture frames:** Use Option B and call `scan_passport_from_frames()` and / or `scan_card_from_frames()` with your frames.
