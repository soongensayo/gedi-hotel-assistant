"""Run the full scan pipeline using a JPG/PNG as if it were the camera.

Option A (default): test.jpg runs only the passport pipeline; test_credit.png runs only the card pipeline.
Option 3: Passport uses 1060×660 frames (crop 1040×640); card uses 580×420 frames (crop 560×400) so the card is not zoomed/cropped.
Single image via CLI: runs both pipelines, each with the correct frame size for that pipeline.

Usage:
  python run_test_image.py
    (default: test.jpg → passport only; test_credit.png → card only)
  python run_test_image.py [path_to_image.jpg]
    (runs both passport and card pipelines on that image, with correct frame sizes)

Output:
  - Passport and card results printed to console.
  - Debug images: debug/variants/passport/ and debug/variants/card/ (each pipeline writes only to its folder).
  - Six variants per detected ROI in each subdir: f*_v1_orig.png ... f*_v6_thresh.png
"""

import sys
from pathlib import Path

import numpy as np

# Project root for imports
_PROJECT_ROOT = Path(__file__).resolve().parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import cv2
from core.scanner import (
    scan_passport_from_frames,
    scan_card_from_frames,
)

# Default test images: passport and credit card (each runs only its own pipeline — Option A)
TEST_IMAGES = [
    (_PROJECT_ROOT / "test_images" / "test.jpg", "Passport"),
    (_PROJECT_ROOT / "test_images" / "test_credit.png", "Credit card"),
]
DEFAULT_IMAGE = TEST_IMAGES[0][0]  # backward compat when single path is used
NUM_FRAMES = 2  # Same as camera: top-2 frames
FRAME_MARGIN = 20  # scanner uses min(rect, width-20); we want crop = rect size

# Option 3: two frame sizes so each pipeline gets correctly sized input (no zoomed/cropped card).
PASSPORT_CROP_SIZE = (1040, 640)
PASSPORT_FRAME_SIZE = (PASSPORT_CROP_SIZE[0] + FRAME_MARGIN, PASSPORT_CROP_SIZE[1] + FRAME_MARGIN)  # 1060×660
CARD_CROP_SIZE = (560, 400)
CARD_FRAME_SIZE = (CARD_CROP_SIZE[0] + FRAME_MARGIN, CARD_CROP_SIZE[1] + FRAME_MARGIN)  # 580×420


def load_image(path: Path):
    """Load image as BGR; support paths with non-ASCII characters on Windows."""
    path = Path(path).resolve()
    if not path.exists():
        return None, f"File not found: {path}"
    # cv2.imread can fail on Windows with non-ASCII paths; use imdecode if needed
    try:
        img = cv2.imread(str(path))
    except Exception:
        img = None
    if img is None:
        try:
            buf = path.read_bytes()
            arr = np.frombuffer(buf, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception as e:
            return None, str(e)
    if img is None or img.size == 0:
        return None, "Could not decode image (is it a valid JPG/PNG?)."
    return img, None


def shrink_to_fit(img, size: tuple):
    """Resize image to size (width, height). Shrink only; uses INTER_AREA for quality."""
    w, h = size
    h_src, w_src = img.shape[:2]
    if (w_src, h_src) == (w, h):
        return img
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)


