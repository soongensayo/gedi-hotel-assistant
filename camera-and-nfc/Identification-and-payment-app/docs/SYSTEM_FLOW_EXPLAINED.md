# Payment and Identity System – In-Depth Step-by-Step Explanation

A modular Python project for hotel guest check-in: passport scan (MRZ), stay lookup, credit card capture, and submission to Supabase. Compatible with Jetson Nano/Orin (ARM64) and standard Linux/Windows.

This document gives a **quick start** (overview, install, config) and then describes **everything that happens** in the application so you can ask follow-up questions (e.g. to Gemini) about specific steps, modules, or flows.

---

## Project overview and quick start

### Project structure

```
.
├── main.py                     # Entry point – linear check-in flow
├── guest_card_tap.py           # Standalone NFC card tap (link UID to guest)
├── run_test_image.py           # Test passport/card OCR on a static image
├── download_easyocr_models.py  # One-time: download EasyOCR models into easyocr_models/
├── core/
│   ├── data_model.py           # CheckInData class
│   ├── scanner.py              # Camera, OCR, passport MRZ & card scanning
│   ├── manual_input.py         # Touch screen / manual entry (if used)
│   └── validator.py            # Validation (name, passport, card, Luhn)
├── network/
│   ├── transmitter.py          # Supabase: fetch guest, upsert, upload image, link NFC
│   ├── nfc_serial.py           # Serial listener for ESP32 NFC UIDs
│   └── nfc_supabase.py         # NFC UID linking via Supabase client
├── easyocr_models/             # EasyOCR English models (run download_easyocr_models.py once)
├── docs/                       # Documentation (this file)
├── requirements.txt            # Python dependencies
├── .env.example                # Template for .env (copy to .env)
├── DEPLOYMENT.md               # Edge device setup, Tesseract install, offline/EasyOCR
├── PIPELINE_INTEGRATION.md     # Calling from an upstream pipeline or subprocess
└── .env                        # SUPABASE_*, CAMERA_INDEX, NFC_SERIAL_PORT, etc.
```

### Features

- **Linear check-in flow:** Passport scan (compulsory) → confirm details → fetch stay from server → show stay → credit card → review & submit.
- **Passport:** Multi-frame capture, deskew, MRZ zone detection (OCR-driven or fixed), multi-variant OCR, TD3 decode, consensus voting; passport image always saved (base64 in `CheckInData`) and uploaded to a private Supabase Storage bucket on submit. Guests can edit **name** or **passport number** individually on the confirmation screen.
- **Credit card:** Multi-frame scan with zone OCR and Luhn/expiry/name consensus, manual entry, or NFC UID linking + manual details.
- **Supabase backend:** Fetch guest by passport_id (GET); upsert into `guests` table (PATCH then POST fallback) with `first_name`, `last_name`, `guest_name`, `passport_id`, `card_details`, and optional `passport_path` (file path into private `passports` Storage bucket) and `nfc_uid`.
- **Mock mode:** If camera/OCR or Jetson GPIO is unavailable, app runs in mock mode (simulated scan, no real hardware).
- **Validation:** Guest name, passport ID, card number (Luhn), expiry (MM/YY), CVV; full check before submit.
- **Logging:** Console + `payment_system.log`.

### Installation

1. Python 3.7+.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   On Jetson, `Jetson.GPIO` and `opencv-python` may need platform-specific install.
   For Tesseract OCR, install the **Tesseract** binary separately (see the Tesseract Setup section in [DEPLOYMENT.md](../DEPLOYMENT.md)).
3. **EasyOCR models** (required for passport MRZ and card OCR): run once with internet:
   ```bash
   python download_easyocr_models.py
   ```
   This creates `easyocr_models/` so the app works offline on edge devices. See [DEPLOYMENT.md](../DEPLOYMENT.md) for SSL/Windows tips and edge deployment.

### Usage

```bash
python main.py
```

