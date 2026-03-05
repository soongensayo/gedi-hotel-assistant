import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import {
  lookupReservation,
  lookupReservationByPassport,
  getGuestByPassport,
} from '../services/hotelService';
import { generateWalletPass, isWalletConfigured } from '../services/wallet';
import { sendCheckinEmail, isEmailConfigured } from '../services/emailService';
import { encryptToHex, decryptFromHex, normalizeUid, isNfcConfigured } from '../utils/nfcCrypto';
import { config } from '../config';

const router = Router();

// In-memory store for NFC UIDs received from ESP32, keyed by timestamp
const nfcUidStore: { uid: string; last4: string; receivedAt: number }[] = [];

/**
 * GET /api/checkin/lookup
 * Look up a reservation by confirmation code or guest name.
 */
router.get('/lookup', async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query parameter is required' });
      return;
    }
    const reservation = await lookupReservation(query);
    res.json(reservation);
  } catch (error) {
    console.error('[Checkin Route] Lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup reservation' });
  }
});

/**
 * GET /api/checkin/lookup-passport
 * Look up a reservation by passport number.
 */
router.get('/lookup-passport', async (req: Request, res: Response) => {
  try {
    const { passportNumber } = req.query;
    if (!passportNumber || typeof passportNumber !== 'string') {
      res.status(400).json({ error: 'passportNumber query parameter is required' });
      return;
    }
    const reservation = await lookupReservationByPassport(passportNumber);
    res.json(reservation);
  } catch (error) {
    console.error('[Checkin Route] Passport lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup by passport' });
  }
});

/**
 * POST /api/checkin/scan-passport
 * In live mode, spawns the Python OCR pipeline to capture + read a passport.
 * In mock mode, returns hardcoded test data.
 */
router.post('/scan-passport', async (_req: Request, res: Response) => {
  try {
    if (config.passportScannerMode === 'live') {
      const scriptPath = config.passportScannerScript
        || path.resolve(__dirname, '../../../scripts/scan_passport.py');
      const pythonBin = config.passportScannerPython;
      const timeout = config.passportScannerTimeout;

      const result = await new Promise<{ success: boolean; data?: Record<string, string>; error?: string }>((resolve) => {
        execFile(pythonBin, [scriptPath], { timeout }, (err, stdout, stderr) => {
          if (err) {
            console.error('[Checkin Route] Passport scanner error:', err.message);
            if (stderr) console.error('[Checkin Route] Scanner stderr:', stderr);
            resolve({ success: false, error: err.killed ? 'Scanner timed out' : 'Scanner failed' });
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed.error) {
              resolve({ success: false, error: parsed.error });
              return;
            }
            const nameParts = (parsed.guest_name || '').trim().split(/\s+/);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || firstName;
            resolve({
              success: true,
              data: {
                firstName,
                lastName,
                passportNumber: parsed.passport_id || '',
                passportImageBase64: parsed.passport_image_base64 || '',
              },
            });
          } catch {
            console.error('[Checkin Route] Failed to parse scanner output:', stdout);
            resolve({ success: false, error: 'Failed to parse scanner output' });
          }
        });
      });

      res.json(result);
      return;
    }

    // Mock mode: simulate a scan with a random delay
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000));
    const guest = await getGuestByPassport('E1234567A');
    if (guest) {
      res.json({
        success: true,
        data: {
          firstName: guest.firstName,
          lastName: guest.lastName,
          nationality: guest.nationality,
          passportNumber: guest.passportNumber,
          dateOfBirth: guest.dateOfBirth,
          expiryDate: '2028-03-14',
          gender: 'M',
        },
      });
    } else {
      res.json({
        success: true,
        data: {
          firstName: 'James',
          lastName: 'Chen',
          nationality: 'Singapore',
          passportNumber: 'E1234567A',
          dateOfBirth: '1985-03-15',
          expiryDate: '2028-03-14',
          gender: 'M',
        },
      });
    }
  } catch (error) {
    console.error('[Checkin Route] Scan error:', error);
    res.json({ success: false, error: 'Scanner error' });
  }
});

/**
 * POST /api/checkin/process-payment
 * Simulate payment processing (mock mode).
 */
router.post('/process-payment', async (req: Request, res: Response) => {
  try {
    const { reservationId, amount, currency } = req.body;

    // Simulate payment processing delay
    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000));

    // Always succeed in mock mode
    res.json({
      success: true,
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      amount,
      currency,
      last4: '4242',
      reservationId,
    });
  } catch (error) {
    console.error('[Checkin Route] Payment error:', error);
    res.json({ success: false, error: 'Payment processing failed' });
  }
});

