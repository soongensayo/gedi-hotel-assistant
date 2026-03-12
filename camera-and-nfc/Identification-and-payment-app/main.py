"""Main entry point for the payment and identity system.

This is the "boss" file - it runs the main menu loop and coordinates
passport registration, card registration, and submit flow.
"""

# Load .env so SUPABASE_URL and SUPABASE_ANON_KEY (etc.) are set once per run
from dotenv import load_dotenv
load_dotenv()

import json
import logging
import os
import sys
import threading
from typing import Optional
from core.data_model import CheckInData  # Our main data container
from core.scanner import (  # Camera + OCR
    detect_hardware,
    scan_passport,
    scan_card,
    capture_passport_image_only,
    _clear_roi_debug_images,
)
from core.validator import (  # Validation rules (Luhn, format checks)
    validate_check_in_data,
    validate_card_number,
    validate_card_expiry,
    validate_card_cvv,
    validate_passport_id,
    validate_guest_name,
)
from network.transmitter import (
    send_data,
    fetch_guest_by_passport_id,
    link_nfc_uid_to_guest,
)  # HTTPS POST, fetch guest, link NFC UID
from network.nfc_serial import run_serial_listener
from network.esp32_wifi import send_start_to_esp32
from network.nfc_uid_server import run_nfc_uid_http_listener
from datetime import datetime

# Configure logging: writes to console AND payment_system.log
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('payment_system.log')
    ]
)

logger = logging.getLogger(__name__)


NFC_UID_TO_LAST4 = {
    # Map known NFC UIDs to fake PAN last-4 digits
    "09C9C802": "5264",
}


def _read_yes_no(prompt: str) -> bool:
    """Ask a yes/no question. Accepts 'y' or 'yes' (case-insensitive). Returns True for yes, False otherwise."""
    response = input(f"{prompt} (yes/no): ").strip().lower()
    return response in ("y", "yes")


def _get_mock_stay_details(guest_name: str, passport_id: str) -> dict:
    """Return mock stay details when server communication fails."""
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "guest_name": guest_name,
        "passport_id": passport_id,
        "room_number": "TBD",
        "check_in_date": today,
        "check_out_date": today,
        "status": "Confirmed (mock – server unavailable)",
    }


def _display_stay_details(stay: dict) -> None:
    """Show the guest their check-in stay details."""
    print("\n" + "=" * 50)
    print("YOUR CHECK-IN DETAILS")
    print("=" * 50)
    first_name = stay.get("first_name") or "-"
    last_name = stay.get("last_name") or "-"
    nationality = stay.get("nationality") or "-"
    passport_number = (
        stay.get("passport_number")
        or stay.get("passport_id")
        or "-"
    )
    print(f"  First Name   : {first_name}")
    print(f"  Last Name    : {last_name}")
    print(f"  Nationality  : {nationality}")
    print(f"  Passport No. : {passport_number}")
    print(f"  Room         : {stay.get('room_number') or '-'}")
    print(f"  Check-in     : {stay.get('check_in_date') or '-'}")
    print(f"  Check-out    : {stay.get('check_out_date') or '-'}")
    print(f"  Status       : {stay.get('status') or 'Confirmed'}")
    print("=" * 50)


def _display_final_summary(check_in_data: CheckInData, stay_details: Optional[dict] = None) -> None:
    """Show the final check-in confirmation with room assignment after successful submission."""
    room = (stay_details or {}).get("room_number") or "TBD"
    check_in_date = (stay_details or {}).get("check_in_date") or "-"
    check_out_date = (stay_details or {}).get("check_out_date") or "-"

    card_no = ""
    if check_in_data.card_details:
        card_no = check_in_data.card_details.get("card_no", "")
    if card_no and len(card_no) > 4:
        masked = "*" * (len(card_no) - 4) + card_no[-4:]
    else:
        masked = card_no or "-"

    print("\n" + "=" * 50)
    print("CHECK-IN COMPLETE")
    print("=" * 50)
    print(f"  Guest Name   : {check_in_data.guest_name or '-'}")
    print(f"  Passport No. : {check_in_data.passport_id or '-'}")
    print(f"  Card         : {masked}")
    print(f"  Room Number  : {room}")
    print(f"  Check-in     : {check_in_date}")
    print(f"  Check-out    : {check_out_date}")
    print("=" * 50)
    print("Thank you and enjoy your stay!")