- **Mock mode:** If hardware is not detected, you get “MOCK HARDWARE” and simulated passport/card data; you can test the full flow with console input.
- **Real mode:** Camera opens (green alignment box for passport or card), OCR runs, consensus and confirm steps as in the flow below.

### Configuration

Copy `.env.example` to `.env` and set variables as needed. Main ones:

- **SUPABASE_URL** – Project URL (e.g. `https://xxxx.supabase.co`). Required for server sync.
- **SUPABASE_ANON_KEY** – Anon key (or **SUPABASE_SERVICE_ROLE_KEY** for write).
- **CAMERA_INDEX** – Camera device index (0 = default, 1 = first USB). On Windows, external USB often needs this.
- **EASYOCR_MODULE_PATH** – (Optional) Path to EasyOCR models folder. If unset, the app uses `./easyocr_models/` when present.
- **OCR_TIMING** – Set to `true` or `1` to log OCR step timings; `false` or unset for no timing logs. Master switch; `.env` overrides terminal.
- **DEBUG_ACTIVATE** – Set to `true` to save debug images to `debug/variants/`; `false` for none.

See `.env.example` and [DEPLOYMENT.md](../DEPLOYMENT.md) for the full list.

### CheckInData (central data)

- **guest_name** – Full name.
- **passport_id** – Passport number.
- **card_details** – Dict: `card_no`, `expiry`, `cvv`, `cardholder_name`.
- **passport_image_base64** – Deskewed passport image as base64 PNG (saved on every scan, kept in memory; on submit it is uploaded to Supabase Storage and only the file path is stored in the database).
- **nfc_uid** – Hex UID of the NFC card linked to this guest (when NFC is used).

### Logging

- **Console** and **payment_system.log** (INFO).
- Levels: INFO (normal flow), WARNING (e.g. hardware fallback), ERROR (failures), DEBUG (detailed).
- OCR timing lines (`[OCR_TIMING] ...`) are controlled only by **OCR_TIMING** in `.env`; set to `false` to turn them off.

### File-by-file summary

| File | Purpose |
|------|---------|
| `main.py` | Entry point – runs linear check-in flow (`run_check_in_flow`): passport scan → confirm → fetch stay → card → review & submit. No main menu; one fixed sequence. |
| `core/data_model.py` | Defines `CheckInData` – holds `guest_name`, `passport_id`, `card_details`, `passport_image_base64`, `nfc_uid`. `to_dict()`, `update_from_dict()`, `is_complete()`. |
| `core/scanner.py` | Camera + OCR: capture (alignment box, multi-frame), deskew, MRZ/card zone detection, multi-variant OCR (Tesseract + EasyOCR), consensus. `scan_passport()`, `scan_card()`, `capture_passport_image_only()`, `detect_hardware()`. |
| `core/validator.py` | Validation: guest name, passport ID, card number (Luhn), expiry (MM/YY), CVV. `validate_check_in_data()` for full check before submit. |
| `core/manual_input.py` | Manual entry / touch screen (if used); can override or correct scanned data. |
| `network/transmitter.py` | Supabase + Storage: `fetch_guest_by_passport_id()` (GET `guests`), `link_nfc_uid_to_guest()` (PATCH `guests.nfc_uid`), `upload_passport_image()` (POST to Storage `passports` bucket), `get_passport_image()` (POST signed URL), `send_data()` (PATCH/POST upsert into `guests` with `passport_path`), `send_data_mock()`. URL and keys from `.env`. |

### Confirmation pattern

In both scan and manual flows: **capture** → **validate** → **show** data → **ask** “Is this correct? (y/n)” → if **y**, save into `CheckInData` and continue; if **n**, retry capture.

### Key concepts