/**
 * POST /api/checkin/complete
 * Complete the check-in process, issue a key card, generate wallet pass, and email guest.
 */
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const {
      reservationId,
      roomId,
      guestEmail,
      guestName,
      roomNumber: clientRoomNumber,
      roomType,
      floor,
      checkInDate,
      checkOutDate,
      confirmationCode,
    } = req.body;

    // Simulate key card encoding delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const keyCardNumber = `KC-${Date.now().toString(36).toUpperCase()}`;

    const roomNumber = clientRoomNumber
      || (roomId === 'room-1' ? '1204'
        : roomId === 'room-2' ? '1508'
        : roomId === 'room-3' ? '2001'
        : roomId === 'room-4' ? '2501'
        : '1204');

    const hotelName = config.hotelName;
    let digitalKeySent = false;

    // Fire-and-forget: generate wallet pass + send email
    if (guestEmail && isEmailConfigured()) {
      (async () => {
        try {
          let walletPass = undefined;

          if (isWalletConfigured('apple')) {
            try {
              walletPass = await generateWalletPass('apple', {
                guestName: guestName || 'Valued Guest',
                guestEmail,
                roomNumber,
                roomType: roomType || 'standard',
                floor: floor || 1,
                checkInDate: checkInDate || new Date().toISOString(),
                checkOutDate: checkOutDate || new Date().toISOString(),
                confirmationCode: confirmationCode || 'N/A',
                hotelName,
                keyCardNumber,
              });
              console.log('[Checkin] Apple Wallet pass generated');
            } catch (err) {
              console.error('[Checkin] Wallet pass generation failed:', err);
            }
          }

          await sendCheckinEmail({
            to: guestEmail,
            guestName: guestName || 'Valued Guest',
            roomNumber,
            roomType: roomType || 'standard',
            floor: floor || 1,
            checkInDate: checkInDate || new Date().toISOString(),
            checkOutDate: checkOutDate || new Date().toISOString(),
            confirmationCode: confirmationCode || 'N/A',
            hotelName,
            keyCardNumber,
            walletPass,
          });
        } catch (err) {
          console.error('[Checkin] Email sending failed:', err);
        }
      })();
      digitalKeySent = true;
    }

    res.json({
      success: true,
      keyCardNumber,
      roomNumber,
      reservationId,
      checkedInAt: new Date().toISOString(),
      digitalKeySent,
    });
  } catch (error) {
    console.error('[Checkin Route] Complete error:', error);
    res.status(500).json({ error: 'Failed to complete check-in' });
  }
});

// =============================================================================
// NFC Card Reader Endpoints
// =============================================================================

/**
 * POST /api/checkin/activate-nfc
 * Send encrypted "ACTIVATE" command to ESP32 to start the NFC reader.
 */
router.post('/activate-nfc', async (_req: Request, res: Response) => {
  try {
    const esp32Url = config.esp32WifiStartUrl;
    if (!esp32Url) {
      res.json({ success: false, error: 'ESP32_WIFI_START_URL not configured' });
      return;
    }
    if (!isNfcConfigured()) {
      res.json({ success: false, error: 'NFC_SHARED_SECRET_KEY not configured' });
      return;
    }

    const cipherHex = encryptToHex('ACTIVATE');
    if (!cipherHex) {
      res.json({ success: false, error: 'Encryption failed' });
      return;
    }

    const resp = await fetch(esp32Url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: cipherHex,
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      console.log('[NFC] ACTIVATE sent to ESP32 successfully');
      res.json({ success: true });
    } else {
      console.warn('[NFC] ESP32 responded with status', resp.status);
      res.json({ success: false, error: `ESP32 responded ${resp.status}` });
    }
  } catch (error) {
    console.error('[NFC] Failed to activate ESP32:', error);
    res.json({ success: false, error: 'Failed to reach ESP32' });
  }
});

/**
 * POST /api/checkin/nfc-uid
 * Receives encrypted NFC UID from ESP32.
 * The ESP32 POSTs the AES-128-CBC ciphertext as hex in the request body.
 */
router.post('/nfc-uid', async (req: Request, res: Response) => {
  try {
    let bodyText = '';
    if (typeof req.body === 'string') {
      bodyText = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      bodyText = req.body.toString('ascii');
    } else if (req.body && typeof req.body === 'object') {
      bodyText = req.body.uid || req.body.data || JSON.stringify(req.body);
    }
    bodyText = bodyText.trim();

    if (!bodyText) {
      res.status(400).json({ error: 'Empty body' });
      return;
    }

    const plaintext = decryptFromHex(bodyText);
    if (!plaintext) {
      console.warn('[NFC] Failed to decrypt UID from ESP32');
      res.status(400).json({ error: 'Decryption failed' });
      return;
    }

    const uid = normalizeUid(plaintext);
    if (!uid) {
      console.warn('[NFC] Invalid UID after decryption:', plaintext);
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    const last4 = config.nfcUidToLast4[uid] || '';
    console.log(`[NFC] Received UID: ${uid}, card last4: ${last4 || 'unknown'}`);

    nfcUidStore.push({ uid, last4, receivedAt: Date.now() });
    // Keep only the last 20 entries
    while (nfcUidStore.length > 20) nfcUidStore.shift();

    res.json({ success: true });
  } catch (error) {
    console.error('[NFC] Error processing NFC UID:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/checkin/nfc-status
 * Frontend polls this to check if an NFC card has been tapped.
 * Returns the most recent NFC tap within the last 30 seconds.
 */
router.get('/nfc-status', (_req: Request, res: Response) => {
  const cutoff = Date.now() - 30_000;
  const recent = nfcUidStore.filter((e) => e.receivedAt > cutoff);
  if (recent.length > 0) {
    const latest = recent[recent.length - 1];
    res.json({
      detected: true,
      nfcUid: latest.uid,
      last4: latest.last4,
      receivedAt: latest.receivedAt,
    });
  } else {
    res.json({ detected: false });
  }
});

/**
 * POST /api/checkin/nfc-clear
 * Clears the NFC UID store (called after payment is processed).
 */
router.post('/nfc-clear', (_req: Request, res: Response) => {
  nfcUidStore.length = 0;
  res.json({ success: true });
});

export default router;