def _confirm_passport_details_before_server(check_in_data: CheckInData) -> bool:
    """Let the guest review and confirm passport details BEFORE contacting the server."""
    while True:
        print("\n" + "=" * 50)
        print("PLEASE CONFIRM YOUR PASSPORT DETAILS")
        print("=" * 50)
        print(f"  Guest Name   : {check_in_data.guest_name or '[not set]'}")
        print(f"  Passport No. : {check_in_data.passport_id or '[not set]'}")
        print("=" * 50)
        choice = input("Are these correct? (y = yes, e = edit, r = rescan, c = cancel): ").strip().lower()
        if choice in ("y", "yes"):
            return True
        if choice == "c":
            return False
        if choice == "r":
            # Run the compulsory passport scan again to capture a new image / MRZ,
            # then loop back to confirmation with updated CheckInData.
            if not _do_passport_scan_compulsory(check_in_data):
                print("Rescan cancelled. Keeping previous passport details.")
            continue
        if choice == "e":
            while True:
                print("\nWhat would you like to edit?")
                print("  1: Guest Name")
                print("  2: Passport Number")
                print("  3: Back")
                field_choice = input("Select an option: ").strip()

                if field_choice == "1":
                    new_name = input("  Enter correct guest name: ").strip()
                    if not new_name:
                        print("  Guest name is required.")
                        continue
                    is_valid, err = validate_guest_name(new_name)
                    if not is_valid:
                        print(f"  {err}")
                        continue
                    check_in_data.guest_name = new_name
                    break

                if field_choice == "2":
                    new_passport = input("  Enter correct passport number: ").strip()
                    if not new_passport:
                        print("  Passport number is required.")
                        continue
                    is_valid, err = validate_passport_id(new_passport)
                    if not is_valid:
                        print(f"  {err}")
                        continue
                    check_in_data.passport_id = new_passport
                    break

                if field_choice == "3":
                    break

                print("Please choose: 1 = Guest Name, 2 = Passport Number, 3 = Back.")

            # Loop back to show the (possibly) updated details for confirmation.
            continue
        print("Please choose: y = yes, e = edit, r = rescan, c = cancel.")


def _do_passport_scan_compulsory(check_in_data: CheckInData) -> bool:
    """Run compulsory passport scan.

    Behaviour:
    - Every successful scan saves a passport image (and overrides any previous one).
    - If MRZ details are decoded, we use them directly.
    - If MRZ details cannot be extracted, we still keep the image and offer:
        * rescan (to override the image), or
        * manual entry of passport number/name (only AFTER a scan).
    """
    print("\n" + "=" * 50)
    print("PLEASE SCAN YOUR PASSPORT")
    print("=" * 50)
    print("We will save a clear image of your passport and read your details from the machine-readable zone.")
    while True:
        logger.info("Attempting passport scan")
        passport_data = scan_passport()
        if not passport_data:
            print("\nCould not capture a usable passport image.")
            if not _read_yes_no("Try again?"):
                return False
            continue

        passport_id = (passport_data.get("passport_id") or "").strip()
        guest_name = (passport_data.get("guest_name") or "").strip()
        img_b64 = passport_data.get("passport_image_base64")

        # Image must ALWAYS be saved for every scan attempt that produced one.
        if img_b64:
            check_in_data.passport_image_base64 = img_b64
            logger.info("Passport image captured and stored (may override previous image)")

        if passport_id:
            # MRZ successfully decoded.
            check_in_data.passport_id = passport_id
            check_in_data.guest_name = guest_name or None
            logger.info("Passport scan saved with MRZ details: passport_id=%s", passport_id)
            return True

        # At this point, we have an image but no decoded MRZ details.
        print("\nWe have saved a clear image of your passport, but could not read the passport number.")
        while True:
            choice = input("Enter details manually (m) or rescan passport (r)? [m/r]: ").strip().lower()
            if choice.startswith("m"):
                manual_passport_id = input("Enter passport number: ").strip()
                if not manual_passport_id:
                    print("Passport number is required.")
                    continue
                manual_name = input("Enter your name: ").strip()
                check_in_data.passport_id = manual_passport_id
                check_in_data.guest_name = manual_name or None
                # Image is already stored from this last scan.
                logger.info("Manual passport details entered after scan; image retained")
                return True
            if choice.startswith("r"):
                # Loop back to rescan; new scan will override image.
                break
            print("Please type 'm' to enter details manually or 'r' to rescan.")