- **`Optional[str]`** – value can be a string or `None` (“not set yet”).
- **`Dict[str, Any]`** – dictionary with string keys and values of any type.
- **`Tuple[bool, str]`** – e.g. `(True, "")` or `(False, "error message")` from validators.
- **`try/except`** – used for optional libraries (OpenCV, Tesseract, EasyOCR) and camera/OCR so the app doesn’t crash; mock mode when hardware is missing.
- **`@dataclass`** – generates `__init__` and helpers for a data-holding class (e.g. `CheckInData`).
- **JSON** – text format for sending data over the network; `json.dumps()` turns a Python dict into a JSON string.
- **HTTPS** – HTTP with encryption; required for the transmitter (non-HTTPS URLs are rejected).

---

## 1. Application entry and startup

**File:** `main.py`

1. **Load environment**
   - `load_dotenv()` loads `.env` (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CAMERA_INDEX, OCR_TIMING, DEBUG_ACTIVATE, etc.). The scanner module also loads `.env` with override so it is the source of truth for OCR_TIMING.

2. **Logging**
   - Logging is configured to write to both **console** and **payment_system.log** (INFO level).

3. **main()**
   - **Clear debug images:** `_clear_roi_debug_images()` deletes previous run’s debug PNGs (ocr_roi_frame_*.png, name_roi_debug*.png, deskewed_frame_*.png, deskew_debug_*.png, passport_mrz_debug*.png).
   - **Hardware detection:** `detect_hardware()` checks for OpenCV + Jetson GPIO; if either is missing, the app runs in “mock” mode (no real camera/GPIO).
   - **Create data container:** `CheckInData()` – one object holds guest_name, passport_id, card_details, passport_image_base64 for the whole session.
   - **Run linear flow:** `run_check_in_flow(check_in_data)` – no main menu; the flow is fixed: passport → confirm → server → stay details → card → review & submit.

---

## 2. Linear check-in flow (high level)

**Function:** `run_check_in_flow(check_in_data)` in `main.py`

| Step | What happens |
|------|----------------|
| **1** | **Passport scan (compulsory)** – `_do_passport_scan_compulsory(check_in_data)`. Guest must scan passport; image is always saved. If MRZ cannot be read, guest can rescan or enter details manually (manual only after a scan). |
| **1b** | **Confirm passport details** – `_confirm_passport_details_before_server(check_in_data)`. Guest reviews name and passport number (y = yes, e = edit, c = cancel). On edit, they can change **only guest name** or **only passport number** via a small submenu. No server call until they confirm. |
| **2** | **Fetch stay from server** – `fetch_guest_by_passport_id(check_in_data.passport_id)`. GET request to Supabase `guests` table filtered by `passport_id=eq.<id>`. On success, guest name may be updated from server; on failure, mock stay details are used. |
| **2b** | **Show stay details** – `_display_stay_details(stay_details)` prints guest name, passport, room, check-in/out, status. Guest presses Enter to continue. |
| **3** | **Credit card** – `_collect_credit_card_linear(check_in_data)`. Guest chooses: (1) Scan card with camera, (2) Enter card manually, or (3) Scan card with NFC (link NFC UID to their booking, then capture card details manually). Result is stored in `check_in_data.card_details` and NFC UID in `check_in_data.nfc_uid` when used. |
| **4** | **Review and submit** – `review_and_submit_menu(check_in_data)`. Shows all data, lets the guest edit individual fields, validates, then (on confirm) asks: (1) Mock send, (2) Real send to Supabase. |

---

## 3. Passport scan in detail

### 3.1 Compulsory passport step (`_do_passport_scan_compulsory`)

- Calls `scan_passport()` (see below).
- If **no usable image** (e.g. camera failed): asks “Try again? (y/n)”. If no → cancel check-in.
- If **image captured**:
  - **Always** saves `passport_image_base64` into `check_in_data` (overwrites any previous).
  - If **MRZ decoded** (passport_id present): saves passport_id and guest_name, returns success.
  - If **MRZ not decoded**: tells guest “image saved but could not read passport number”. Options:
    - **m** = enter passport number and name manually (image already saved).
    - **r** = rescan (new scan will override the saved image).

