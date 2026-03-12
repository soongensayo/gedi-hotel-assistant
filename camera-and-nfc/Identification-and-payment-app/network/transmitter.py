"""Network transmission for sending check-in data via HTTPS POST.

HTTPS = secure HTTP (encrypted). POST = send data to a URL.
We use the 'requests' library to do the actual HTTP request.

Passport images are uploaded to a **private** Supabase Storage bucket ('passports')
and only the file path is stored in the 'guests' table (passport_path column).
To view an image later, use get_passport_image() which generates a short-lived signed URL.
"""

import base64
import logging
import json
import os
import uuid
from typing import Dict, Any, Optional, Tuple, List

import requests
from requests.exceptions import RequestException

from core.data_model import CheckInData

logger = logging.getLogger(__name__)

_STORAGE_BUCKET = "passports"


def _get_guests_url_and_headers() -> Tuple[Optional[str], Optional[Dict[str, str]]]:
    """Build Supabase guests table URL and auth headers. Returns (url, headers) or (None, None) if not configured."""
    endpoint_url = os.getenv("SUPABASE_URL", "").strip()
    if not endpoint_url:
        return None, None
    if "/rest/v1/" not in endpoint_url:
        base = endpoint_url.rstrip("/")
        endpoint_url = f"{base}/rest/v1/guests"
    if not endpoint_url.lower().startswith("https://"):
        return None, None
    supabase_anon = os.getenv("SUPABASE_ANON_KEY", "").strip() or None
    supabase_service = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or None
    token = supabase_service or supabase_anon
    headers: Dict[str, str] = {}
    if token:
        headers["apikey"] = token
        headers["Authorization"] = f"Bearer {token}"
    headers["Accept"] = "application/json"
    return endpoint_url, headers


def fetch_guest_by_passport_id(passport_id: str, timeout: int = 10) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Fetch a single guest from Supabase by passport_number. Returns (guest_row, None) or (None, error_message)."""
    from urllib.parse import quote
    raw = (passport_id or "").strip()
    if not raw:
        return None, "Passport number is empty"
    url, headers = _get_guests_url_and_headers()
    if not url or not headers:
        return None, "SUPABASE_URL and keys not configured in .env"
    # Backend column is now passport_number instead of passport_id.
    filter_url = f"{url}?passport_number=eq.{quote(raw, safe='')}"
    try:
        resp = requests.get(filter_url, headers=headers, timeout=timeout)
        if resp.status_code != 200:
            return None, f"Server responded {resp.status_code}: {resp.text[:200]}"
        data: List[Dict[str, Any]] = resp.json()
        if not data:
            return None, "Guest not found"
        return data[0], None
    except RequestException as e:
        return None, str(e)


def link_nfc_uid_to_guest(passport_id: str, nfc_uid: str, timeout: int = 10) -> Tuple[bool, Optional[str]]:
    """Update the guest row for this passport_id with the given NFC card UID (Supabase REST PATCH).
    Uses only requests; no supabase package required. Returns (True, None) on success."""
    from urllib.parse import quote
    pid = (passport_id or "").strip()
    uid = (nfc_uid or "").strip().replace(" ", "").replace("-", "").upper()
    if not pid:
        return False, "passport_id is empty"
    if not uid:
        return False, "nfc_uid is empty or invalid"
    try:
        int(uid, 16)
    except ValueError:
        return False, "nfc_uid is not valid hex"
    url, headers = _get_guests_url_and_headers()
    if not url or not headers:
        return False, "SUPABASE_URL and keys not configured in .env"
    headers = {**headers, "Content-Type": "application/json"}
    filter_url = f"{url}?passport_number=eq.{quote(pid, safe='')}"
    try:
        resp = requests.patch(filter_url, json={"nfc_uid": uid}, headers=headers, timeout=timeout)
        if resp.status_code not in (200, 204):
            return False, f"Server responded {resp.status_code}: {resp.text[:200]}"
        # 204 = no body; 200 may return updated row(s). Either is success.
        logger.info("Linked nfc_uid %s to passport_id %s", uid, pid)
        return True, None
    except RequestException as e:
        return False, str(e)


def package_data(check_in_data: CheckInData) -> Dict[str, Any]:
    """Convert CheckInData to a plain Python dictionary.

    The server expects JSON. json.dumps() can turn a dict into a JSON string.
    But it can't directly handle our CheckInData class - so we convert to dict first.
    """
    return check_in_data.to_dict()


def _build_guest_payload(
    check_in_data: CheckInData,
    passport_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the Supabase-ready payload from CheckInData.

    passport_path is the Storage object path (set after a successful upload).
    The raw base64 image is never sent to the guests table — only the path.
    """
    data_dict = package_data(check_in_data)
    guest_name = data_dict.get("guest_name") or ""
    parts = (guest_name or "").strip().split(None, 1)
    first_name = parts[0] if parts else ""
    last_name = parts[1] if len(parts) > 1 else (first_name or "-")
    # Only include columns that actually exist in the Supabase guests table.
    # Confirmed existing: passport_number, first_name, last_name, nfc_uid, passport_path.
    # Removed: guest_name (column does not exist in schema).
    payload: Dict[str, Any] = {
        "first_name": first_name or "-",
        "last_name": last_name,
        "passport_number": data_dict.get("passport_id"),
    }
    if passport_path:
        payload["passport_path"] = passport_path
    if data_dict.get("nfc_uid"):
        payload["nfc_uid"] = data_dict["nfc_uid"]
    return payload