def _collect_credit_card_linear(check_in_data: CheckInData) -> bool:
    """Ask for credit card (scan or enter manually). No back option. Returns True when card saved."""
    while True:
        print("\n  1: Scan card with camera")
        print("  2: Enter card details manually")
        print("  3: Scan card with NFC")
        choice = input("Select option: ").strip()
        if choice == "1":
            card_data = _capture_card_via_ocr()
        elif choice == "2":
            card_data = _capture_card_manually()
        elif choice == "3":
            check_in_data.user_use_nfc = True
            if check_in_data.check_in_detail_retrieved:
                send_start_to_esp32()
            card_data = _capture_card_via_nfc(check_in_data)
        else:
            print("Invalid option.")
            continue
        if card_data:
            check_in_data.card_details = card_data
            logger.info("Card details saved")
            return True
        print("Card entry cancelled or failed. Please try again.")


def run_check_in_flow(check_in_data: CheckInData) -> None:
    """Single linear flow: welcome -> passport -> server fetch -> confirm -> credit card -> submit -> room."""
    hotel_name = os.environ.get("HOTEL_NAME", "Our Hotel").strip()
    print("\n" + "=" * 50)
    print(f"WELCOME TO {hotel_name.upper()}")
    print("=" * 50)
    print("We are delighted to have you. Let's get you checked in!")
    print("Please start by scanning your passport.\n")

    # Step 1: Scan passport (compulsory – we need to save the image)
    if not _do_passport_scan_compulsory(check_in_data):
        print("Check-in cancelled.")
        return

    # Step 1b: Let guest confirm their passport details BEFORE talking to the server
    if not _confirm_passport_details_before_server(check_in_data):
        print("Check-in cancelled.")
        return

    # Step 2: Fetch stay details from server using the passport number
    print("\nRetrieving your check-in details from the server...")
    guest, error = fetch_guest_by_passport_id(check_in_data.passport_id or "")
    stay_details: dict
    if guest and not error:
        check_in_data.check_in_detail_retrieved = True
        first_name = (guest.get("first_name") or "").strip()
        last_name = (guest.get("last_name") or "").strip()
        nationality = (guest.get("nationality") or "").strip()
        # Keep guest_name in CheckInData for backward compatibility, but prefer first/last for display
        combined_name = f"{first_name} {last_name}".strip() or check_in_data.guest_name or ""
        if combined_name:
            check_in_data.guest_name = combined_name
        stay_details = {
            "first_name": first_name,
            "last_name": last_name,
            "nationality": nationality,
            "passport_number": guest.get("passport_number") or check_in_data.passport_id or "-",
            "room_number": guest.get("room_number"),
            "check_in_date": guest.get("check_in_date"),
            "check_out_date": guest.get("check_out_date"),
            "status": "Confirmed",
            "amount_owed": guest.get("amount_owed"),
        }
    else:
        stay_details = _get_mock_stay_details(
            check_in_data.guest_name or "Guest",
            check_in_data.passport_id or "",
        )

    # Step 2b: Show stay details and ask guest to confirm before proceeding
    _display_stay_details(stay_details)
    while True:
        choice = input("\nAre these details correct? (y = yes, c = cancel): ").strip().lower()
        if choice in ("y", "yes"):
            break
        if choice == "c":
            print("Check-in cancelled.")
            return
        print("Please choose: y = yes, c = cancel.")

    # Step 3: Credit card registration
    print("\n" + "=" * 50)
    print("PLEASE ENTER YOUR CREDIT CARD")
    print("=" * 50)
    if not _collect_credit_card_linear(check_in_data):
        print("Check-in cancelled.")
        return

    # Step 4: Review and submit
    review_and_submit_menu(check_in_data, stay_details=stay_details)


