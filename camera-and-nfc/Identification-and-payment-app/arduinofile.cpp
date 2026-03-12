
// Simple NFC card reader sketch for ESP32 + PN532 over I2C.
//
// Behaviour (simplified — serial-only, no WiFi/encryption):
//   - On boot, init PN532 over I2C, turn READY_LED ON.
//   - Continuously poll for ISO14443A card taps.
//   - When a card is tapped, read UID, print it as uppercase hex via Serial.
//   - Blink LED on each successful tap.
//   - The host machine reads UIDs from the USB serial port.

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

// --- LEGACY: WiFi + encryption includes (not used in serial mode) ---
// #include <WiFi.h>
// #include <WebServer.h>
// #include <HTTPClient.h>
// extern "C" {
// #include "mbedtls/aes.h"
// }

// I2C pins for 30-pin ESP32
#define SDA_PIN 21
#define SCL_PIN 22

// Status LED to show "ready to scan"
#define READY_LED 2

// PN532 reset pin (hardware reset)
#define PN532_RST 18

// --- LEGACY: WiFi + Jetson config (not used in serial mode) ---
// const char* WIFI_SSID     = "mola";
// const char* WIFI_PASSWORD = "stck85r7";
// const char *JETSON_HOST = "10.231.43.83";
// const int   JETSON_PORT = 8765;
// const char *JETSON_UID_PATH = "/nfc-uid";
// static const char NFC_SHARED_SECRET_KEY[] = "16char_secret_he";
// static const uint8_t AES_IV[16] = {0};

// PN532 over I2C. IRQ and RESET handled via PN532_RST separately.
Adafruit_PN532 nfc(-1, -1);

// --- LEGACY: WiFi state and web server (not used in serial mode) ---
// bool g_active = false;
// WebServer server(80);

// ─── Diagnostic helpers ──────────────────────────────────────────────────────

void blinkLed(int times, int onMs = 150, int offMs = 150) {
  for (int i = 0; i < times; i++) {
    digitalWrite(READY_LED, HIGH);
    delay(onMs);
    digitalWrite(READY_LED, LOW);
    delay(offMs);
  }
}

// ─── Utility functions ───────────────────────────────────────────────────────

String bytesToHex(const uint8_t *buf, size_t len) {
  const char *hex_chars = "0123456789ABCDEF";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; ++i) {
    uint8_t v = buf[i];
    out += hex_chars[(v >> 4) & 0x0F];
    out += hex_chars[v & 0x0F];
  }
  return out;
}

