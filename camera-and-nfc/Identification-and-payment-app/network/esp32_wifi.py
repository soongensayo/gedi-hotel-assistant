"""LEGACY: WiFi/encryption path for ESP32 NFC activation.

NOT USED when NFC_MODE=serial. In serial mode the ESP32 is always-on via USB
and the Node.js backend reads UIDs directly from the serial port.

This module is kept for backward compatibility with the WiFi-based flow where
the Jetson sends an AES-128-CBC encrypted 'ACTIVATE' command over HTTP.
"""

import logging
import os

import requests
from requests.exceptions import RequestException

from .nfc_crypto import encrypt_to_hex, get_nfc_shared_key

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 5
_ACTIVATE_WORD = "ACTIVATE"


def send_start_to_esp32(timeout: int = _DEFAULT_TIMEOUT) -> bool:
    """Send encrypted 'ACTIVATE' command to the ESP32 over WiFi.

    Uses ESP32_WIFI_START_URL from environment (e.g. http://192.168.1.100/start).
    The ESP32 should expose an HTTP endpoint that starts the NFC scanner when requested.

    Returns:
        True if the request succeeded (2xx), False otherwise or if URL not configured.
    """
    url = (os.getenv("ESP32_WIFI_START_URL") or "").strip()
    if not url:
        logger.warning("ESP32_WIFI_START_URL not set; skipping Send Start to ESP32")
        return False
    if not url.lower().startswith("http://") and not url.lower().startswith("https://"):
        logger.warning("ESP32_WIFI_START_URL must be http:// or https://; skipping")
        return False

    key = get_nfc_shared_key()
    if key is None:
        # Error already logged by helper
        return False

    try:
        ciphertext_hex = encrypt_to_hex(_ACTIVATE_WORD, key)
    except Exception as e:
        logger.error("Failed to encrypt ACTIVATE command: %s", e)
        return False

    try:
        resp = requests.post(
            url,
            data=ciphertext_hex.encode("ascii"),
            headers={"Content-Type": "text/plain"},
            timeout=timeout,
        )
        if 200 <= resp.status_code < 300:
            logger.info("ESP32 Start command sent successfully (%s)", resp.status_code)
            return True
        logger.warning("ESP32 Start command returned status %s", resp.status_code)
        return False
    except RequestException as e:
        logger.warning("Failed to send Start to ESP32: %s", e)
        return False
