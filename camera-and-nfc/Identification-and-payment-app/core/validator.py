"""Validation logic for check-in data.

Validation = checking if data is correct BEFORE we send it.
We validate: name format, passport format, card number (Luhn algorithm), expiry, CVV.
"""

import logging
import re  # Regular expressions - for pattern matching (e.g. "does this look like MM/YY?")
from typing import Tuple, List
from core.data_model import CheckInData

logger = logging.getLogger(__name__)


def validate_guest_name(name: str) -> Tuple[bool, str]:
    """Validate guest name.

    Returns (True, "") if valid, or (False, "error message") if invalid.
    """
    if not name or not name.strip():
        return False, "Guest name cannot be empty"

    if len(name.strip()) < 2:
        return False, "Guest name must be at least 2 characters"

    if len(name.strip()) > 100:
        return False, "Guest name must be less than 100 characters"

    # re.match = "does this string match this pattern?"
    # ^[a-zA-Z\s\-']+$ = only letters, spaces, hyphens, apostrophes allowed
    if not re.match(r"^[a-zA-Z\s\-']+$", name.strip()):
        return False, "Guest name contains invalid characters"

    return True, ""


def validate_passport_id(passport_id: str) -> Tuple[bool, str]:
    """Validate passport ID.

    Passport IDs are typically 6-20 alphanumeric characters (letters + numbers).
    """
    if not passport_id or not passport_id.strip():
        return False, "Passport ID cannot be empty"

    if len(passport_id.strip()) < 6:
        return False, "Passport ID must be at least 6 characters"

    if len(passport_id.strip()) > 20:
        return False, "Passport ID must be less than 20 characters"

    # Must be uppercase letters and numbers only
    if not re.match(r"^[A-Z0-9]+$", passport_id.strip().upper()):
        return False, "Passport ID must contain only uppercase letters and numbers"

    return True, ""


def validate_card_number(card_no: str) -> Tuple[bool, str]:
    """Validate credit card number using the Luhn algorithm.

    The Luhn algorithm is a checksum used by all real credit cards.
    It catches typos (e.g. one wrong digit) - if it fails, the number is invalid.
    """
    if not card_no:
        return False, "Card number cannot be empty"

    # Remove spaces/dashes (users might type "1234 5678 9012 3456")
    card_no = re.sub(r'[\s\-]', '', card_no)

    if not card_no.isdigit():
        return False, "Card number must contain only digits"

    if len(card_no) < 13 or len(card_no) > 19:
        return False, "Card number must be between 13 and 19 digits"

    # Luhn algorithm (checksum for card numbers)
    def luhn_check(card_num: str) -> bool:
        total = 0
        reverse_digits = card_num[::-1]  # Process from right to left
        for i, digit in enumerate(reverse_digits):
            n = int(digit)
            if i % 2 == 1:  # Every 2nd digit (from right) gets doubled
                n *= 2
                if n > 9:
                    n -= 9  # If doubled digit > 9, subtract 9 (e.g. 16 -> 7)
            total += n
        return total % 10 == 0  # Valid if total ends in 0

    if not luhn_check(card_no):
        return False, "Card number failed Luhn algorithm check"

    return True, ""


def validate_card_expiry(expiry: str) -> Tuple[bool, str]:
    """Validate expiry date in MM/YY format (e.g. 12/25)."""
    if not expiry:
        return False, "Expiry date cannot be empty"

    if not re.match(r'^\d{2}/\d{2}$', expiry):
        return False, "Expiry must be in MM/YY format"

    month, year = expiry.split('/')
    month_int = int(month)

    if month_int < 1 or month_int > 12:
        return False, "Month must be between 01 and 12"

    return True, ""


def validate_card_cvv(cvv: str) -> Tuple[bool, str]:
    """Validate CVV (3 or 4 digit security code on the back of the card)."""
    if not cvv:
        return False, "CVV cannot be empty"

    if not cvv.isdigit():
        return False, "CVV must contain only digits"

    if len(cvv) != 3 and len(cvv) != 4:
        return False, "CVV must be 3 or 4 digits"

    return True, ""


def validate_card_details(card_details: dict) -> Tuple[bool, List[str]]:
    """Validate all card fields together.

    Returns (True, []) if valid, or (False, [list of error messages]) if invalid.
    """
    errors = []

    if not card_details:
        return False, ["Card details are required"]

    card_no = card_details.get("card_no", "")
    expiry = card_details.get("expiry", "")
    cvv = card_details.get("cvv", "")

    # Special case: NFC-mapped cards only store masked PAN (****1234) and no real expiry/CVV.
    # For these, we only require that the last 4 characters are digits.
    if card_no.startswith("****") and expiry == "N/A" and not cvv:
        last4 = card_no[-4:] if len(card_no) >= 4 else ""
        if len(last4) != 4 or not last4.isdigit():
            errors.append("Card number: masked NFC card must end with 4 digits")
        return len(errors) == 0, errors

    is_valid, error = validate_card_number(card_no)
    if not is_valid:
        errors.append(f"Card number: {error}")

    is_valid, error = validate_card_expiry(expiry)
    if not is_valid:
        errors.append(f"Expiry: {error}")

    is_valid, error = validate_card_cvv(cvv)
    if not is_valid:
        errors.append(f"CVV: {error}")

    return len(errors) == 0, errors


def validate_check_in_data(data: CheckInData) -> Tuple[bool, List[str]]:
    """Validate the entire CheckInData object (name + passport + card).

    Called before we allow the user to submit - blocks submission if anything is wrong.
    """
    errors = []

    if not data.guest_name:
        errors.append("Guest name is required")
    else:
        is_valid, error = validate_guest_name(data.guest_name)
        if not is_valid:
            errors.append(f"Guest name: {error}")

    if not data.passport_id:
        errors.append("Passport ID is required")
    else:
        is_valid, error = validate_passport_id(data.passport_id)
        if not is_valid:
            errors.append(f"Passport ID: {error}")

    if not data.card_details:
        errors.append("Card details are required")
    else:
        is_valid, card_errors = validate_card_details(data.card_details)
        if not is_valid:
            errors.extend(card_errors)

    return len(errors) == 0, errors
