"""Touch screen manual entry interface.

On a robot with a touch screen, this would show a virtual keyboard.
On a laptop, we use console input() instead.
"""

import logging
from typing import Optional, Dict, Any
from core.data_model import CheckInData

logger = logging.getLogger(__name__)

# Placeholder: no touch screen library yet
HAS_TOUCH_SCREEN = False


def get_manual_guest_name() -> Optional[str]:
    """Get guest name from user input (keyboard on PC, virtual keyboard on robot)."""
    if not HAS_TOUCH_SCREEN:
        user_input = input("Enter guest name (or press Enter to skip): ").strip()
        return user_input if user_input else None
    return None


def get_manual_passport_id() -> Optional[str]:
    """Get passport ID from user input."""
    if not HAS_TOUCH_SCREEN:
        user_input = input("Enter passport ID (or press Enter to skip): ").strip()
        return user_input if user_input else None
    return None


def get_manual_card_details() -> Optional[Dict[str, Any]]:
    """Get card details from user input."""
    if not HAS_TOUCH_SCREEN:
        card_no = input("Enter card number (or press Enter to skip): ").strip()
        if not card_no:
            return None
        expiry = input("Enter expiry (MM/YY): ").strip()
        cvv = input("Enter CVV: ").strip()
        cardholder_name = input("Enter cardholder name: ").strip()
        return {
            "card_no": card_no,
            "expiry": expiry,
            "cvv": cvv,
            "cardholder_name": cardholder_name
        }
    return None


def manual_entry_flow(check_in_data: CheckInData) -> CheckInData:
    """Let user manually enter or correct data.

    Can OVERRIDE data that was previously scanned.
    Used when OCR was wrong or user prefers to type.
    """
    logger.info("Starting manual entry flow...")
    print("\n" + "=" * 50)
    print("MANUAL ENTRY / CORRECTION")
    print("=" * 50)

    if check_in_data.guest_name:
        print(f"Current guest name: {check_in_data.guest_name}")
    name = get_manual_guest_name()
    if name:
        check_in_data.guest_name = name

    if check_in_data.passport_id:
        print(f"Current passport ID: {check_in_data.passport_id}")
    passport_id = get_manual_passport_id()
    if passport_id:
        check_in_data.passport_id = passport_id

    if check_in_data.card_details:
        print(f"Current card number: {check_in_data.card_details.get('card_no', 'N/A')}")
    card_details = get_manual_card_details()
    if card_details:
        check_in_data.card_details = card_details

    return check_in_data
