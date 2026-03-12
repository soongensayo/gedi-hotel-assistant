"""LEGACY: HTTP listener for encrypted NFC UID sent from ESP32 over WiFi.

NOT USED when NFC_MODE=serial. In serial mode the ESP32 prints raw UIDs to
USB serial and the Node.js backend reads them directly — no HTTP callback needed.

This module is kept for backward compatibility with the WiFi-based flow where
the ESP32 POSTs AES-128-CBC encrypted UIDs over HTTP.
"""

import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Optional

from .nfc_crypto import decrypt_from_hex, get_nfc_shared_key
from .nfc_serial import normalize_uid

logger = logging.getLogger(__name__)


def run_nfc_uid_http_listener(
    host: str,
    port: int,
    on_uid: Callable[[str], None],
    stop_event,
) -> None:
    """Run a small HTTP server that accepts one or more encrypted UID posts.

    The server handles POST /nfc-uid with body = hex ciphertext. On successful
    decryption and normalization, on_uid(uid) is called. The stop_event should
    be a threading.Event; when set, the server loop exits.
    """
    key = get_nfc_shared_key()
    if key is None:
        logger.error("NFC shared key is not configured; NFC UID listener will not start")
        return

    class NFCUIDHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # type: ignore[override]
            if self.path != "/nfc-uid":
                self.send_response(404)
                self.end_headers()
                return

            length_header = self.headers.get("Content-Length") or "0"
            try:
                length = int(length_header)
            except ValueError:
                length = 0

            body = self.rfile.read(length)
            body_text = body.decode("ascii", errors="ignore").strip()
            if not body_text:
                logger.warning("Received empty body on /nfc-uid")
                self.send_response(400)
                self.end_headers()
                return

            plaintext = decrypt_from_hex(body_text, key)
            if plaintext is None:
                logger.warning("Failed to decrypt NFC UID from ESP32")
                self.send_response(400)
                self.end_headers()
                return

            uid = normalize_uid(plaintext)
            if not uid:
                logger.warning("Decrypted NFC UID is invalid: %r", plaintext)
                self.send_response(400)
                self.end_headers()
                return

            logger.info("Decrypted NFC UID from ESP32: %s", uid)
            try:
                on_uid(uid)
            except Exception as exc:  # pragma: no cover - callback errors logged
                logger.exception("on_uid callback error: %s", exc)
                self.send_response(500)
                self.end_headers()
                return

            # Signal the main thread that we have a UID; allow loop to exit.
            if hasattr(stop_event, "set"):
                stop_event.set()

            self.send_response(200)
            self.end_headers()

        def log_message(self, format: str, *args) -> None:  # type: ignore[override]
            # Route default HTTP handler logs through our logger
            logger.info("NFCUID HTTP: " + format, *args)

    server_address = (host, int(port))
    httpd = HTTPServer(server_address, NFCUIDHandler)
    logger.info("NFC UID HTTP listener started on %s:%s", host, port)
    try:
        # Handle requests until stop_event is set. Each handle_request() processes
        # at most one request, then returns.
        while not getattr(stop_event, "is_set", lambda: False)():
            httpd.handle_request()
    except KeyboardInterrupt:
        logger.info("NFC UID HTTP listener interrupted by user")
    finally:
        httpd.server_close()
        logger.info("NFC UID HTTP listener stopped")