// --- LEGACY: AES encryption/decryption helpers (not used in serial mode) ---
/*
bool hexToBytes(const String &hex, uint8_t *out, size_t &outLen, size_t maxLen) {
  size_t len = hex.length();
  Serial.print("[hexToBytes] input length=");
  Serial.println(len);
  if (len == 0) {
    Serial.println("[hexToBytes] FAIL: empty string");
    return false;
  }
  if ((len % 2) != 0) {
    Serial.print("[hexToBytes] FAIL: odd length=");
    Serial.println(len);
    return false;
  }
  size_t needed = len / 2;
  if (needed > maxLen) {
    Serial.print("[hexToBytes] FAIL: needed=");
    Serial.print(needed);
    Serial.print(" exceeds maxLen=");
    Serial.println(maxLen);
    return false;
  }
  outLen = needed;
  for (size_t i = 0; i < needed; ++i) {
    char c1 = hex[2 * i];
    char c2 = hex[2 * i + 1];
    int v1 = isdigit(c1) ? c1 - '0' : (toupper(c1) - 'A' + 10);
    int v2 = isdigit(c2) ? c2 - '0' : (toupper(c2) - 'A' + 10);
    if (v1 < 0 || v1 > 15 || v2 < 0 || v2 > 15) {
      Serial.print("[hexToBytes] FAIL: invalid hex char at index ");
      Serial.print(i * 2);
      Serial.print(": '");
      Serial.print(c1);
      Serial.print(c2);
      Serial.println("'");
      return false;
    }
    out[i] = (uint8_t)((v1 << 4) | v2);
  }
  Serial.print("[hexToBytes] OK: decoded ");
  Serial.print(needed);
  Serial.println(" bytes");
  return true;
}

size_t pkcs7Pad(uint8_t *buf, size_t len, size_t maxLen) {
  uint8_t padLen = 16 - (len % 16);
  if (len + padLen > maxLen) {
    return 0;
  }
  for (size_t i = 0; i < padLen; ++i) {
    buf[len + i] = padLen;
  }
  return len + padLen;
}

size_t pkcs7Unpad(uint8_t *buf, size_t len) {
  if (len == 0) {
    Serial.println("[pkcs7Unpad] FAIL: len=0");
    return 0;
  }
  uint8_t padLen = buf[len - 1];
  Serial.print("[pkcs7Unpad] padLen=");
  Serial.print(padLen);
  Serial.print(" totalLen=");
  Serial.println(len);
  if (padLen < 1 || padLen > 16 || padLen > len) {
    Serial.println("[pkcs7Unpad] FAIL: padLen out of range");
    return 0;
  }
  for (size_t i = 0; i < padLen; ++i) {
    if (buf[len - 1 - i] != padLen) {
      Serial.print("[pkcs7Unpad] FAIL: pad byte mismatch at index ");
      Serial.println(len - 1 - i);
      return 0;
    }
  }
  return len - padLen;
}

bool aesEncryptToHex(const String &plaintext, String &outHex) {
  uint8_t key[16];
  memcpy(key, NFC_SHARED_SECRET_KEY, 16);

  uint8_t buf[128] = {0};
  size_t len = plaintext.length();
  if (len > sizeof(buf) - 16) {
    return false;
  }
  memcpy(buf, plaintext.c_str(), len);
  size_t paddedLen = pkcs7Pad(buf, len, sizeof(buf));
  if (paddedLen == 0 || (paddedLen % 16) != 0) {
    return false;
  }

  uint8_t out[128] = {0};

  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_enc(&ctx, key, 128);

  uint8_t iv[16];
  memcpy(iv, AES_IV, 16);

  int rc = mbedtls_aes_crypt_cbc(&ctx, MBEDTLS_AES_ENCRYPT, paddedLen, iv, buf, out);
  mbedtls_aes_free(&ctx);
  if (rc != 0) {
    return false;
  }

  outHex = bytesToHex(out, paddedLen);
  return true;
}

bool aesDecryptFromHex(const String &hex, String &outPlain) {
  Serial.print("[aesDecryptFromHex] ciphertext hex (first 32 chars): ");
  Serial.println(hex.substring(0, 32));

  uint8_t key[16];
  memcpy(key, NFC_SHARED_SECRET_KEY, 16);
  Serial.print("[aesDecryptFromHex] key (first 8 chars): ");
  for (int i = 0; i < 8; i++) Serial.print(NFC_SHARED_SECRET_KEY[i]);
  Serial.println();

  uint8_t ct[128] = {0};
  size_t ctLen = 0;
  if (!hexToBytes(hex, ct, ctLen, sizeof(ct))) {
    Serial.println("[aesDecryptFromHex] FAIL: hexToBytes failed");
    return false;
  }
  if (ctLen == 0 || (ctLen % 16) != 0) {
    Serial.print("[aesDecryptFromHex] FAIL: ctLen=");
    Serial.print(ctLen);
    Serial.println(" not multiple of 16");
    return false;
  }
  Serial.print("[aesDecryptFromHex] ctLen=");
  Serial.println(ctLen);

  uint8_t buf[128] = {0};

  mbedtls_aes_context ctx;
  mbedtls_aes_init(&ctx);
  mbedtls_aes_setkey_dec(&ctx, key, 128);

  uint8_t iv[16];
  memcpy(iv, AES_IV, 16);

  int rc = mbedtls_aes_crypt_cbc(&ctx, MBEDTLS_AES_DECRYPT, ctLen, iv, ct, buf);
  mbedtls_aes_free(&ctx);
  if (rc != 0) {
    Serial.print("[aesDecryptFromHex] FAIL: mbedtls_aes_crypt_cbc returned ");
    Serial.println(rc);
    return false;
  }
  Serial.println("[aesDecryptFromHex] AES decrypt OK");

  size_t plainLen = pkcs7Unpad(buf, ctLen);
  if (plainLen == 0) {
    Serial.println("[aesDecryptFromHex] FAIL: pkcs7Unpad returned 0");
    return false;
  }

  buf[plainLen] = '\0';
  outPlain = String((char *)buf);
  Serial.print("[aesDecryptFromHex] decrypted plainLen=");
  Serial.println(plainLen);
  return true;
}
*/

