#!/usr/bin/env python3
"""Persistent EasyOCR passport worker.

Keeps the EasyOCR reader warm in one long-lived Python process so the backend
does not pay model initialization time on every guest scan.
"""

import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

project_root = Path(__file__).resolve().parent.parent.parent
scanner_root = project_root / "camera-and-nfc" / "Identification-and-payment-app"

if str(scanner_root) not in sys.path:
    sys.path.insert(0, str(scanner_root))

env_path = scanner_root / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path)
    except ImportError:
        pass

_camera = None  # type: Optional[object]
_shutdown = False
_scanner_api: Optional[Dict[str, Any]] = None
_warmed = False

CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CAMERA_WIDTH = int(os.getenv("CAMERA_WIDTH", "1920"))
CAMERA_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "1080"))
SHARPNESS_THRESHOLD = float(os.getenv("SHARPNESS_THRESHOLD", "15"))
CAMERA_BRIGHTNESS = int(os.getenv("CAMERA_BRIGHTNESS", "0"))
CAMERA_GAIN = int(os.getenv("CAMERA_GAIN", "0"))
CAMERA_EXPOSURE = int(os.getenv("CAMERA_EXPOSURE", "0"))


def _emit(event: str, **payload: Any) -> None:
    message = {"event": event, **payload}
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def _load_scanner_api() -> Dict[str, Any]:
    global _scanner_api
    if _scanner_api is None:
        from core.scanner import (
            _capture_fresh_frame,
            _esp32_flash_off,
            _esp32_guide_off,
            _esp32_guide_on,
            _esp32_passport_flash_enabled,
            _esp32_prepare_passport_flash,
            _get_easyocr_reader,
            _passport_image_to_base64,
            _sharpness_score,
            reset_deskew_angle_cache,
            scan_passport_from_frame,
        )

        _scanner_api = {
            "_capture_fresh_frame": _capture_fresh_frame,
            "_esp32_flash_off": _esp32_flash_off,
            "_esp32_guide_off": _esp32_guide_off,
            "_esp32_guide_on": _esp32_guide_on,
            "_esp32_passport_flash_enabled": _esp32_passport_flash_enabled,
            "_esp32_prepare_passport_flash": _esp32_prepare_passport_flash,
            "_get_easyocr_reader": _get_easyocr_reader,
            "_passport_image_to_base64": _passport_image_to_base64,
            "_sharpness_score": _sharpness_score,
            "reset_deskew_angle_cache": reset_deskew_angle_cache,
            "scan_passport_from_frame": scan_passport_from_frame,
        }
    return _scanner_api


def _open_camera():
    global _camera
    import cv2

    api = getattr(cv2, "CAP_DSHOW", None) if sys.platform == "win32" else None
    indices_to_try = [CAMERA_INDEX] if CAMERA_INDEX == 0 else [CAMERA_INDEX, 0]
    for idx in indices_to_try:
        try:
            cap = cv2.VideoCapture(idx, api) if api is not None else cv2.VideoCapture(idx, cv2.CAP_V4L2)
            if not cap.isOpened():
                cap.release()
                cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
                if CAMERA_BRIGHTNESS > 0:
                    cap.set(cv2.CAP_PROP_BRIGHTNESS, CAMERA_BRIGHTNESS)
                if CAMERA_GAIN > 0:
                    cap.set(cv2.CAP_PROP_GAIN, CAMERA_GAIN)
                if CAMERA_EXPOSURE != 0:
                    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)
                    cap.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
                for _ in range(5):
                    cap.read()
                _camera = cap
                return cap
            cap.release()
        except Exception:
            pass
    return None


def _close_camera() -> None:
    global _camera
    if _camera is not None:
        try:
            _camera.release()
        except Exception:
            pass
        _camera = None


def _handle_shutdown(_signum, _frame) -> None:
    global _shutdown
    _shutdown = True
    _close_camera()


def _warmup() -> bool:
    global _warmed
    if _warmed:
        _emit("warmup_ready", success=True, warmup_seconds=0.0, cached=True)
        return True

    warmup_start = time.time()
    try:
        api = _load_scanner_api()
        reader = api["_get_easyocr_reader"]()
    except Exception as e:
        _emit("warmup_failed", success=False, error=str(e))
        return False

    warmup_elapsed = time.time() - warmup_start
    if reader is None:
        _emit("warmup_failed", success=False, error="EasyOCR unavailable")
        return False

    _warmed = True
    _emit("warmup_ready", success=True, warmup_seconds=round(warmup_elapsed, 2), cached=False)
    return True