No option to skip scanning; manual entry is only offered after at least one scan.

### 3.2 Full passport scan pipeline (`scan_passport()` in `core/scanner.py`)

1. **Capture top-2 frames (one interaction)**
   - `_capture_frames_from_camera(doc_type="passport")`:
     - Opens camera (`_open_camera()`: Windows uses CAP_DSHOW and tries CAMERA_INDEX, then common fallbacks).
     - Shows a live preview with a **green alignment rectangle** for the passport crop.
     - On **SPACE/Enter**, captures a burst of frames and keeps the **top-2 sharpest**.
   - `_show_capture_for_verification(frames[0])` shows the first captured frame for a quick accept/retake. If retake, capture repeats.

2. **Per-frame MRZ processing** (`_collect_passport_raw_pool(frame, frame_index)`)

   For each frame:

   - **Crop:** `_crop_passport_alignment_region(frame)` – center passport alignment region.
   - **Detection + optional deskew (Pass 1):** `_text_based_deskew(crop, label="passport")`:
     - Always builds a CLAHE-enhanced master image and runs EasyOCR once to get **detection boxes** (text locations) on the cropped frame.
     - If `DESKEW_ENABLE=true` (set in `.env`), uses those boxes (and a Hough-line fallback) to compute a median tilt angle and rotates the **original** crop so the page is level. If `DESKEW_ENABLE=false`, no tilt/rotation is applied and the cropped image is used as-is.
     - OCR text from this step is not used for MRZ content; it only drives the optional rotation and debug overlays. When `DEBUG_ACTIVATE=true`, debug images such as `deskew_debug_passport_frame_*.png`, `deskew_tilt_passport_frame_*.png`, `deskew_debug_zone_passport.png`, and `detection_boxes_passport_frame_*.png` are written under `debug/variants/passport/`.
   - **MRZ line detection (Pass 2):** `_detect_mrz_lines_with_easyocr(deskewed)` – run a **dedicated** EasyOCR `readtext()` on the bottom 45% of the **deskewed (or raw, if deskew disabled)** image (CLAHE-enhanced) to find two 44-character MRZ lines. Uses P&lt; anchor and chevron density to pick Line 1 and Line 2 boxes. Returns bounding boxes; caller expands them to full width and crops each line ROI from the deskewed image.
   - **MRZ-only 6-variant OCR per line ROI:** For each MRZ ROI, `_shotgun_ocr_on_mrz_roi(line_roi)` builds 6 variants and runs Tesseract + EasyOCR. For EasyOCR it also **stitches split boxes** into full-line candidates (left→right ordering; special handling for `P<...` plus a nearby name fragment).
   - **Band fallback:** If line detection fails, a multi-band strip from the bottom region is OCR’d and its results are added to both line pools.
   - Output of this step is two pools: `(line1_pool, line2_pool)` i.e. many `(text, confidence)` entries per line.

3. **Gate (assemble + validate, still no “field parsing” yet)**
   - `_gate_mrz_from_pools(line1_pool, line2_pool)` builds TD3 candidates:
     - **Line 1**: normalize OCR loosely, extract 44-char windows anchored at `P<` (issuing-state sanity check).
     - **Line 2**: scan 44-char windows and score them using TD3 checksum validation (doc number, DOB, expiry, composite). It also tries lightweight OCR corrections at check-digit positions (O→0, I→1, etc.).
   - Returns `(line1_candidates, valid_line2s, checksum_pass_count)`.

