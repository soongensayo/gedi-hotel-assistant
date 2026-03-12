# Payment and Identity System

Hotel guest check-in: passport scan (MRZ), stay lookup, credit card capture, and submission to Supabase. Runs on laptop, Jetson, or other edge devices. **Headless (CLI) only** — no web UI.

---

## Quick start

1. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```
   Also install Tesseract (see Tesseract Setup section in [DEPLOYMENT.md](DEPLOYMENT.md)).

2. **EasyOCR models (required for passport/card OCR)**  
   Run once with internet:
   ```bash
   python download_easyocr_models.py
   ```
   See [DEPLOYMENT.md](DEPLOYMENT.md) for Windows SSL/Unicode tips and edge deployment.

3. **Config**  
Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (and optional `CAMERA_INDEX`, `EASYOCR_MODULE_PATH`, `OCR_TIMING`, `DEBUG_ACTIVATE`, `DESKEW_ENABLE`). See [DEPLOYMENT.md](DEPLOYMENT.md) for all variables.

4. **Run**
   ```bash
   python main.py
   ```
   Full check-in flow in the terminal: passport scan → confirm (with per-field edit) → stay details → credit card (camera / manual / NFC UID + manual) → review & submit (with per-field edit).

---

## End-to-end setup (Supabase + ESP32 NFC)

- **Supabase (`guests` table)**:
  - Create a `guests` table with at least: `passport_number` (text, primary identifier for a booking), `first_name`, `last_name`, optional `nfc_uid` (text) and `passport_path` (text for the Storage object path).
  - In `.env`, set `SUPABASE_URL` to your project REST URL (e.g. `https://YOUR_PROJECT.supabase.co/rest/v1/guests`) and `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` for writes.

- **Jetson / laptop (.env)**:
  - Point to your ESP32 and NFC listener:
    - `ESP32_WIFI_START_URL` – e.g. `http://<esp32_ip>/start` (ESP32 `/start` endpoint that wakes the NFC reader).
    - `NFC_SHARED_SECRET_KEY` – exactly 16 characters; must match `NFC_SHARED_SECRET_KEY` in `arduinofile.cpp`.
    - `JETSON_NFC_UID_PORT` – HTTP port where the Jetson listens for encrypted UIDs (default `8765`); must match `JETSON_PORT` in `arduinofile.cpp`.
  - Keep the existing settings for camera/OCR (`CAMERA_INDEX`, `EASYOCR_MODULE_PATH`, `OCR_TIMING`, `DEBUG_ACTIVATE`, `DESKEW_ENABLE`).

- **ESP32 + PN532**:
  - Flash `arduinofile.cpp` to an ESP32 wired to a PN532 over I²C (SDA=21, SCL=22, RESET=18, LED=2).
  - In the sketch, set WiFi SSID/password, `JETSON_HOST` to the Jetson/laptop IP, and `NFC_SHARED_SECRET_KEY` to the same 16‑char key as in `.env`.
  - On boot, the LED blinks three times and the serial log shows the ESP32 IP. When the Python app sends `send_start_to_esp32()`, the ESP32 decrypts the `ACTIVATE` command, brings the PN532 out of reset, turns the LED on, and posts an encrypted NFC UID back to the Jetson at `/nfc-uid`.

For detailed, step‑by‑step instructions (including Supabase schema, full `.env` reference, and ESP32 flashing), see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Other commands

| Command | Purpose |
|---------|--------|
| `python main.py` | Full CLI check-in flow. |
| `python run_test_image.py` | Test OCR with default image. |
| `python run_test_image.py path/to/image.jpg` | Test OCR with a specific image. |
| `python guest_card_tap.py [passport_id]` | Standalone NFC card tap to link an NFC UID to a guest booking. |

---

## Documentation

| Doc | Purpose |
|-----|--------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Installation, Tesseract setup, EasyOCR models, edge device deployment. |
| [docs/SYSTEM_FLOW_EXPLAINED.md](docs/SYSTEM_FLOW_EXPLAINED.md) | Full flow, architecture, OCR variants, and data model. |
| [PIPELINE_INTEGRATION.md](PIPELINE_INTEGRATION.md) | Calling from another pipeline or subprocess. |