// ─── PN532 init ──────────────────────────────────────────────────────────────

bool initPN532() {
  Serial.println("[initPN532] Releasing PN532 reset pin (HIGH)...");
  digitalWrite(PN532_RST, HIGH);

  Serial.println("[initPN532] Waiting 500ms for PN532 power-on...");
  delay(500);

  Serial.println("[initPN532] Calling nfc.begin()...");
  nfc.begin();
  delay(200);

  Serial.println("[initPN532] Calling getFirmwareVersion()...");
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("[initPN532] ERROR: getFirmwareVersion() returned 0 — PN532 not responding!");
    Serial.println("[initPN532] Check: SDA=GPIO21, SCL=GPIO22, RST=GPIO18, 3.3V power, I2C pull-ups.");
    blinkLed(10, 80, 80);
    return false;
  }

  uint8_t ic  = (versiondata >> 24) & 0xFF;
  uint8_t ver = (versiondata >> 16) & 0xFF;
  uint8_t rev = (versiondata >> 8)  & 0xFF;

  Serial.print("[initPN532] PN532 Chip: PN5");
  Serial.println(ic, HEX);
  Serial.print("[initPN532] Firmware: ");
  Serial.print(ver);
  Serial.print(".");
  Serial.println(rev);

  nfc.SAMConfig();
  Serial.println("[initPN532] SAMConfig done — PN532 ready for NFC scans.");
  return true;
}

// --- LEGACY: WiFi POST + encrypted ACTIVATE handler (not used in serial mode) ---
/*
bool postUidToJetson(const String &encHexUid) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[postUid] WiFi not connected; cannot POST UID to Jetson.");
    return false;
  }

  HTTPClient http;
  String url = String("http://") + JETSON_HOST + ":" + String(JETSON_PORT) + JETSON_UID_PATH;
  Serial.print("[postUid] POSTing encrypted UID to: ");
  Serial.println(url);
  Serial.print("[postUid] Payload (hex): ");
  Serial.println(encHexUid);

  http.begin(url);
  http.addHeader("Content-Type", "text/plain");

  int status = http.POST(encHexUid);
  if (status <= 0) {
    Serial.print("[postUid] FAIL: HTTP POST error code ");
    Serial.println(status);
    http.end();
    return false;
  }

  Serial.print("[postUid] HTTP POST status: ");
  Serial.println(status);
  http.end();
  return (status >= 200 && status < 300);
}

void handleStart() {
  Serial.println("\n[handleStart] *** /start request received ***");
  Serial.print("[handleStart] Method: ");
  Serial.println(server.method() == HTTP_POST ? "POST" : "OTHER");

  if (server.method() != HTTP_POST) {
    Serial.println("[handleStart] REJECT: not a POST request");
    server.send(405, "text/plain", "Method Not Allowed");
    return;
  }

  Serial.print("[handleStart] Number of args: ");
  Serial.println(server.args());
  for (int i = 0; i < server.args(); i++) {
    Serial.print("  arg[");
    Serial.print(i);
    Serial.print("] name='");
    Serial.print(server.argName(i));
    Serial.print("' value=");
    Serial.println(server.arg(i).substring(0, 64));
  }

  String body = server.arg("plain");
  body.trim();
  Serial.print("[handleStart] body via arg('plain'), len=");
  Serial.println(body.length());

  if (body.length() == 0 && server.args() > 0) {
    body = server.arg(0);
    body.trim();
    Serial.print("[handleStart] Fallback to arg(0), len=");
    Serial.println(body.length());
  }

  if (body.length() == 0) {
    Serial.println("[handleStart] FAIL: body is empty.");
    server.send(400, "text/plain", "Empty body");
    return;
  }

  Serial.print("[handleStart] First 64 chars of body: ");
  Serial.println(body.substring(0, 64));

  server.send(200, "text/plain", "OK");
  Serial.println("[handleStart] Sent HTTP 200 OK.");

  String plaintext;
  if (!aesDecryptFromHex(body, plaintext)) {
    Serial.println("[handleStart] FAIL: AES decryption failed.");
    blinkLed(3, 300, 100);
    return;
  }

  plaintext.trim();
  Serial.print("[handleStart] Decrypted payload: '");
  Serial.print(plaintext);
  Serial.println("'");

  if (plaintext != "ACTIVATE") {
    Serial.print("[handleStart] FAIL: expected 'ACTIVATE' but got '");
    Serial.print(plaintext);
    Serial.println("'");
    blinkLed(5, 100, 100);
    return;
  }

  Serial.println("[handleStart] ACTIVATE confirmed. Waiting 3 seconds before PN532 init...");
  delay(3000);

  bool pn532_ok = initPN532();
  if (!pn532_ok) {
    Serial.println("[handleStart] ABORT: PN532 init failed; staying in dormant state.");
    return;
  }

  digitalWrite(READY_LED, HIGH);
  g_active = true;
  Serial.println("[handleStart] LED ON. System now ACTIVE — waiting for card tap.");
}
*/

