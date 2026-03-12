"""NFC UID detection and linking to Supabase.

When a card is tapped, the ESP32 sends the raw hex UID over serial; this module
listens for it and can link the UID to a guest record (by passport_id) in Supabase.

Supabase table `guests` is assumed to have (or be extended with):
  - passport_id (text)
  - nfc_uid (text, nullable) – card UID in hex, e.g. "A1B2C3D4"
"""

import logging
import os
from typing import Callable, Optional, Tuple

from supabase import create_client, Client

logger = logging.getLogger(__name__)


def _get_supabase_client() -> Optional[Client]:
    """Build Supabase client from env. Returns None if not configured."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (
        (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        or (os.getenv("SUPABASE_ANON_KEY") or "").strip()
    )
    if not url or not key:
        return None
    return create_client(url, key)


def link_card_to_passport(passport_id: str, nfc_uid: str) -> Tuple[bool, Optional[str]]:
    """Link an NFC card UID to a guest record by passport_id.

    Updates the `guests` table: sets nfc_uid for the row with the given passport_id.

    Args:
        passport_id: Guest passport ID (must exist in guests).
        nfc_uid: Raw hex UID from ESP32 (e.g. "A1B2C3D4"). Will be normalized to uppercase.

    Returns:
        (True, None) on success, or (False, error_message) on failure.
    """
    pid = (passport_id or "").strip()
    uid = _normalize_uid(nfc_uid)
    if not pid:
        return False, "passport_id is empty"
    if not uid:
        return False, "nfc_uid is empty or invalid hex"

    client = _get_supabase_client()
    if not client:
        return False, "SUPABASE_URL and keys not configured in .env"

    try:
        r = (
            client.table("guests")
            .update({"nfc_uid": uid})
            .eq("passport_id", pid)
            .execute()
        )
        if not r.data or len(r.data) == 0:
            return False, "No guest found with that passport_id"
        logger.info("Linked nfc_uid %s to passport_id %s", uid, pid)
        return True, None
    except Exception as e:
        logger.exception("link_card_to_passport failed")
        return False, str(e)


def _normalize_uid(raw: str) -> str:
    """Normalize NFC UID: strip, remove spaces, uppercase hex."""
    s = (raw or "").strip().replace(" ", "").replace("-", "").upper()
    if not s:
        return ""
    try:
        int(s, 16)
        return s
    except ValueError:
        return ""


# --- Serial listener for ESP32 raw hex UIDs ---

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
        stop_event: Optional threading.Event(); when set(), listener exits. If None, runs until KeyboardInterrupt.
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
            if not decoded:
                continue
            uid = _normalize_uid(decoded)
            if uid:
                _dispatch(uid)
    except KeyboardInterrupt:
        logger.info("Serial listener stopped by user")
    finally:
        try:
            ser.close()
        except Exception:
            pass


if __name__ == "__main__":
    # Example: run serial listener and print each UID (customize port and callback as needed)
    from dotenv import load_dotenv
    load_dotenv()

    import sys
    port = os.getenv("NFC_SERIAL_PORT", "COM3" if os.name == "nt" else "/dev/ttyUSB0")
    if len(sys.argv) > 1:
        port = sys.argv[1]

    def on_uid(uid: str) -> None:
        print(f"NFC UID: {uid}")

    run_serial_listener(port, on_uid=on_uid)
