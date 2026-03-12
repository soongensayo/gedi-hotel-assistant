# Deployment and Edge Device Setup

This guide covers installing and running the Payment and Identity System on a development machine or an **edge device** (e.g. Jetson, Raspberry Pi, or a PC without reliable internet). The main goals are:

- Avoid runtime downloads and SSL issues by using **bundled EasyOCR models**.
- Explain how to wire the system to your **Supabase** project and (optionally) an **ESP32 + PN532 NFC reader** over WiFi.

---

## Quick start (development)

1. **Python 3.7+** and **Tesseract** (see the Tesseract Setup section below).
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. **EasyOCR models (choose one):**
   - **Option A – Download once (recommended):** Run the download script (requires internet and working SSL):
     ```bash
     python download_easyocr_models.py
     ```
     On Windows if you see a Unicode/progress-bar error, run:
     ```bash
     set PYTHONIOENCODING=utf-8
     python download_easyocr_models.py
     ```
     On Windows if you see **SSL certificate errors**, install:
     ```bash
     pip install python-certifi-win32
     ```
     then run the script again.
   - **Option B – Use bundled folder:** If you already have an `easyocr_models/` folder (from another machine or a build step), copy it into the project root. It must contain `craft_mlt_25k.pth` and `english_g2.pth`.
4. Copy `.env.example` to `.env` and set at least `SUPABASE_URL` and `SUPABASE_ANON_KEY` (and optionally `SUPABASE_SERVICE_ROLE_KEY`) if you use the server.
5. (Optional) If you plan to use **ESP32 NFC card tap**, also set:
   - `ESP32_WIFI_START_URL` – e.g. `http://<esp32_ip>/start`
   - `NFC_SHARED_SECRET_KEY` – exactly 16 characters; must match the key in `arduinofile.cpp`
   - `JETSON_NFC_UID_PORT` – HTTP port where this app listens for encrypted UIDs (default `8765`)
6. Run:
   ```bash
   python main.py
   ```
   Or test with a static image:
   ```bash
   python run_test_image.py
   python run_test_image.py path/to/passport_or_card.jpg
   ```

---

## Edge device deployment (offline / no SSL)

To run on a device that has no internet or has strict SSL/firewall limits:

1. **On a machine with internet**, run once:
   ```bash
   pip install -r requirements.txt
   python download_easyocr_models.py
   ```
   This creates the `easyocr_models/` folder with the two EasyOCR model files.

2. **Copy the whole project** to the edge device, including:
   - `easyocr_models/` (folder with `craft_mlt_25k.pth` and `english_g2.pth`)
   - All Python files, `core/`, `network/`, `requirements.txt`, `.env.example`

3. **On the edge device:**
   ```bash
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env: SUPABASE_*, CAMERA_INDEX, ESP32_WIFI_START_URL, NFC_SHARED_SECRET_KEY, JETSON_NFC_UID_PORT as needed.
   python main.py
   ```
   The app will load EasyOCR from `easyocr_models/` and **will not download** anything (no network, no SSL).

4. **Optional:** Set `EASYOCR_MODULE_PATH` in `.env` if you put the models in a different path, e.g.:
   ```bash
   EASYOCR_MODULE_PATH=/opt/payment-system/easyocr_models
   ```

---

## Environment variables