def run_pipeline_for_image(path: Path, label: str):
    """Load image, build frames at the right size for each pipeline, run the relevant pipeline(s).
    Option A: Passport image → passport only; Credit card image → card only.
    Option 3: Passport uses 1060×660 frames; card uses 580×420 frames.
    Custom: runs both pipelines, each with its own frame size.
    """
    print("Loading image:", path)
    img, err = load_image(path)
    if err:
        print("Error:", err)
        return False

    if label == "Passport":
        img_p = shrink_to_fit(img, PASSPORT_FRAME_SIZE)
        print(f"Resized to {PASSPORT_FRAME_SIZE[0]}x{PASSPORT_FRAME_SIZE[1]} px (passport crop {PASSPORT_CROP_SIZE[0]}x{PASSPORT_CROP_SIZE[1]}).")
        frames = [img_p.copy() for _ in range(NUM_FRAMES)]
        print(f"Using {NUM_FRAMES} frame(s) for passport pipeline.\n")
        print("--- Passport pipeline ---")
        passport_data = scan_passport_from_frames(frames)
        if passport_data:
            print("Passport ID:", passport_data.get("passport_id"))
            print("Guest name:", passport_data.get("guest_name"))
        else:
            print("Passport: no result (image may not contain a passport MRZ or crop failed).")
        return True

    if label == "Credit card":
        img_c = shrink_to_fit(img, CARD_FRAME_SIZE)
        print(f"Resized to {CARD_FRAME_SIZE[0]}x{CARD_FRAME_SIZE[1]} px (card crop {CARD_CROP_SIZE[0]}x{CARD_CROP_SIZE[1]}).")
        frames = [img_c.copy() for _ in range(NUM_FRAMES)]
        print(f"Using {NUM_FRAMES} frame(s) for card pipeline.\n")
        print("--- Card pipeline ---")
        card_data = scan_card_from_frames(frames)
        if card_data:
            print("Card number:", card_data.get("card_no"))
            print("Expiry:", card_data.get("expiry"))
            print("Cardholder:", card_data.get("cardholder_name"))
        else:
            print("Card: no result (image may not contain a card or detection failed).")
        return True

    # Custom: run both pipelines with correct frame size for each
    img_p = shrink_to_fit(img, PASSPORT_FRAME_SIZE)
    img_c = shrink_to_fit(img, CARD_FRAME_SIZE)
    passport_frames = [img_p.copy() for _ in range(NUM_FRAMES)]
    card_frames = [img_c.copy() for _ in range(NUM_FRAMES)]
    print(f"Passport frames: {PASSPORT_FRAME_SIZE[0]}x{PASSPORT_FRAME_SIZE[1]} (crop {PASSPORT_CROP_SIZE[0]}x{PASSPORT_CROP_SIZE[1]}).")
    print(f"Card frames: {CARD_FRAME_SIZE[0]}x{CARD_FRAME_SIZE[1]} (crop {CARD_CROP_SIZE[0]}x{CARD_CROP_SIZE[1]}).")
    print(f"Using {NUM_FRAMES} frame(s) per pipeline.\n")
    print("--- Passport pipeline ---")
    passport_data = scan_passport_from_frames(passport_frames)
    if passport_data:
        print("Passport ID:", passport_data.get("passport_id"))
        print("Guest name:", passport_data.get("guest_name"))
    else:
        print("Passport: no result (image may not contain a passport MRZ or crop failed).")
    print("\n--- Card pipeline ---")
    card_data = scan_card_from_frames(card_frames)
    if card_data:
        print("Card number:", card_data.get("card_no"))
        print("Expiry:", card_data.get("expiry"))
        print("Cardholder:", card_data.get("cardholder_name"))
    else:
        print("Card: no result (image may not contain a card or detection failed).")
    return True


def main():
    if len(sys.argv) > 1:
        # Single image from CLI
        paths_to_run = [(Path(sys.argv[1]).resolve(), "Custom")]
    else:
        # Default: run both passport and credit card test images
        paths_to_run = TEST_IMAGES

    ran_any = False
    for i, (path, label) in enumerate(paths_to_run):
        if i > 0:
            print("\n" + "=" * 60)
        print(f"[{label}] {path.name}")
        if run_pipeline_for_image(path, label):
            ran_any = True

    if not ran_any:
        print("No image could be loaded.")
        if not paths_to_run or paths_to_run == TEST_IMAGES:
            print("Ensure test_images/test.jpg and test_images/test_credit.png exist, or run: python run_test_image.py <your_image.jpg>")
        sys.exit(1)

    print("\nDebug outputs: debug/variants/passport/ and debug/variants/card/ (6 variants each at crop size).")


if __name__ == "__main__":
    main()