4. **Independent line consensus, then decode once**
   - `_confidence_weighted_vote(line1_candidates)` picks the winning Line 1 string (highest sum of confidence). `_confidence_weighted_vote(valid_line2s)` picks the winning Line 2 string.
   - `_decode_mrz_winners(winning_l1, winning_l2)` calls `_parse_mrz_td3(line1, line2)` **once** to get passport_id (Line 2 positions 0–9) and guest_name (Line 1 name block: surname&lt;&lt;given, TD3 format). So ID and name always come from the same pair of consensus-winning lines; no vote dilution from cross-product pairs.
   - If passport_id is still None, a fallback uses `checksum_pass_count` (mass_winner_id or best_checksum_id) to choose an ID.
   - For debugging, `_print_consensus("Passport ID", ...)` and `_print_consensus("Guest Name", ...)` show ranked candidates (ID from valid_line2s; name from winning_l1 paired with each valid_l2).

5. **If no frame yielded a valid MRZ**
   - Still save image: crop + deskew the **last (or first confirmed) frame**, encode to base64, store as `passport_image_base64`. Return passport_id/guest_name as `None` but with image so manual entry can still proceed.

6. **Encode image for submission**
   - `_passport_image_to_base64(deskewed)` → PNG encode deskewed image, base64 string. That string is stored in `CheckInData.passport_image_base64`; when the guest submits, the app uploads it to the private Supabase Storage bucket and stores only the resulting file path (`passport_path`) in the `guests` table.

---

## 4. OCR variants and mass consensus (used for MRZ and card)

**Functions:** `_build_six_variants(roi)` and `_shotgun_ocr_on_roi(roi)` in `core/scanner.py`

- **Preprocessing per ROI:**
  - Start from a fresh copy of the ROI (`v1_orig`).
  - Build 6 variants:
    - v1: original crop.
    - v2: sharpened (`_sharpen_for_ocr`).
    - v3: median blur (`cv2.medianBlur(..., 5)`) + sharpen.
    - v4: grayscale of v3.
    - v5: Otsu threshold of v3.
    - v6: CLAHE on v3 (clipLimit ≈ 1.2, grid 8×8).
- **Shotgun OCR:** `_shotgun_ocr(image)` runs, for each variant:
  - Tesseract: `image_to_string` with PSM 6 and PSM 7 (each result stored as `(text, 0.5)` – fixed confidence for Tesseract).
  - EasyOCR: `OCR_READER.readtext(image, detail=1)`; each detection contributes `(text, real_confidence)`.
- `_shotgun_ocr_on_roi(roi)` calls `_build_six_variants(roi)` and `_shotgun_ocr` on each variant, returning a big list of `(text, confidence)` pairs.

So for both **MRZ** and **card fields** (PAN, expiry, name), the system:
- Detects the ROI(s) once per frame (using EasyOCR for card ROI detection, fixed band positions for MRZ).
- Runs the 6-variant × 3-engine shotgun OCR on each ROI.
- Collects all `(text, confidence)` results into raw pools and then applies **strict gates** and **confidence-weighted voting** to pick winners.

### Switching the base for v4, v5, v6 (v2 vs v3)

By default, **v4** (and therefore v5, v6) is built from **v2** (sharpen only). Switch to **v3** (median blur + sharpen) when the image is too noisy.

Set **`OCR_USE_V3_BASE`** in `.env` (recommended) or in the terminal before running. `.env` values override terminal values.

- **Use v3 as base (noisy environment):** Set `OCR_USE_V3_BASE=1` in `.env`.
- **Use v2 as base (default):** Omit the variable, or set it to `0` or `false`.

---

## 5. Credit card flow in detail

### 5.1 Collection (`_collect_credit_card_linear`)

- Guest chooses: (1) Scan card with camera, (2) Enter manually, or (3) Scan card with NFC.
- **Scan (camera):** `_capture_card_via_ocr()` → calls `scan_card()` (see below). Then validates card number (Luhn), expiry (MM/YY), CVV; if CVV missing (back of card), prompts for it. Shows captured data, asks “Is this correct?”. On yes, stores in `check_in_data.card_details`.
- **Manual:** `_capture_card_manually()` – input card number, expiry, CVV, cardholder name; same validators; confirm; store in `check_in_data.card_details`.
- **NFC:** `_capture_card_via_nfc(check_in_data)` – waits for an NFC card tap on `NFC_SERIAL_PORT`, links the NFC UID to the guest booking via Supabase (`link_nfc_uid_to_guest`), saves `check_in_data.nfc_uid`, then runs the same manual card entry flow to collect card number/expiry/CVV/cardholder.