def _run_scan(timeout: float) -> None:
    global _shutdown
    _shutdown = False

    if not _warmup():
        _emit("scan_result", success=False, error="EasyOCR warmup failed")
        return

    api = _load_scanner_api()
    cap = _open_camera()
    if cap is None:
        _emit("scan_result", success=False, error="Could not open camera")
        return

    api["reset_deskew_angle_cache"]("passport")
    start_time = time.time()
    attempt = 0
    skipped = 0
    no_mrz_count = 0
    flash_enabled = bool(api["_esp32_passport_flash_enabled"]())

    if flash_enabled:
        api["_esp32_guide_on"]()

    try:
        while not _shutdown:
            elapsed = time.time() - start_time
            if elapsed > timeout:
                _emit(
                    "scan_result",
                    success=False,
                    error=f"Timeout: no passport detected (attempts={attempt}, skipped_blurry={skipped})",
                )
                return

            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.2)
                continue

            sharpness = api["_sharpness_score"](frame, use_center_region=True)
            if sharpness < SHARPNESS_THRESHOLD:
                skipped += 1
                time.sleep(0.1)
                continue

            frame_to_process = frame
            if flash_enabled:
                api["_esp32_prepare_passport_flash"]()
                flashed_frame = api["_capture_fresh_frame"](cap, discard_frames=3, interval_ms=30)
                if flashed_frame is not None:
                    frame_to_process = flashed_frame

            try:
                result = api["scan_passport_from_frame"](
                    frame_to_process,
                    frame_index=attempt + 1,
                    require_detection=True,
                )
            except Exception as e:
                if flash_enabled:
                    api["_esp32_flash_off"]()
                    api["_esp32_guide_on"]()
                attempt += 1
                _emit("scan_progress", attempt=attempt, elapsed=round(elapsed, 1), error=str(e))
                time.sleep(0.5)
                continue

            if result is None:
                if flash_enabled:
                    api["_esp32_flash_off"]()
                    api["_esp32_guide_on"]()
                no_mrz_count += 1
                if no_mrz_count % 5 == 1:
                    _emit("scan_waiting", elapsed=round(elapsed, 1), no_mrz_frames=no_mrz_count)
                time.sleep(0.1)
                continue

            attempt += 1
            no_mrz_count = 0
            _emit("scan_progress", attempt=attempt, elapsed=round(elapsed, 1), sharpness=round(sharpness, 1))

            if result.get("passport_id") or result.get("guest_name"):
                deskewed = result.get("deskewed_image")
                passport_image_base64 = ""
                if deskewed is not None:
                    passport_image_base64 = api["_passport_image_to_base64"](deskewed)

                _emit(
                    "scan_result",
                    success=True,
                    data={
                        "passport_id": result.get("passport_id") or "",
                        "guest_name": result.get("guest_name") or "",
                        "passport_image_base64": passport_image_base64,
                    },
                )
                return

        _emit("scan_result", success=False, error="Cancelled")
    finally:
        if flash_enabled:
            api["_esp32_flash_off"]()
            api["_esp32_guide_off"]()
        _close_camera()


def _guide_on() -> None:
    api = _load_scanner_api()
    if bool(api["_esp32_passport_flash_enabled"]()):
        api["_esp32_guide_on"]()
    _emit("guide_result", success=True, state="on")


def _guide_off() -> None:
    api = _load_scanner_api()
    if bool(api["_esp32_passport_flash_enabled"]()):
        api["_esp32_guide_off"]()
        api["_esp32_flash_off"]()
    _emit("guide_result", success=True, state="off")


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            _emit("scan_result", success=False, error="Invalid worker command")
            continue

        action = str(command.get("command") or "").strip().lower()
        if action == "warmup":
            _warmup()
        elif action == "guide_on":
            _guide_on()
        elif action == "guide_off":
            _guide_off()
        elif action == "scan":
            try:
                timeout = float(command.get("timeout", 120.0))
            except (TypeError, ValueError):
                timeout = 120.0
            _run_scan(timeout)
        else:
            _emit("scan_result", success=False, error=f"Unknown worker command: {action}")

        if _shutdown:
            break

    _close_camera()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