def _capture_passport_via_ocr() -> Optional[dict]:
    """Scan passport first, then retrieve details from Supabase; guest confirms before proceeding.

    Flow: scan passport (MRZ) -> fetch guest by passport_id from server -> show details -> confirm.
    """
    while True:
        logger.info("Attempting passport OCR capture")
        passport_data = scan_passport()
        if not passport_data:
            print("\nCould not read passport via OCR.")
            if not _read_yes_no("Try again?"):
                return None
            continue

        passport_id = (passport_data.get("passport_id") or "").strip()
        guest_name_mrz = (passport_data.get("guest_name") or "").strip()

        if not passport_id:
            print("\nCould not read passport number from passport.")
            if not _read_yes_no("Try again?"):
                return None
            continue

        # Fetch guest details from Supabase by passport number
        print("\nRetrieving your details from the server...")
        guest, error = fetch_guest_by_passport_id(passport_id)
        if guest and not error:
            first_name = (guest.get("first_name") or "").strip()
            last_name = (guest.get("last_name") or "").strip()
            nationality = (guest.get("nationality") or "").strip()
            passport_number = (guest.get("passport_number") or passport_id).strip()
            print("\n--- DETAILS FROM YOUR BOOKING ---")
            print(f"  First Name   : {first_name}")
            print(f"  Last Name    : {last_name}")
            print(f"  Nationality  : {nationality or '(not set)'}")
            print(f"  Passport No. : {passport_number}")
            confirm = _read_yes_no("\nConfirm these details?")
        else:
            guest_name = guest_name_mrz
            is_valid, err = validate_guest_name(guest_name)
            if not is_valid:
                guest_name = ""
            print("\n--- DETAILS FROM PASSPORT (not found on server) ---")
            print(f"  Guest Name   : {guest_name or '(could not read)'}")
            print(f"  Passport No. : {passport_id}")
            confirm = _read_yes_no("\nConfirm these details?")

        if confirm:
            if not guest_name:
                guest_name = input("Please enter your name: ").strip() or guest_name_mrz
            is_valid, err = validate_guest_name(guest_name)
            if not is_valid:
                print(f"  Validation: {err}")
                continue
            is_valid, err = validate_passport_id(passport_id)
            if not is_valid:
                print(f"  Validation: {err}")
                continue
            return {
                "guest_name": guest_name,
                "passport_id": passport_id,
                "passport_image_base64": passport_data.get("passport_image_base64"),
            }
        # If not confirmed, restart capture loop


def _capture_passport_manually() -> Optional[dict]:
    """Enter passport number; retrieve details from Supabase and confirm (same flow as scan)."""
    while True:
        print("\nEnter passport number (to retrieve your booking details):")
        passport_id = input("  Passport Number: ").strip()
        if not passport_id:
            print("Passport ID is required.")
            continue
        is_valid, err = validate_passport_id(passport_id)
        if not is_valid:
            print(f"  {err}")
            continue

        print("Retrieving your details from the server...")
        guest, error = fetch_guest_by_passport_id(passport_id)
        if guest and not error:
            first_name = (guest.get("first_name") or "").strip()
            last_name = (guest.get("last_name") or "").strip()
            nationality = (guest.get("nationality") or "").strip()
            passport_number = (guest.get("passport_number") or passport_id).strip()
            print("\n--- DETAILS FROM YOUR BOOKING ---")
            print(f"  First Name   : {first_name}")
            print(f"  Last Name    : {last_name}")
            print(f"  Nationality  : {nationality or '(not set)'}")
            print(f"  Passport No. : {passport_number}")
            if _read_yes_no("\nConfirm these details?"):
                # Still populate guest_name/passport_id in CheckInData for now
                combined_name = f"{first_name} {last_name}".strip() or None
                return {
                    "guest_name": combined_name,
                    "passport_id": passport_number,
                }
        else:
            guest_name = input("  Guest name (not found on server): ").strip()
            is_valid, err = validate_guest_name(guest_name)
            if not is_valid:
                print(f"  {err}")
                continue
            print("\n--- ENTERED DETAILS ---")
            print(f"  Guest Name : {guest_name}")
            print(f"  Passport ID: {passport_id}")
            if _read_yes_no("\nConfirm these details?"):
                return {"guest_name": guest_name, "passport_id": passport_id}
        # If not confirmed, restart


def handle_passport_registration(check_in_data: CheckInData) -> None:
    """Step 1: Scan passport (or enter passport number), retrieve details from server, guest confirms."""
    print("\n" + "=" * 50)
    print("STEP 1: SCAN PASSPORT & CONFIRM DETAILS")
    print("=" * 50)
    print("First scan your passport. We will retrieve your booking details for you to confirm.")
    print(f"Current Guest Name : {check_in_data.guest_name or '[not set]'}")
    print(f"Current Passport ID: {check_in_data.passport_id or '[not set]'}")

    print("\nSelect method:")
    print("  1: Scan Passport (camera)")
    print("  2: Enter Passport number manually")
    print("  3: Back to Main Menu")

    choice = input("\nSelect an option: ").strip()

    new_data: Optional[dict] = None
    if choice == "1":
        new_data = _capture_passport_via_ocr()
    elif choice == "2":
        new_data = _capture_passport_manually()
    elif choice == "3":
        return
    else:
        print("Invalid option. Returning to main menu.")
        return

    if new_data:
        check_in_data.guest_name = new_data["guest_name"]
        check_in_data.passport_id = new_data["passport_id"]
        check_in_data.passport_image_base64 = new_data.get("passport_image_base64")
        check_in_data.check_in_detail_retrieved = True
        logger.info("Passport data saved to CheckInData")
        print("\nDetails confirmed. Next: register your credit card (option 2).")