| Variable | Purpose |
|----------|--------|
| `SUPABASE_URL` | Supabase project URL or full REST URL. If it does not include `/rest/v1/`, the app appends `/rest/v1/guests`. |
| `SUPABASE_ANON_KEY` | Anon key (or use `SUPABASE_SERVICE_ROLE_KEY` for write). |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional service-role key used when present (overrides anon key) for authenticated writes. |
| `CAMERA_INDEX` | Camera device index (0, 1, …). Set if the default camera is wrong. |
| `EASYOCR_MODULE_PATH` | Path to folder with EasyOCR `.pth` files. If unset, app uses `./easyocr_models/` when present. |
| `DISABLE_EASYOCR` | Set to `1` to use Tesseract-only (limited OCR). |
| `ESP32_WIFI_START_URL` | HTTP URL for the ESP32 `/start` endpoint (e.g. `http://192.168.1.50/start`). Used to wake the NFC reader. |
| `NFC_SHARED_SECRET_KEY` | Shared 16‑character AES-128 key used between Jetson/laptop and ESP32 for encrypting/decrypting `ACTIVATE` and NFC UIDs. Must match the key in `arduinofile.cpp`. |
| `JETSON_NFC_UID_PORT` | HTTP port (default `8765`) where this app listens for encrypted NFC UIDs from the ESP32. Must match `JETSON_PORT` in `arduinofile.cpp`. |
| `NFC_SERIAL_PORT` | (Legacy / optional) Serial port for NFC reader (e.g. `COM3` on Windows, `/dev/ttyUSB0` on Linux). Still used by `guest_card_tap.py` and `network/nfc_serial.py` if you use the serial-based NFC flow. |
| `OCR_TIMING` | Set to `true` or `1` to log OCR step timings (e.g. when running `run_test_image.py`); set to `false` or leave unset for no timing logs. **Master switch** – only this variable controls timing logs; `.env` overrides any value set in the terminal. |
| `DEBUG_ACTIVATE` | Set to `true` to save debug images to `debug/variants/`; `false` to save none. |
| `DESKEW_ENABLE` | Set to `true` (default) to compute tilt from detection boxes and rotate the crop; set to `false` to skip tilt/rotation and use the captured alignment crop as-is (CLAHE + detection still run). |

See `.env.example` for a template with typical defaults.

### OCR timing and the terminal

The app loads `.env` with override, so values in `.env` always win. If you previously set `OCR_TIMING` in the terminal (e.g. PowerShell: `$env:OCR_TIMING="1"`) and want to rely only on `.env`, you can unset it in that session:

- **PowerShell:** `Remove-Item Env:OCR_TIMING -ErrorAction SilentlyContinue`
- Then run: `python run_test_image.py` (or `main.py`). Timing on/off is read from `.env` only.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| **EasyOCR not available – SSL / certificate error** | Run `python download_easyocr_models.py` on a machine with internet (and `pip install python-certifi-win32` on Windows if needed). Then copy `easyocr_models/` to the edge device. |
| **EasyOCR not available – Unicode/progress bar crash (Windows)** | Run with `set PYTHONIOENCODING=utf-8` then `python download_easyocr_models.py`. |
| **No winning MRZ lines / Card: no result** | Usually means EasyOCR did not load. Ensure `easyocr_models/` exists with both `.pth` files, or run the download script once. |
| **Tesseract not found** | Install Tesseract and set its path; see the Tesseract Setup section below. |

---

## Tesseract Setup (Windows)

Tesseract is one of the OCR engines used by the scanner (together with EasyOCR). The Python package `pytesseract` is only a wrapper -- you must install the Tesseract binary separately on Windows.

### Download and install