### 5.2 Card scan pipeline (`scan_card()` in `core/scanner.py`)

1. **Frames (2-shot capture):** `capture_card_frames()` – one user-confirmed capture (green box = card zone RECT_W×RECT_H 560×400); burst of 10 frames, keeps the top-2 sharpest. Total: **2 master frames**.
2. **Per frame:** `scan_card_from_frame(frame, frame_index)`:
   - Crop to card alignment region, deskew (`_text_based_deskew` then 2× upscale), sharpen. Pass 2: CLAHE master + EasyOCR to detect PAN and expiry ROIs; fall back to fixed `CARD_ZONES` if detection fails.
   - Derive ROIs: `num_roi` (number line), `exp_roi` (expiry), `name_roi` (name), and `strip` (band under the number row). All ROIs are cropped from the processed card, not from the CLAHE master.
   - For each ROI, run the **6-variant shotgun OCR** via `_shotgun_ocr_on_roi(roi)`, producing rich raw pools for PAN, expiry, and name.
   - Debug: save `deskewed_frame_{index}.png`, `name_roi_debug_frame_{index}.png`, and for the first frame, the 6 variants into `debug/variants/`.
3. **Mass consensus (global across frames):**
   - All `(text, confidence)` results from all frames are combined into global raw pools: `all_pan`, `all_expiry`, `all_name`.
   - **Strict gates:** `_gate_pan`, `_gate_expiry`, `_gate_name` filter each pool, returning only valid `(value, confidence)` pairs:
     - PAN: 12–19 digits + Luhn (with possible correction); confidence reduced slightly for corrected numbers.
     - Expiry: must normalize to `MM/YY` and have a valid month 01–12.
     - Name: at least 2 words, no digits, only letters/spaces/hyphens, and must **not** be composed entirely of card-brand words (blocklist: VISA, MASTERCARD, DEBIT, CREDIT, BANK, PLATINUM, WORLD, REWARDS).
   - **Confidence-weighted vote:** `_confidence_weighted_vote()` groups each bucket by value, sums all confidences per value, and picks the winner with the **highest total confidence**. `_print_consensus()` prints the ranked tables for PAN, expiry, and name.
4. Returns one dict: `card_no`, `expiry`, `cvv` (None from OCR), `cardholder_name`.

---

## 6. Validation (`core/validator.py`)

- **Guest name:** 2–100 chars, only letters, spaces, hyphens, apostrophes.
- **Passport ID:** 6–20 chars, uppercase letters and numbers only.
- **Card number:** digits only, 13–19 digits, **Luhn checksum**.
- **Expiry:** MM/YY format (e.g. 12/25), month 01–12.
- **CVV:** 3 or 4 digits.
- **Full check-in:** `validate_check_in_data(check_in_data)` requires guest_name, passport_id, and valid card_details (number, expiry, CVV). Used in review menu before allowing submit.

---

## 7. Data model (`core/data_model.py`)

- **CheckInData** (dataclass): `guest_name`, `passport_id`, `card_details` (dict with card_no, expiry, cvv, cardholder_name), `passport_image_base64`, `nfc_uid`.
- **to_dict():** For JSON/send: guest_name, passport_id, card_details; if present, passport_image_base64 and nfc_uid.
- **update_from_dict():** Update fields from a dict (e.g. after scan or API).
- **is_complete():** True only when guest_name, passport_id, and card_details are all set.

---

## 8. Network (`network/transmitter.py`)