def _capture_card_manually() -> Optional[dict]:
    """Capture card via keyboard. Validates card number (Luhn), expiry (MM/YY), CVV."""
    while True:
        print("\nEnter card details:")
        card_no = input("  Card number: ").strip()
        expiry = input("  Expiry (MM/YY): ").strip()
        cvv = input("  CVV: ").strip()
        cardholder_name = input("  Cardholder name: ").strip()

        # Validation before confirmation
        errors = []
        is_valid, err = validate_card_number(card_no)
        if not is_valid:
            errors.append(f"Card number: {err}")
        is_valid, err = validate_card_expiry(expiry)
        if not is_valid:
            errors.append(f"Expiry: {err}")
        is_valid, err = validate_card_cvv(cvv)
        if not is_valid:
            errors.append(f"CVV: {err}")

        if errors:
            print("\nValidation errors:")
            for e in errors:
                print(f"  - {e}")
            print("Please try again.\n")
            continue

        # Immediate confirmation pattern
        print("\nCAPTURED CARD DATA:")
        print(f"  Card Number    : {card_no}")
        print(f"  Expiry (MM/YY) : {expiry}")
        print(f"  CVV            : {'*' * len(cvv) if cvv else ''}")
        print(f"  Cardholder Name: {cardholder_name}")
        if _read_yes_no("Is this correct?"):
            return {
                "card_no": card_no,
                "expiry": expiry,
                "cvv": cvv,
                "cardholder_name": cardholder_name,
            }
        # If not confirmed, restart capture loop


def _capture_card_via_nfc(check_in_data: CheckInData) -> Optional[dict]:
    """Capture card via NFC UID and derive a masked card number from UID mapping.

    LEGACY NOTE: This uses the WiFi-based HTTP listener (run_nfc_uid_http_listener).
    In the web app flow, the Node.js backend reads UIDs directly from USB serial
    instead (NFC_MODE=serial). This function is only used by the standalone Python CLI.
    """
    passport_id = (check_in_data.passport_id or "").strip()
    if not passport_id:
        print("\nPassport ID is required before linking an NFC card.")
        return None

    print("\n" + "=" * 50)
    print("SCAN CARD WITH NFC")
    print("=" * 50)
    print("Please tap your card on the NFC reader.")
    print("Waiting for card tap...\n")

    done = threading.Event()
    success = [False]

    def on_uid(nfc_uid: str) -> None:
        ok, err = link_nfc_uid_to_guest(passport_id, nfc_uid)
        if ok:
            print(f"\nCard UID {nfc_uid} linked to your booking successfully.")
            check_in_data.nfc_uid = nfc_uid
            success[0] = True
            done.set()
        else:
            print(f"\nFailed to send card UID to server: {err}")
            print("You can tap again to retry.")

    # NFC UID will now arrive via HTTP POST from ESP32 (encrypted), not over serial.
    # Host/port control where we listen for the /nfc-uid callback.
    host = os.getenv("JETSON_NFC_UID_HOST", "0.0.0.0")
    port_str = os.getenv("JETSON_NFC_UID_PORT", "8765")
    try:
        port = int(port_str)
    except ValueError:
        logger.warning("Invalid JETSON_NFC_UID_PORT %r, falling back to 8765", port_str)
        port = 8765

    listener_thread = threading.Thread(
        target=run_nfc_uid_http_listener,
        kwargs={"host": host, "port": port, "on_uid": on_uid, "stop_event": done},
        daemon=True,
    )
    listener_thread.start()

    try:
        done.wait()
    except KeyboardInterrupt:
        print("\nStopped by user.")
        done.set()
        listener_thread.join(timeout=2.0)
        return None

    listener_thread.join(timeout=2.0)

    if not success[0]:
        return None

    # Map NFC UID to fake PAN last-4 and let user confirm.
    nfc_uid = (check_in_data.nfc_uid or "").strip().upper()
    last4 = NFC_UID_TO_LAST4.get(nfc_uid)

    if not last4:
        print("\nWe could not recognize this card from its NFC UID.")
        print("Please try another card or use a different capture method.")
        return None

    print(f"\nWe detected a card ending with {last4}.")
    if not _read_yes_no("Is this your card?"):
        if _read_yes_no("Try another card with NFC?"):
            # Let caller decide whether to invoke NFC flow again.
            print("Card not confirmed. Please start NFC scan again if you wish.")
            return None
        print("Card entry cancelled.")
        return None

    card_no = "****" + last4
    print(f"\nWe will use the card ending with {last4} for your stay.")

    return {
        "card_no": card_no,
        "expiry": "N/A",
        "cvv": "",
        "cardholder_name": "[NFC card]",
    }