// ─── Setup ───────────────────────────────────────────────────────────────────

void setup(void) {
  Serial.begin(115200);
  delay(2000);

  pinMode(READY_LED, OUTPUT);
  digitalWrite(READY_LED, LOW);

  pinMode(PN532_RST, OUTPUT);
  digitalWrite(PN532_RST, LOW);

  Serial.println("\n========================================");
  Serial.println("ESP32 PN532 NFC Card Reader (Serial Mode)");
  Serial.println("========================================\n");

  Serial.println("[setup] Blinking LED 3x to confirm LED hardware...");
  blinkLed(3, 200, 200);
  Serial.println("[setup] LED blink done. If you did not see 3 blinks, check GPIO2 wiring.");

  Serial.println("[setup] Initializing I2C (SDA=GPIO21, SCL=GPIO22)...");
  Wire.begin(SDA_PIN, SCL_PIN);

  // --- LEGACY: WiFi connection (not used in serial mode) ---
  /*
  Serial.print("[setup] Connecting to WiFi SSID: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 40) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[setup] WiFi connected. IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[setup] WiFi connection FAILED after 40 retries.");
    blinkLed(3, 100, 100);
    blinkLed(3, 400, 100);
    blinkLed(3, 100, 100);
  }

  server.on("/start", HTTP_POST, handleStart);
  server.begin();
  Serial.println("[setup] HTTP server started on port 80.");
  Serial.println("[setup] System in DORMANT state (PN532 in reset, LED OFF).");
  Serial.println("[setup] Waiting for POST to /start from Jetson...\n");
  */

  // Init PN532 immediately on boot (no activation handshake needed)
  bool pn532_ok = initPN532();
  if (pn532_ok) {
    digitalWrite(READY_LED, HIGH);
    Serial.println("[setup] PN532 ready. LED ON. Waiting for card taps...");
    Serial.println("[setup] UIDs will be printed to Serial as uppercase hex (e.g. 09C9C802).\n");
  } else {
    Serial.println("[setup] PN532 init FAILED. Check wiring. Will retry in loop.\n");
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────

void loop(void) {
  // --- LEGACY: WiFi server handling (not used in serial mode) ---
  // server.handleClient();

  uint8_t uid[7]    = {0};
  uint8_t uidLength = 0;

  bool success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 500);

  if (!success) {
    return;
  }

  // Build UID hex string (e.g. "09C9C802")
  String uidHex;
  uidHex.reserve(uidLength * 2);
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) uidHex += "0";
    uidHex += String(uid[i], HEX);
  }
  uidHex.toUpperCase();

  // Print UID to serial — the host reads this via USB
  Serial.println(uidHex);

  // Blink LED once to give tactile feedback
  blinkLed(1, 200, 0);
  digitalWrite(READY_LED, HIGH);

  // Small debounce so the same card isn't read repeatedly
  delay(1000);
}
