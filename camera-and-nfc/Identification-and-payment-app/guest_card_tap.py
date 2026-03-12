"""Standalone program: look up guest by passport ID, then collect credit card tap and send UID to server.

Usage:
  python guest_card_tap.py                    # prompts for passport ID
  python guest_card_tap.py <passport_id>     # use passport ID from command line

Flow:
  1. Retrieve guest from server by passport_id and display who they are.
  2. Ask guest to tap their credit card on the NFC reader.
  3. On tap, send the card UID to the server (links nfc_uid to the guest record).

Requires: .env with SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY,
          and optionally NFC_SERIAL_PORT (default COM3 on Windows, /dev/ttyUSB0 on Linux).
"""

from pathlib import Path
from dotenv import load_dotenv

# Load .env from the same folder as this script (Payment and Identity System)
_env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(_env_path)

import logging
import os
import sys
import threading

from network.transmitter import fetch_guest_by_passport_id, link_nfc_uid_to_guest
from network.nfc_serial import run_serial_listener

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def _display_guest(guest: dict) -> None:
    """Print guest details to the console."""
    first = (guest.get("first_name") or "").strip()
    last = (guest.get("last_name") or "").strip()
    guest_name = (guest.get("guest_name") or "").strip()
    if not guest_name and (first or last):
        guest_name = f"{first} {last}".strip()
    passport_id = (guest.get("passport_id") or "").strip()
    room = guest.get("room_number") or "-"
    check_in = guest.get("check_in_date") or "-"
    check_out = guest.get("check_out_date") or "-"

    print("\n" + "=" * 50)
    print("GUEST FOUND")
    print("=" * 50)
    print(f"  Guest Name   : {guest_name or '-'}")
    print(f"  Passport No. : {passport_id or '-'}")
    print(f"  Room         : {room}")
    print(f"  Check-in     : {check_in}")
    print(f"  Check-out    : {check_out}")
    print("=" * 50)


def main() -> None:
    # Get passport ID from command line or prompt
    passport_id = ""
    if len(sys.argv) > 1:
        passport_id = sys.argv[1].strip()
    if not passport_id:
        passport_id = input("Enter passport ID: ").strip()
    if not passport_id:
        print("Passport ID is required.")
        sys.exit(1)

    # Retrieve guest from server
    print(f"\nLooking up guest for passport ID: {passport_id}")
    guest, error = fetch_guest_by_passport_id(passport_id)
    if error or not guest:
        print(f"Cannot retrieve guest: {error or 'Guest not found'}")
        sys.exit(2)

    _display_guest(guest)

    # Ask for credit card tap
    print("\nPlease tap your credit card on the reader.")
    print("Waiting for card tap...\n")

    done = threading.Event()
    success = [False]  # list so callback can mutate

    def on_uid(nfc_uid: str) -> None:
        ok, err = link_nfc_uid_to_guest(passport_id, nfc_uid)
        if ok:
            print(f"\nCard UID {nfc_uid} linked to guest successfully.")
            success[0] = True
            done.set()
        else:
            print(f"\nFailed to send card UID to server: {err}")
            print("You can tap again to retry.")

    port = os.getenv("NFC_SERIAL_PORT", "COM3" if os.name == "nt" else "/dev/ttyUSB0")
    if len(sys.argv) > 2:
        port = sys.argv[2]

    # Run listener in background thread; main thread waits for first successful link or Ctrl+C
    listener_thread = threading.Thread(
        target=run_serial_listener,
        kwargs={"port": port, "on_uid": on_uid, "stop_event": done},
        daemon=True,
    )
    listener_thread.start()
    try:
        done.wait()
    except KeyboardInterrupt:
        print("\nStopped by user.")
        done.set()
        listener_thread.join(timeout=2.0)
        sys.exit(0)

    listener_thread.join(timeout=2.0)
    sys.exit(0 if success[0] else 3)


if __name__ == "__main__":
    main()
