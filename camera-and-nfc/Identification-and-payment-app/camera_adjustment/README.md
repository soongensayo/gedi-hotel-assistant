# Camera Threshold & Gamma Adjustment Tool

This helper lives under:

- `camera-and-nfc/Identification-and-payment-app/camera_adjustment/`

It does **not** change any scanner code or `.env` values. It is only a tuning aid so you can see the effect of different gamma / CLAHE / threshold / brightness settings on a real camera frame, then manually copy the chosen values into your configuration.

---

## 1. What the scripts do

**`adjust_thresholds.py`** — alignment crop **in `.env.example` order**, then the **detection master** preview:

- Sliders **01–06**: `SCAN_GAMMA` → brightness → contrast → saturation → denoise → `SCAN_PRE_SHARPNESS` (same chain as passport alignment crop before deskew).
- **07** `SCAN_CLAHE_MASTER_CLIP` — applied to grayscale for the **right pane** (EasyOCR master style).
- **08** `SHARPNESS_THRESHOLD` — blur-reject gate for the poll script (displayed in snippet only; does not change the image).
- **q** quits and prints a **copy-paste `.env` block**.

**`adjust_variants.py`** — same **01–06** alignment on the ROI, then **07–10** variant OCR: `SCAN_CLAHE_CLIP`, `SCAN_VARIANT_SHARPNESS`, `SCAN_VARIANT_SECOND_SHARPNESS`, `OCR_USE_V3_BASE`. Shows the **v1–v6** grid. **q** prints alignment + variant lines for `.env`.

Shared trackbar labels / env mapping: `camera_adjustment/_tuner_trackbars.py`.

---

## 2. How to run it

From the project root of the camera app:

```bash
cd camera-and-nfc/Identification-and-payment-app
python camera_adjustment/adjust_thresholds.py
```

You should see a window named like:

> `Thresholds: L=crop R=master CLAHE`

With:

- A still frame from the camera, cropped to the passport region.
- The processed version on the right side.

Keys:

- **`c`** – capture a fresh frame from the camera.
- **`q`** – quit and print a `.env` snippet to the terminal.

---

## 3. Sliders and how they map to configuration

Trackbar names are prefixed **`01_`…`08_`** (thresholds) or **`01_`…`10_`** (variants) to match **`.env.example`** top-to-bottom.

**Alignment (both tools):**

| Trackbar     | Env variable              | Notes |
|-------------|---------------------------|--------|
| `01_GAMMA x100` | `SCAN_GAMMA`          | 50–200 → γ = pos/100 |
| `02_BRIGHT 128` | `SCAN_BRIGHTNESS`     | 0–255, 128 = neutral |
| `03_CONTRAST`   | `SCAN_CONTRAST`       | 50–200, 100 = ×1.0 |
| `04_SAT x100`   | `SCAN_PRE_SATURATION` | 0–200, 100 = unchanged |
| `05_DENOISE`    | `SCAN_PRE_DENOISE`    | 0–50 bilateral |
| `06_PRE_SHARP`  | `SCAN_PRE_SHARPNESS`  | 0–100, pre-deskew unsharp |

**`adjust_thresholds.py` only:**

| `07_MST_CLAHE` | `SCAN_CLAHE_MASTER_CLIP` | 50–300 → clip = pos/100 |
| `08_SHRP_THR`  | `SHARPNESS_THRESHOLD`    | 1–300 (poll script) |

**`adjust_variants.py` only (after 06):**

| `07_VAR_CLAHE` | `SCAN_CLAHE_CLIP` | 50–300 → clip = pos/100 |
| `08_VAR_SHARP` | `SCAN_VARIANT_SHARPNESS` | 0–125 |
| `09_VAR_2SHRP` | `SCAN_VARIANT_SECOND_SHARPNESS` | 0–125 |
| `10_V3_BASE`   | `OCR_USE_V3_BASE` | 0 or 1 |

Live values are printed on one status line while you drag sliders; use **`q`** for a full paste block.

### Contrast & saturation (both tuner scripts)

- **03_CONTRAST** / **04_SAT** — same semantics as production **`core/scanner.py`**.

**`.env` keys (brightness / contrast)** — use any one name per setting; the scanner checks in this order:

| Setting    | Try first → last |
|------------|------------------|
| Brightness | `SCAN_GLOBAL_BRIGHTNESS`, `SCAN_BRIGHTNESS`, `ADJUST_BRIGHTNESS` |
| Contrast   | `SCAN_GLOBAL_CONTRAST`, `SCAN_CONTRAST`, `ADJUST_CONTRAST` |

Example in `Identification-and-payment-app/.env`:

```env
SCAN_BRIGHTNESS=128
SCAN_CONTRAST=110
```

Restart the app after changing these (values are read when `core/scanner` is imported).

**Denoise / pre-sharp / variant sharp** — see table above (`05_DENOISE`, `06_PRE_SHARP`, `08_VAR_SHARP`, `09_VAR_2SHRP`). Variant unsharp matches `core/scanner._sharpen_for_ocr` / `_unsharp_median_for_ocr`. Shared helpers: `camera_adjustment/_tuner_preproc.py`.

Prefer **q** in the tuner window to print a full block instead of copying from the one-line status.

---

## 4. How this relates to the main scanner pipeline

This tool mirrors the key post-processing knobs from `core/scanner.py`:

- **`_gamma_correct(image, gamma)`**
  - Implemented in `core/scanner.py`:
    - `gamma < 1.0` brightens dark frames.
    - `gamma = 1.0` leaves the image unchanged.
    - `gamma > 1.0` darkens.
  - Used on the **passport/card alignment crop** before card deskew / passport MRZ detection (passport has no full-page deskew).
  - Controlled by `SCAN_GAMMA` from `.env` (set to 1.0 to effectively turn it off).

- **CLAHE (`_apply_clahe_bgr`, `_build_clahe_master`)**
  - Used to improve text contrast for:
    - Card full-crop deskew; passport MRZ line hunt; MRZ strip deskew; card zone detection.
  - Clip limits are controlled by env variables such as:
    - `SCAN_CLAHE_MASTER_CLIP`
    - `SCAN_CLAHE_CLIP`
  - Grid size is fixed to 8×8 in code.

- **Sharpening and 5-variant OCR builder**
  - `_sharpen_for_ocr` and `_build_six_variants` (name kept) output **five** images for OCR:
    - v1: original,
    - one sharp: v2- or v3-style (`OCR_USE_V3_BASE`),
    - v4: grayscale of that sharp base,
    - v5: **LAB** colorspace, CLAHE on **L** only, back to BGR — input is gray **promoted to BGR** (neutral A/B),
    - v6: same LAB+L CLAHE on the **color** sharp BGR (no grayscale step).
  - Clip limit for v5/v6 L-channel CLAHE: `SCAN_CLAHE_CLIP`.
  - `OCR_USE_V3_BASE` controls which sharp image feeds v4–v6.
  - Optional **second** unsharp on v2–v6 after the stack is built: `SCAN_VARIANT_SECOND_SHARPNESS` (0–125, default 0 = off); `v1_orig` is left unchanged.
  - The multi-variant strategy itself is not easily “turned off” without code changes.

- **Sharpness and blur rejection**
  - `_sharpness_score` (Laplacian variance) and `SHARPNESS_THRESHOLD` (in `scan_passport_easyocr_poll.py`) decide whether a frame is “sharp enough”.
  - Frames below the threshold are skipped as too blurry.

- **What can be turned off via env**
  - `DESKEW_ENABLE=false` → no rotation; raw crop is used directly.
  - `DEBUG_ACTIVATE=false` → no debug images are written.
  - `SCAN_GAMMA=1.0` → gamma correction is effectively off.
  - `OCR_USE_V3_BASE=false` → derived variants use sharpened v2 instead of blurred+sharpened v3.
  - CLAHE effect can be weakened by setting clip limits close to 1.0.

This adjustment tool lets you _see_ how those knobs affect a real frame so you can pick sensible defaults.

---

## 5. Using an external/physical slider

Right now, the sliders are just OpenCV trackbars. If you later connect a physical slider or knob device, you can:

- Map its movement to setting new positions for these trackbars.
- Or, drive the same values directly in a custom tuning UI, using the same gamma/CLAHE/threshold mapping described above.

No changes to this script are strictly required for that; it simply reads the slider positions and recomputes the processed image.

---

## 6. Workflow summary

1. Place a passport (or test text page) under the camera.
2. Run:
   ```bash
   cd camera-and-nfc/Identification-and-payment-app
   python camera_adjustment/adjust_thresholds.py
   ```
3. Press **`c`** to capture a frame.
4. Move the sliders until the right-hand image makes the MRZ/text:
   - Sharp (edges clear),
   - High-contrast (background darker, text lighter or vice versa),
   - Not overly noisy.
5. Note the printed values for `Gamma`, `Master_CLAHE_clip`, and `Brightness_beta` (or replicate brightness in your pipeline if you add it).
6. Set the corresponding env variables (`SCAN_GAMMA`, `SCAN_CLAHE_MASTER_CLIP`, etc.) in your scanner configuration.

This gives you a practical, visual way to arrive at good preprocessing settings before locking them into the production pipeline.