def _capture_card_via_ocr() -> Optional[dict]:
    """Capture card via camera OCR (multi-frame handled inside scan_card)."""
    while True:
        logger.info("Attempting card OCR capture (multi-frame inside scan_card)")
        card_data = scan_card()
        if not card_data:
            print("\nCould not read card via OCR.")
            if not _read_yes_no("Try again?"):
                return None
            continue
        card_no = (card_data.get("card_no") or "").strip()
        expiry = (card_data.get("expiry") or "").strip()
        cvv = (card_data.get("cvv") or "").strip()
        cardholder_name = (card_data.get("cardholder_name") or "").strip()

        # CVV is on the back of the card; only prompt when number and expiry are confirmed
        if not cvv and card_no and expiry:
            print("\nCVV is on the back of the card and cannot be read by the camera.")
            cvv = input("Enter CVV (3 or 4 digits): ").strip()

        # Validation before confirmation
        errors = []
        is_valid, err = validate_card_number(card_no)
        if not is_valid:
            errors.append(f"Card number: {err}")
        is_valid, err = validate_card_expiry(expiry)
        if not is_valid:
            errors.append(f"Expiry: {err}")
        is_valid, err = validate_card_cvv(cvv)
        if not is_valid:
            errors.append(f"CVV: {err}")

        if errors:
            print("\nValidation errors on OCR result:")
            for e in errors:
                print(f"  - {e}")
            if not _read_yes_no("Rescan card?"):
                return None
            continue

        # Immediate confirmation pattern
        print("\nCAPTURED CARD DATA:")
        print(f"  Card Number    : {card_no}")
        print(f"  Expiry (MM/YY) : {expiry}")
        print(f"  CVV            : {'*' * len(cvv) if cvv else ''}")
        print(f"  Cardholder Name: {cardholder_name}")
        if _read_yes_no("Is this correct?"):
            return {
                "card_no": card_no,
                "expiry": expiry,
                "cvv": cvv,
                "cardholder_name": cardholder_name,
            }
        # If not confirmed, restart capture loop


def handle_card_registration(check_in_data: CheckInData) -> None:
    """Step 2: Register credit card (after passport confirmed)."""
    print("\n" + "=" * 50)
    print("STEP 2: REGISTER CREDIT CARD")
    print("=" * 50)
    print("Enter your credit card after confirming your passport details (option 1).")
    if check_in_data.card_details:
        current_card_no = check_in_data.card_details.get("card_no", "[not set]")
        if current_card_no and current_card_no not in ("[not set]", "N/A"):
            masked = (
                "*" * (len(current_card_no) - 4) + current_card_no[-4:]
                if len(current_card_no) > 4
                else current_card_no
            )
        else:
            masked = "[not set]"
        print(f"Current Card Number : {masked}")
        print(f"Current Expiry      : {check_in_data.card_details.get('expiry', '[not set]')}")
    else:
        print("Current Card Number : [not set]")
        print("Current Expiry      : [not set]")

    print("\nSelect capture method:")
    print("  1: Scan Card via OCR")
    print("  2: Enter Manually")
    print("  3: Scan card with NFC")
    print("  4: Back to Main Menu")

    choice = input("\nSelect an option: ").strip()

    new_card: Optional[dict] = None
    if choice == "1":
        new_card = _capture_card_via_ocr()
    elif choice == "2":
        new_card = _capture_card_manually()
    elif choice == "3":
        check_in_data.user_use_nfc = True
        if check_in_data.check_in_detail_retrieved:
            send_start_to_esp32()
        new_card = _capture_card_via_nfc(check_in_data)
    elif choice == "4":
        return
    else:
        print("Invalid option. Returning to main menu.")
        return

    if new_card:
        check_in_data.card_details = new_card
        logger.info("Card details saved to CheckInData")