- **REST URL and headers (database):** `_resolve_endpoint_url()` / `_build_auth_headers()` – use env `SUPABASE_URL` (if missing `/rest/v1/`, appends `/rest/v1/guests`) and `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` for `apikey` + `Authorization: Bearer ...`.
- **REST URL (Storage):** `_get_storage_url()` – derives `https://<project>.supabase.co/storage/v1` from `SUPABASE_URL`; used for uploads and signed URLs.
- **Fetch guest (GET):** `fetch_guest_by_passport_id(passport_id)` – `GET {SUPABASE_URL}/rest/v1/guests?passport_id=eq.{encoded_id}`. Returns `(guest_row dict, None)` or `(None, error_message)`. Used after passport confirm to load stay details.
- **Link NFC UID (PATCH):** `link_nfc_uid_to_guest(passport_id, nfc_uid)` – `PATCH {SUPABASE_URL}/rest/v1/guests?passport_id=eq.<id>` with JSON body `{"nfc_uid": "<HEX>"}`. Used by both the NFC card-tap script and the NFC option in the main flow.
- **Upload passport image (Storage POST):** `upload_passport_image(passport_id, image_base64)` – decodes base64, then `POST {project}/storage/v1/object/passports/<passport_id>/<uuid>.png`. On success returns the Storage object path (e.g. `"AB1234567/abc123def456.png"`), which is stored in the `passport_path` column.
- **Get signed image URL (Storage POST):** `get_passport_image(file_path, expiry_seconds=60)` – `POST {project}/storage/v1/object/sign/passports/{file_path}` with JSON `{"expiresIn": 60}`. Returns a short-lived signed URL that can be used directly in an `<img src="...">`.
- **Send data (PATCH/POST upsert):** `send_data(check_in_data)`:
  - Build `payload` from `CheckInData` (`guest_name`, `passport_id`, `card_details`, `nfc_uid`), splitting `guest_name` into `first_name` and `last_name`.
  - If `passport_image_base64` is present, call `upload_passport_image()` first; include the returned Storage object path as `passport_path` in the payload.
  - If `passport_id` set: try `PATCH {SUPABASE_URL}/rest/v1/guests?passport_id=eq.<id>` with JSON payload (update existing row). If no row is updated, fall back to `POST` (insert new row).
  - Returns `(True, None)` on 2xx, else `(False, error_msg)`. All errors are logged to `payment_system.log`.
- **Mock send:** `send_data_mock(check_in_data)` – no HTTP, just log the payload; returns `(True, None)`.

### Supabase endpoint cheat sheet (what is GET vs POST)

- **GET (database):** `GET {SUPABASE_URL}/rest/v1/guests?passport_id=eq.<id>` – used by `fetch_guest_by_passport_id` to look up existing stays.
- **PATCH (database):**
  - `PATCH {SUPABASE_URL}/rest/v1/guests?passport_id=eq.<id>` – used by `link_nfc_uid_to_guest` and as the first step in `send_data` upsert.
- **POST (database):** `POST {SUPABASE_URL}/rest/v1/guests` – used by `send_data` when there is no existing guest with that `passport_id`.
- **POST (Storage upload):** `POST {project}/storage/v1/object/passports/<passport_id>/<uuid>.png` – used by `upload_passport_image` to save the raw passport image bytes into the private `passports` bucket.
- **POST (Storage signed URL):** `POST {project}/storage/v1/object/sign/passports/<file_path>` – used by `get_passport_image` to get a temporary public URL that you can put into an `<img>` tag.

---

## 9. Review and submit (`review_and_submit_menu` in `main.py`)

1. Print all data (card number masked to last 4 digits).
2. Ask for action: **`c` = confirm and send**, **`e` = edit a field**, **`x` = cancel**.
3. If **edit**, open a submenu so the guest can change **Guest Name**, **Passport Number**, **Card Number**, **Card Expiry**, or **Cardholder Name** individually; then re-display the review screen.
4. If **confirm**, call `validate_check_in_data(check_in_data)` – if invalid, show errors and stay on the review screen so the guest can fix fields via the edit option.
5. If validation passes, call `confirm_data(check_in_data)` – “Confirm and send? (yes/no)”. If no, cancel and return.
6. Ask: (1) Mock send, (2) Real send to Supabase.
7. Call `send_data` or `send_data_mock`; print success or error, then “Press Enter to finish.”