1. Go to: **https://github.com/UB-Mannheim/tesseract/wiki**
2. Download the **64-bit** installer (e.g. [tesseract-ocr-w64-setup-5.5.0.20241111.exe](https://github.com/tesseract-ocr/tesseract/releases/download/5.5.0/tesseract-ocr-w64-setup-5.5.0.20241111.exe)).
3. Run the installer. **Keep the default path**: `C:\Program Files\Tesseract-OCR` (the scanner checks this path automatically).
4. Optionally add Tesseract to PATH during setup -- not required if using the default path.

### Verify installation

Open a **new** terminal and run:

```
"C:\Program Files\Tesseract-OCR\tesseract.exe" --version
```

You should see version info (e.g. `tesseract 5.5.0`).

### Custom install path

If Tesseract is installed elsewhere (e.g. `D:\Tesseract`), add your path to the list in `core/scanner.py`:

```python
_tesseract_paths = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    r"D:\Tesseract\tesseract.exe",  # your custom path
]
```

---

## Supabase guests table and NFC end-to-end test

### Supabase `guests` table (minimum columns)

Create a table named `guests` with at least:

- `passport_number` – `text`, unique identifier for a booking (used in REST filters).
- `first_name` – `text`.
- `last_name` – `text`.
- `nfc_uid` – `text`, nullable (hex NFC card UID, e.g. `"09C9C802"`).
- `passport_path` – `text`, nullable (path to PNG in the private `passports` Storage bucket, e.g. `"P123456AA/abcdef123456.png"`).

You can add additional columns (e.g. `room_number`, `check_in_date`, `check_out_date`, `amount_owed`) as your backend requires; the app only assumes the columns above for NFC and image handling.

### ESP32 + PN532 setup (WiFi / HTTP NFC path)

1. **Flash the sketch**
   - Open `arduinofile.cpp` in the Arduino IDE.
   - Select an ESP32 board (e.g. **ESP32 Dev Module**) and the correct COM port.
   - Set the WiFi SSID/password near the top of the sketch.
   - Set:
     - `JETSON_HOST` to the Jetson/laptop IP address (same network as the ESP32).
     - `JETSON_PORT` to the same value you will use in `.env` for `JETSON_NFC_UID_PORT` (default `8765`).
     - `NFC_SHARED_SECRET_KEY` to a **16‑character string** that matches `.env` `NFC_SHARED_SECRET_KEY`.
   - Upload the sketch. On reset, the LED on GPIO2 blinks 3× to confirm wiring.

2. **Confirm ESP32 connectivity**
   - Open the Arduino Serial Monitor at 115200 baud.
   - On boot you should see:
     - WiFi connection attempt and the assigned IP address.
     - A line like: `HTTP server started on port 80. Waiting for /start...`
   - Note the IP address and set `ESP32_WIFI_START_URL` in `.env`, e.g.:
     - `ESP32_WIFI_START_URL=http://192.168.1.50/start`

3. **Run the Jetson/laptop app and test NFC**
   - Ensure `.env` contains:
     - `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
     - `ESP32_WIFI_START_URL`, `NFC_SHARED_SECRET_KEY`, `JETSON_NFC_UID_PORT`.
   - Run:
     ```bash
     python main.py
     ```
   - Go through the check-in flow until the **“Scan card with NFC”** option:
     - When you choose NFC, the app calls `send_start_to_esp32()`, which encrypts the word `ACTIVATE` using `NFC_SHARED_SECRET_KEY` and POSTs it to `ESP32_WIFI_START_URL`.
     - On the ESP32 Serial Monitor you should see `/start` received, the decrypted payload `ACTIVATE`, and `LED ON. System now ACTIVE — waiting for card tap.`
   - Tap a card on the reader:
     - ESP32 prints the UID (e.g. `09C9C802`), encrypts it, and POSTs to `http://JETSON_HOST:JETSON_PORT/nfc-uid`.
     - The Jetson/laptop app decrypts the UID and, using `link_nfc_uid_to_guest()`, PATCHes your Supabase `guests` row where `passport_number=eq.<passport_id>` to set `nfc_uid`.
   - Back in the CLI, you should see a message like:
     - `Card UID 09C9C802 linked to your booking successfully.`

If any step fails, check the Serial Monitor and Python logs (`payment_system.log`) for the exact error (key mismatch, wrong IP/port, missing columns, etc.).

---

## Files added for deployment

- **`download_easyocr_models.py`** – One-time script to download EasyOCR English models into `easyocr_models/`.
- **`easyocr_models/`** – Folder for `craft_mlt_25k.pth` and `english_g2.pth` (created by the script or copied from another machine). Can be excluded from git via `.gitignore`; for edge, copy the folder when deploying.
- **`.env.example`** – Template for `.env` (Supabase, camera, EasyOCR path, NFC/ESP32 vars, OCR_TIMING, DEBUG_ACTIVATE).
- **`certifi`** in `requirements.txt` – Improves SSL for model download and HTTPS; on Windows, `python-certifi-win32` can fix certificate errors.