def _edit_review_field(check_in_data: CheckInData) -> None:
    """Allow editing of individual fields from the review screen."""
    while True:
        print("\nWhat would you like to edit?")
        print("  1: Guest Name")
        print("  2: Passport Number")
        print("  3: Card Number")
        print("  4: Card Expiry")
        print("  5: Cardholder Name")
        print("  6: Back")
        choice = input("Select an option: ").strip()

        if choice == "1":
            new_name = input("  Enter guest name: ").strip()
            if not new_name:
                print("  Guest name is required.")
                continue
            is_valid, err = validate_guest_name(new_name)
            if not is_valid:
                print(f"  {err}")
                continue
            check_in_data.guest_name = new_name
            return

        if choice == "2":
            new_passport = input("  Enter passport number: ").strip()
            if not new_passport:
                print("  Passport number is required.")
                continue
            is_valid, err = validate_passport_id(new_passport)
            if not is_valid:
                print(f"  {err}")
                continue
            check_in_data.passport_id = new_passport
            return

        if choice in ("3", "4", "5"):
            if check_in_data.card_details is None:
                check_in_data.card_details = {}

            if choice == "3":
                new_card_no = input("  Enter card number: ").strip()
                is_valid, err = validate_card_number(new_card_no)
                if not is_valid:
                    print(f"  {err}")
                    continue
                check_in_data.card_details["card_no"] = new_card_no
                return

            if choice == "4":
                new_expiry = input("  Enter expiry (MM/YY): ").strip()
                is_valid, err = validate_card_expiry(new_expiry)
                if not is_valid:
                    print(f"  {err}")
                    continue
                check_in_data.card_details["expiry"] = new_expiry
                return

            if choice == "5":
                new_holder = input("  Enter cardholder name: ").strip()
                if not new_holder:
                    print("  Cardholder name is required.")
                    continue
                check_in_data.card_details["cardholder_name"] = new_holder
                return

        if choice == "6":
            return

        print("Please choose a valid option (1-6).")


def review_and_submit_menu(check_in_data: CheckInData, stay_details: Optional[dict] = None) -> None:
    """Review all data, validate, confirm, then send to server.

    Flow: show data -> validate -> confirm -> send to Supabase -> show final summary with room.
    Returns to main menu when done (does not exit app).
    """
    logger.info("Review and submit menu opened")

    while True:
        print("\n" + "=" * 50)
        print("REVIEW DATA")
        print("=" * 50)
        print(f"Guest Name : {check_in_data.guest_name or '[not set]'}")
        print(f"Passport ID: {check_in_data.passport_id or '[not set]'}")

        if check_in_data.card_details:
            card_no = check_in_data.card_details.get("card_no", "[not set]")
            if card_no and card_no not in ("[not set]", "N/A"):
                masked = "*" * (len(card_no) - 4) + card_no[-4:] if len(card_no) > 4 else card_no
            else:
                masked = "[not set]"
            print(f"Card Number: {masked}")
            print(f"Expiry    : {check_in_data.card_details.get('expiry', '[not set]')}")
            print(f"Cardholder: {check_in_data.card_details.get('cardholder_name', '[not set]')}")
        else:
            print("Card Number: [not set]")
            print("Expiry    : [not set]")
            print("Cardholder: [not set]")

        deposit = (stay_details or {}).get("amount_owed") if stay_details else None
        if deposit is not None:
            print(f"Deposit to be charged: {deposit}")

        print("\nOptions: (c = confirm and send, e = edit a field, x = cancel)")
        action = input("Select an option: ").strip().lower()

        if action == "x":
            logger.info("User cancelled in review menu before sending")
            print("Data transmission cancelled.")
            input("\nPress Enter to finish...")
            return

        if action == "e":
            _edit_review_field(check_in_data)
            continue

        if action == "c":
            logger.info("Validating data before submission")
            is_valid, errors = validate_check_in_data(check_in_data)

            if not is_valid:
                logger.error("Validation failed during review:")
                print("\nValidation errors:")
                for error in errors:
                    logger.error("  - %s", error)
                    print(f"  - {error}")
                print("\nPlease correct the data using the edit option before submitting.")
                continue

            logger.info("Data validation passed in review menu")

            if not confirm_data(check_in_data):
                logger.info("User cancelled confirmation in review menu")
                print("Data transmission cancelled.")
                input("\nPress Enter to finish...")
                return
            deposit = (stay_details or {}).get("amount_owed") if stay_details else None
            last4 = ""
            if check_in_data.card_details:
                card_no = (check_in_data.card_details.get("card_no") or "").strip()
                if card_no:
                    last4 = card_no[-4:]
            if deposit is not None and last4:
                print(f"\nWe will charge your deposit of {deposit} to the card ending with {last4}.")

            logger.info("Sending data to Supabase via real HTTPS")
            print("Uploading data to Supabase (this may take a moment)...")
            success, error = send_data(check_in_data)

            if success:
                logger.info("Data successfully sent to server")
                print("\nData successfully sent to server!")
                _display_final_summary(check_in_data, stay_details)
                print("\nWe hope you enjoy your stay, thank you!")
            else:
                logger.error("Failed to send data: %s", error)
                print(f"\nFailed to send data: {error}")

            input("\nPress Enter to finish...")
            return

        print("Please choose: c = confirm and send, e = edit a field, x = cancel.")