---

## 10. Camera and image constants (scanner)

- **Resolution:** CAMERA_WIDTH=1920, CAMERA_HEIGHT=1080.
- **Camera index:** From .env CAMERA_INDEX (default 0). Windows: CAP_DSHOW for USB cameras; fallback indices 0, 1, 2.
- **Card alignment:** RECT_W=560, RECT_H=400 (green box for card).
- **Passport alignment:** PASSPORT_RECT_W=1040, PASSPORT_RECT_H=640 (green box for passport).
- **MRZ default zone:** Bottom 28% of passport (y from 0.72 to 1.0), full width.

---

## 11. Debug images (cleaned each run)

When `DEBUG_ACTIVATE=true`, debug images are saved under `debug/variants/` and are cleared at startup by `_clear_roi_debug_images()`. They are grouped by document type:

- **Passport (`debug/variants/passport/`):**
  - `deskew_debug_passport_frame_*.png`, `deskew_tilt_passport_frame_*.png`, `deskew_debug_zone_passport.png` – show the alignment crop with detection boxes, tilt angle text, and horizontal lines for the bottom 45%/35%/25%/15% zones used to reason about the MRZ band.
  - `detection_boxes_passport_frame_*.png` – alignment crop with all EasyOCR detection boxes drawn, useful even when `DESKEW_ENABLE=false`.
  - `crop_debug_region_frame_*.png` – the MRZ bottom-strip crop used by the MRZ detection pass.
  - `f1_v1_orig.png` … `f1_v6_*.png` – the six variants for the first MRZ ROI, showing how v1–v6 look (original, sharpened, clean-sharp, grayscale, CLAHE, thresholded).

- **Card (`debug/variants/card/`):**
  - `deskewed_frame_*.png` – deskewed card alignment crop (or raw if `DESKEW_ENABLE=false`).
  - `name_roi_debug.png`, `name_roi_debug_frame_*.png` – card name ROI with overlays for the name band.
  - `detection_boxes_card_frame_*.png` – CLAHE/detection view for card frames with EasyOCR boxes.

Older root-level debug PNGs (`passport_mrz_debug*.png`, `ocr_roi_frame_*.png`, etc.) are now cleaned up and superseded by the organized `debug/variants/` layout.

---

## 12. Summary table for “what runs when”

| When | Main steps |
|------|------------|
| App start | Load .env, setup logging, clear debug images, detect hardware, create CheckInData, run_check_in_flow. |
| Passport step | Capture 2 frames (burst, top-2 sharpest) → verify → per frame: crop (800×500), deskew, find MRZ (bands or fixed zone), multi-variant OCR, normalize to 2×44 chars, parse TD3 → consensus on passport_id and guest_name → save image (always), store in CheckInData. |
| Confirm passport | Show name + passport number; y/e/c; if edit, open submenu to change either guest name or passport number, then validate and re-show. |
| After confirm | GET guest by passport_id (Supabase); show stay details; on failure use mock. |
| Card step | Options: (1) camera OCR (2-shot capture + deskew + zones + multi-OCR + Luhn/expiry/name) → consensus; (2) manual entry with validation; (3) NFC tap to link `nfc_uid` to booking, then manual card entry. |
| Review | Show all data, allow per-field edits from the review screen, validate CheckInData, confirm send, choose mock vs real POST to Supabase (guests table with `first_name`, `last_name`, `guest_name`, `passport_id`, `card_details`, optional `passport_path` and `nfc_uid`). |

You can use this document to ask Gemini (or anyone) about any specific step, function, or data flow (e.g. “How is the MRZ zone found?”, “When is the passport image saved?”, “What is sent to Supabase?”).
