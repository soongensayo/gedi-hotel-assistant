"""Data model for check-in information.

This file defines the main "container" that holds all guest data
(like a form that gets filled out and then submitted).
"""

# dataclass = a shortcut to create a class that mainly holds data
# typing = tells Python what TYPE each variable is (helps catch bugs early)
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
# @dataclass = decorator that auto-generates __init__, __repr__, etc.
# Think of it as: "Give me a simple class to store data without writing boilerplate"
class CheckInData:
    """Central data class to hold check-in information.

    This is the ONE place where we store guest name, passport ID, and card details.
    All other parts of the app read from or write to this object.
    """

    # Optional[str] = "this field can be a string OR None (not yet filled)"
    guest_name: Optional[str] = None   # e.g. "John Doe"
    passport_id: Optional[str] = None  # e.g. "AB1234567"
    # Dict[str, Any] = a dictionary with string keys and any type of values
    card_details: Optional[Dict[str, Any]] = None  # e.g. {"card_no": "1234...", "expiry": "12/25", ...}
    # Deskewed passport image as base64 (for hotel records); set when passport is scanned, sent on confirm
    passport_image_base64: Optional[str] = None
    # NFC UID linked to this guest's card (from NFC reader)
    nfc_uid: Optional[str] = None
    # Flow flags for NFC scanner trigger (Jetson sends "Start" to ESP32 when both are True)
    check_in_detail_retrieved: bool = False  # Set when OCR/flow successfully retrieves guest from Supabase
    user_use_nfc: bool = False  # Set when user selects "Scan card with NFC" option

    def to_dict(self) -> Dict[str, Any]:
        """Convert CheckInData to dictionary for JSON serialization.

        JSON = a text format for sending data over the internet.
        Python objects must be converted to dicts before json.dumps() can use them.
        """
        out = {
            "guest_name": self.guest_name,
            "passport_id": self.passport_id,
            "card_details": self.card_details
        }
        if self.passport_image_base64 is not None:
            out["passport_image_base64"] = self.passport_image_base64
        if self.nfc_uid is not None:
            out["nfc_uid"] = self.nfc_uid
        return out

    def is_complete(self) -> bool:
        """Check if all required fields are present.

        Returns True only when guest_name, passport_id, AND card_details are all set.
        """
        return (
            self.guest_name is not None and
            self.passport_id is not None and
            self.card_details is not None
        )

    def update_from_dict(self, data: Dict[str, Any]) -> None:
        """Update fields from a dictionary.

        Useful when you receive data from a scan or API and want to merge it in.
        """
        if "guest_name" in data:
            self.guest_name = data["guest_name"]
        if "passport_id" in data:
            self.passport_id = data["passport_id"]
        if "card_details" in data:
            self.card_details = data["card_details"]
        if "passport_image_base64" in data:
            self.passport_image_base64 = data["passport_image_base64"]