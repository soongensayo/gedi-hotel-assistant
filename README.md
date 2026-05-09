# Passport scanner pipeline

Python camera capture, MRZ detection, and EasyOCR for passport reading.

## Layout

- `camera-and-nfc/Identification-and-payment-app/` — **`core/scanner.py`** (pipeline), optional `run_test_image.py`, `download_easyocr_models.py`
- `scripts/` — CLI wrappers at the repo root (single capture, polling loop, or long-lived stdin worker)

## Setup

```bash
cd camera-and-nfc/Identification-and-payment-app
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
# EasyOCR installs opencv-python-headless (no GUI). Override it:
pip install --force-reinstall opencv-python
```

Copy `.env.example` to `.env` in that same folder and tune camera / OCR vars as needed.

## Run

From the **repository root**:

```bash
# One-shot: live camera → JSON on stdout
python scripts/scan_passport.py

# One-shot: still image
python scripts/scan_passport.py path/to/frame.png

# Poll until MRZ read or timeout (stderr = progress)
python scripts/scan_passport_easyocr_poll.py --timeout 120

# Persistent worker (stdin JSON lines: warmup, scan, guide_on, guide_off)
python scripts/passport_scanner_worker.py
```

Interactive / debug helper (from the `Identification-and-payment-app` folder):

```bash
python run_test_image.py
python run_test_image.py --capture
```

## Output

Successful runs print a JSON object with `passport_id`, `guest_name`, and optional `passport_image_base64`.
