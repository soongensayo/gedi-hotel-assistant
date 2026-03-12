"""Serial listener for ESP32 NFC UIDs (no Supabase dependency).

When a card is tapped, the ESP32 sends raw hex UID over serial; this module
listens for it and passes each UID to a callback. Linking to the server
is done by the caller (e.g. via network.transmitter.link_nfc_uid_to_guest).
"""

import logging
import os
from typing import Callable, Optional

logger = logging.getLogger(__name__)


def normalize_uid(raw: str) -> str:
    """Normalize NFC UID from any line that contains hex digits.

    Removes all non-hex characters, uppercases, and validates the result.
    This lets us handle lines like "Card UID: 25 3F 9A 10" as well as plain "253F9A10".
    """
    # Keep only hexadecimal characters
    cleaned = "".join(ch for ch in (raw or "").upper() if ch in "0123456789ABCDEF")
    if not cleaned:
        return ""
    try:
        int(cleaned, 16)
        return cleaned
    except ValueError:
        return ""


def run_serial_listener(
    port: str,
    baud: int = 115200,
    on_uid: Optional[Callable[[str], None]] = None,
    stop_event: Optional[object] = None,
) -> None:
    """Continuously listen for ESP32 NFC UIDs on a serial port.

    Expects the ESP32 to send lines of raw hex UID (e.g. "A1B2C3D4" or "A1 B2 C3 D4").
    Each valid UID line is normalized and passed to on_uid(nfc_uid: str).

    Args:
        port: Serial port (e.g. "COM3" on Windows, "/dev/ttyUSB0" on Linux).
        baud: Baud rate (default 115200).
        on_uid: Callback(nfc_uid: str) for each received UID; if None, only logs.
        stop_event: Optional threading.Event(); when set(), listener exits.
    """
    try:
        import serial
    except ImportError:
        logger.error("pyserial not installed. pip install pyserial")
        return

    try:
        ser = serial.Serial(port=port, baudrate=baud, timeout=0.1)
    except Exception as e:
        logger.error("Failed to open serial port %s: %s", port, e)
        return

    def _dispatch(uid: str) -> None:
        if on_uid:
            try:
                on_uid(uid)
            except Exception as e:
                logger.exception("on_uid callback error: %s", e)
        else:
            logger.info("NFC UID received: %s", uid)

    logger.info("Serial listener started on %s @ %s (Ctrl+C to stop)", port, baud)
    try:
        while True:
            if stop_event is not None and getattr(stop_event, "is_set", lambda: False)():
                break
            line = ser.readline()
            if not line:
                continue
            try:
                decoded = line.decode("utf-8", errors="ignore").strip()
            except Exception:
                decoded = ""
            logger.info("Serial raw line: %r", decoded)
            if not decoded:
                continue
            uid = normalize_uid(decoded)
            if uid:
                logger.info("Normalized NFC UID: %s", uid)
                _dispatch(uid)
    except KeyboardInterrupt:
        logger.info("Serial listener stopped by user")
    finally:
        try:
            ser.close()
        except Exception:
            pass


if __name__ == "__main__":
    import sys
    port = os.getenv("NFC_SERIAL_PORT", "COM3" if os.name == "nt" else "/dev/ttyUSB0")
    if len(sys.argv) > 1:
        port = sys.argv[1]

    def on_uid(uid: str) -> None:
        print(f"NFC UID: {uid}")

    run_serial_listener(port, on_uid=on_uid)