def _resolve_endpoint_url(endpoint_url: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Resolve and validate the Supabase endpoint URL. Returns (url, error) — error is None on success."""
    if endpoint_url is None:
        endpoint_url = os.getenv("SUPABASE_URL", "").strip()
        if not endpoint_url:
            return None, "SUPABASE_URL is not configured in environment."
        if "/rest/v1/" not in endpoint_url:
            endpoint_url = f"{endpoint_url.rstrip('/')}/rest/v1/guests"
    if not endpoint_url.lower().startswith("https://"):
        return None, "Endpoint URL must use HTTPS."
    return endpoint_url, None


def _build_auth_headers(api_key: Optional[str] = None) -> Dict[str, str]:
    """Build Supabase auth headers from an explicit key or environment variables."""
    supabase_anon = os.getenv("SUPABASE_ANON_KEY", "").strip() or None
    supabase_service = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() or None
    token = api_key or supabase_service or supabase_anon
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["apikey"] = token
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get_storage_url() -> Optional[str]:
    """Build the Supabase Storage base URL (e.g. https://xxx.supabase.co/storage/v1)."""
    project_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not project_url:
        return None
    if "/rest/v1/" in project_url:
        project_url = project_url.split("/rest/v1/")[0].rstrip("/")
    return f"{project_url}/storage/v1"


def upload_passport_image(
    passport_id: str,
    image_base64: str,
    api_key: Optional[str] = None,
    timeout: int = 15,
) -> Tuple[Optional[str], Optional[str]]:
    """Upload a passport image to the private 'passports' Storage bucket.

    The file is stored as '<passport_id>/<uuid>.png' so each guest has a
    unique path even across re-scans.

    Args:
        passport_id: Guest passport ID (used as the folder name).
        image_base64: Base64-encoded image data (PNG or JPEG).
        api_key: Optional auth token override.
        timeout: Upload timeout in seconds.

    Returns:
        (file_path, None) on success — file_path is the storage object path.
        (None, error_message) on failure.
    """
    pid = (passport_id or "").strip()
    if not pid:
        return None, "passport_id is empty"
    if not image_base64:
        return None, "No image data provided"

    storage_url = _get_storage_url()
    if not storage_url:
        return None, "SUPABASE_URL not configured"

    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as e:
        return None, f"Invalid base64 image data: {e}"

    file_name = f"{pid}/{uuid.uuid4().hex[:12]}.png"
    upload_url = f"{storage_url}/object/{_STORAGE_BUCKET}/{file_name}"

    headers = _build_auth_headers(api_key)
    headers["Content-Type"] = "image/png"

    try:
        resp = requests.post(upload_url, data=image_bytes, headers=headers, timeout=timeout)
        if 200 <= resp.status_code < 300:
            logger.info("Passport image uploaded to %s/%s", _STORAGE_BUCKET, file_name)
            return file_name, None
        return None, f"Storage upload failed ({resp.status_code}): {resp.text[:200]}"
    except RequestException as e:
        return None, f"Storage upload error: {e}"


def get_passport_image(
    file_path: str,
    expiry_seconds: int = 60,
    api_key: Optional[str] = None,
    timeout: int = 10,
) -> Tuple[Optional[str], Optional[str]]:
    """Generate a short-lived signed URL for a passport image in the private bucket.

    The signed URL can be used directly in an <img> tag and expires after
    *expiry_seconds* (default 60s).

    Args:
        file_path: The storage object path returned by upload_passport_image.
        expiry_seconds: How long the URL stays valid.
        api_key: Optional auth token override.
        timeout: Request timeout in seconds.

    Returns:
        (signed_url, None) on success.
        (None, error_message) on failure.
    """
    if not file_path:
        return None, "file_path is empty"

    storage_url = _get_storage_url()
    if not storage_url:
        return None, "SUPABASE_URL not configured"

    sign_url = f"{storage_url}/object/sign/{_STORAGE_BUCKET}/{file_path}"
    headers = _build_auth_headers(api_key)

    try:
        resp = requests.post(
            sign_url,
            json={"expiresIn": expiry_seconds},
            headers=headers,
            timeout=timeout,
        )
        if resp.status_code == 200:
            body = resp.json()
            signed_url = body.get("signedURL") or body.get("signedUrl") or ""
            if signed_url:
                project_url = storage_url.replace("/storage/v1", "")
                if signed_url.startswith("/"):
                    signed_url = f"{project_url}{signed_url}"
                logger.info("Signed URL generated for %s (expires in %ds)", file_path, expiry_seconds)
                return signed_url, None
            return None, "Server returned empty signedURL"
        return None, f"Signed URL request failed ({resp.status_code}): {resp.text[:200]}"
    except RequestException as e:
        return None, f"Signed URL error: {e}"


def send_data(
    check_in_data: CheckInData,
    endpoint_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: int = 5,
) -> Tuple[bool, Optional[str]]:
    """Send check-in data to the Supabase backend via HTTPS upsert.

    If a guest row with the same passport_id already exists, the row is updated
    (PATCH) rather than duplicated. Otherwise a new row is inserted (POST).

    Args:
        check_in_data: The data to send
        endpoint_url: Where to send it (must start with https://)
        api_key: Optional auth token
        timeout: How many seconds to wait before giving up

    Returns:
        (True, None) if success, or (False, "error message") if it failed
    """
    url, err = _resolve_endpoint_url(endpoint_url)
    if err:
        logger.error(err)
        return False, err

    try:
        passport_id = (check_in_data.passport_id or "").strip()
        headers = _build_auth_headers(api_key)

        # --- Step 1: Upload passport image to Storage (if available) ---
        passport_path: Optional[str] = None
        data_dict = package_data(check_in_data)
        image_b64 = data_dict.get("passport_image_base64")
        if image_b64 and passport_id:
            upload_timeout = max(timeout, 15)
            path, upload_err = upload_passport_image(
                passport_id, image_b64, api_key=api_key, timeout=upload_timeout,
            )
            if upload_err:
                logger.warning("Passport image upload failed (continuing without image): %s", upload_err)
            else:
                passport_path = path
                logger.info("Passport image stored at: %s", passport_path)

        # --- Step 2: Build DB payload (with path, not raw image) ---
        payload = _build_guest_payload(check_in_data, passport_path=passport_path)
        json_payload = json.dumps(payload)

        # --- Step 3: Upsert guest row ---
        if passport_id:
            from urllib.parse import quote
            patch_url = f"{url}?passport_number=eq.{quote(passport_id, safe='')}"
            logger.info("Attempting PATCH (update) to %s", patch_url)
            resp = requests.patch(patch_url, data=json_payload, headers=headers, timeout=timeout)
            logger.info("PATCH responded %s %s", resp.status_code, resp.reason)
            if 200 <= resp.status_code < 300:
                # Treat any 2xx as success; do NOT fall back to POST,
                # otherwise we risk creating duplicate rows when Supabase
                # returns 204 No Content for a successful update.
                return True, None

        logger.info("Inserting new guest row via POST to %s", url)
        resp = requests.post(url, data=json_payload, headers=headers, timeout=timeout)
        logger.info("POST responded %s %s", resp.status_code, resp.reason)

        if 200 <= resp.status_code < 300:
            return True, None

        error_msg = f"Non-success status code {resp.status_code}: {resp.text}"
        logger.error(error_msg)
        return False, error_msg

    except RequestException as exc:
        error_msg = f"Request error: {exc}"
        logger.error(error_msg, exc_info=True)
        return False, error_msg
    except Exception as exc:
        error_msg = f"Unexpected error while sending data: {exc}"
        logger.error(error_msg, exc_info=True)
        return False, error_msg


def send_data_mock(check_in_data: CheckInData) -> Tuple[bool, Optional[str]]:
    """Fake send - no network, just logs what WOULD be sent.

    Useful for testing without hitting a real server.
    Always returns (True, None) since nothing can fail.
    """
    logger.info("MOCK MODE: Simulating data transmission")
    data_dict = package_data(check_in_data)
    logger.info("Would send: %s", json.dumps(data_dict, indent=2))
    return True, None