def main_menu(check_in_data: CheckInData, hardware_detected: bool) -> None:
    """Main menu loop - runs forever until user chooses Exit (4).

    check_in_data is passed to sub-menus so they can read/write the same object.
    Data persists across menu actions until Submit is triggered.
    """
    while True:
        print("\n" + "=" * 50)
        print("PAYMENT AND IDENTITY SYSTEM")
        print("=" * 50)
        if not hardware_detected:
            print("[MOCK HARDWARE MODE]")
        print("\nMain Menu (complete in order):")
        print("  1: Scan passport & confirm details  (do this first)")
        print("  2: Register credit card            (after passport confirmed)")
        print("  3: Review All & Submit")
        print("  4: Exit")

        choice = input("\nSelect an option: ").strip()

        if choice == "1":
            handle_passport_registration(check_in_data)
        elif choice == "2":
            handle_card_registration(check_in_data)
        elif choice == "3":
            review_and_submit_menu(check_in_data)
        elif choice == "4":
            logger.info("User selected Exit from main menu")
            print("\nExiting Payment and Identity System.")
            return
        else:
            print("Invalid option. Please select 1, 2, 3, or 4.")


def confirm_data(check_in_data: CheckInData) -> bool:
    """Show data and ask "Confirm and send? (yes/no)".

    Returns True if user says yes, False if no.
    Card number is masked (only last 4 digits shown) for security.
    """
    print("\n" + "="*50)
    print("CONFIRM DATA")
    print("="*50)
    print(f"Guest Name: {check_in_data.guest_name}")
    print(f"Passport ID: {check_in_data.passport_id}")
    
    if check_in_data.card_details:
        card_no = check_in_data.card_details.get("card_no", "N/A")
        # Mask card number for security
        if len(card_no) > 4:
            masked_card = "*" * (len(card_no) - 4) + card_no[-4:]
        else:
            masked_card = "****"
        print(f"Card Number: {masked_card}")
        print(f"Expiry: {check_in_data.card_details.get('expiry', 'N/A')}")
        print(f"Cardholder: {check_in_data.card_details.get('cardholder_name', 'N/A')}")
    
    print("="*50)
    
    # In real implementation, this would be a touch screen button
    # For now, use console input
    return _read_yes_no("\nConfirm and send?")


def main():
    """Entry point: linear check-in flow (scan passport -> stay details -> credit card -> submit)."""
    logger.info("Starting Payment and Identity System")

    # At every fresh run, remove previous debug ROI images so only the latest session's
    # captures are present on disk.
    try:
        _clear_roi_debug_images()
    except Exception as e:
        logger.debug("Could not clear previous debug images: %s", e)

    # Detect hardware once (laptop usually = mock, Jetson = real)
    hardware_detected = detect_hardware()
    if not hardware_detected:
        logger.info("MOCK HARDWARE: Running in mock mode")

    check_in_data = CheckInData()

    # Single flow: scan passport -> fetch stay details (or mock) -> show details -> credit card -> submit
    run_check_in_flow(check_in_data)

    return 0



# Only run main() when this file is executed directly (python main.py)
# Not when imported as a module
if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        print("\n\nOperation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)
