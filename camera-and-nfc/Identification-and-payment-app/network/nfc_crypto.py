"""LEGACY: AES-128-CBC helpers for secure NFC handshake (Jetson <-> ESP32) over WiFi.

NOT USED when NFC_MODE=serial. In serial mode no encryption is needed — the ESP32
sends raw hex UIDs over USB serial to the Node.js backend.

This module is kept for backward compatibility with the WiFi-based encrypted flow.
"""

import base64
import logging
import os
from typing import Optional

from Crypto.Cipher import AES

logger = logging.getLogger(__name__)

_BLOCK_SIZE = 16
_FIXED_IV = b"\x00" * _BLOCK_SIZE


def _get_key_bytes() -> Optional[bytes]:
    """Return 16-byte AES key from NFC_SHARED_SECRET_KEY env, or None if misconfigured."""
    key = os.getenv("NFC_SHARED_SECRET_KEY") or ""
    if len(key) != 16:
        logger.error(
            "NFC_SHARED_SECRET_KEY must be exactly 16 characters for AES-128; got length %s",
            len(key),
        )
        return None
    return key.encode("utf-8")


def get_nfc_shared_key() -> Optional[bytes]:
    """Public helper used by other modules."""
    return _get_key_bytes()


def _pkcs7_pad(data: bytes) -> bytes:
    pad_len = _BLOCK_SIZE - (len(data) % _BLOCK_SIZE)
    return data + bytes([pad_len] * pad_len)


def _pkcs7_unpad(data: bytes) -> Optional[bytes]:
    if not data:
        return None
    pad_len = data[-1]
    if pad_len < 1 or pad_len > _BLOCK_SIZE:
        return None
    if len(data) < pad_len:
        return None
    if data[-pad_len:] != bytes([pad_len] * pad_len):
        return None
    return data[:-pad_len]


def encrypt_to_hex(plaintext: str, key: bytes) -> str:
    """Encrypt plaintext using AES-128-CBC and return ciphertext as hex string."""
    raw = plaintext.encode("utf-8")
    padded = _pkcs7_pad(raw)
    cipher = AES.new(key, AES.MODE_CBC, iv=_FIXED_IV)
    ct = cipher.encrypt(padded)
    return ct.hex()


def decrypt_from_hex(hex_ciphertext: str, key: bytes) -> Optional[str]:
    """Decrypt hex ciphertext to plaintext string. Returns None on error."""
    try:
        ct = bytes.fromhex(hex_ciphertext.strip())
    except ValueError:
        logger.warning("decrypt_from_hex: invalid hex input")
        return None
    if not ct or len(ct) % _BLOCK_SIZE != 0:
        logger.warning("decrypt_from_hex: ciphertext length not multiple of block size")
        return None
    cipher = AES.new(key, AES.MODE_CBC, iv=_FIXED_IV)
    padded = cipher.decrypt(ct)
    raw = _pkcs7_unpad(padded)
    if raw is None:
        logger.warning("decrypt_from_hex: PKCS7 unpad failed")
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        logger.warning("decrypt_from_hex: UTF-8 decode failed")
        return None

