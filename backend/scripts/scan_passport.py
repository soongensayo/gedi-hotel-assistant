#!/usr/bin/env python3
"""Bridge script: runs the passport OCR pipeline and outputs JSON to stdout.

Called by the Node.js backend as a child process.
Usage:
  python3 scan_passport.py              # capture from camera
  python3 scan_passport.py <image_path> # process a static image (for testing)

Output (stdout): JSON with keys passport_id, guest_name, passport_image_base64
Exit code: 0 = success, 1 = failure
"""

import json
import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
scanner_root = project_root / "camera-and-nfc" / "Identification-and-payment-app"

if str(scanner_root) not in sys.path:
    sys.path.insert(0, str(scanner_root))

env_path = scanner_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

def scan_from_camera():
    from core.scanner import scan_passport
    return scan_passport()

def scan_from_image(image_path: str):
    import cv2
    import numpy as np
    from core.scanner import scan_passport_from_frames

    path = Path(image_path).resolve()
    if not path.exists():
        return None

    img = cv2.imread(str(path))
    if img is None:
        buf = path.read_bytes()
        arr = np.frombuffer(buf, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    passport_w, passport_h = 1040, 640
    margin = 20
    frame_w, frame_h = passport_w + margin, passport_h + margin
    h_src, w_src = img.shape[:2]
    if (w_src, h_src) != (frame_w, frame_h):
        img = cv2.resize(img, (frame_w, frame_h), interpolation=cv2.INTER_AREA)

    frames = [img.copy() for _ in range(2)]
    return scan_passport_from_frames(frames)

def main():
    image_path = sys.argv[1] if len(sys.argv) > 1 else None

    try:
        if image_path:
            result = scan_from_image(image_path)
        else:
            result = scan_from_camera()
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)

    if not result:
        print(json.dumps({"error": "No passport detected"}), file=sys.stdout)
        sys.exit(1)

    output = {
        "passport_id": result.get("passport_id") or "",
        "guest_name": result.get("guest_name") or "",
        "passport_image_base64": result.get("passport_image_base64") or "",
    }
    print(json.dumps(output), file=sys.stdout)
    sys.exit(0)

if __name__ == "__main__":
    main()
