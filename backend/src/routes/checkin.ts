import { Router, Request, Response } from 'express';
import { execFile, ChildProcess } from 'child_process';
import path from 'path';
import {
  getReservationProfile,
  lookupReservation,
  lookupReservationByPassport,
  recordStanfordCheckinEvent,
  searchReservations,
  getGuestByPassport,
  updateGuestPassportData,
} from '../services/hotelService';
import { generateWalletPass, isWalletConfigured } from '../services/wallet';
import { sendCheckinEmail, isEmailConfigured } from '../services/emailService';
import { encryptToHex, decryptFromHex, normalizeUid, isNfcConfigured } from '../utils/nfcCrypto';
import { startNfcSerialListener, stopNfcSerialListener } from '../services/nfcSerial';
import { passportScannerWorker } from '../services/passportScannerWorker';
import { config } from '../config';

const router = Router();

function esp32Request(reqPath: string): void {
  const ip = config.esp32FlashIp;
  if (!ip) {
    console.log(`[ESP32] Skipping ${reqPath} — ESP32_FLASH_IP not configured`);
    return;
  }
  const url = `http://${ip}/${reqPath}`;
  console.log(`[ESP32] GET ${url}`);
  fetch(url, { signal: AbortSignal.timeout(3000) })
    .then((r) => console.log(`[ESP32] ${url} → ${r.status}`))
    .catch((e) => console.error(`[ESP32] ${url} failed:`, e.message || e));
}

// In-memory store for NFC UIDs received from ESP32, keyed by timestamp
const nfcUidStore: { uid: string; last4: string; receivedAt: number }[] = [];

interface EncoderIssueResponse {
  ok?: boolean;
  message?: string;
  uid?: string;
  code?: string;
  guest?: unknown;
}

type KeyCardHardwareAction = 'preload' | 'dispense';

const encoderHardwareActionPaths: Record<KeyCardHardwareAction, string> = {
  preload: '/api/preload',
  dispense: '/api/dispense',
};

// ---------------------------------------------------------------------------
// Async passport scanner state
// ---------------------------------------------------------------------------

interface PassportScanData {
  firstName: string;
  lastName: string;
  passportNumber: string;
  passportImageBase64: string;
}

interface ScannerState {
  process: ChildProcess | null;
  status: 'idle' | 'scanning' | 'success' | 'failed';
  data?: PassportScanData;
  error?: string;
  attempts: number;
  startedAt?: number;
}

const scannerState: ScannerState = { process: null, status: 'idle', attempts: 0 };
let scanSession = 0;

function resetScannerState() {
  scanSession++;
  if (scannerState.process) {
    try { scannerState.process.kill('SIGTERM'); } catch { /* already dead */ }
  }
  if (scannerState.status === 'scanning') {
    passportScannerWorker.cancelActiveScan();
  }
  scannerState.process = null;
  scannerState.status = 'idle';
  scannerState.data = undefined;
  scannerState.error = undefined;
  scannerState.attempts = 0;
  scannerState.startedAt = undefined;
}

function sanitizeStanfordEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const safePayload = { ...payload };

  if (typeof safePayload.photoDataUrl === 'string') {
    safePayload.hasPassportPhoto = safePayload.photoDataUrl.length > 0;
    delete safePayload.photoDataUrl;
  }

  if (typeof safePayload.dataUrl === 'string') {
    safePayload.signatureCaptured = safePayload.dataUrl.length > 0;
    delete safePayload.dataUrl;
  }

  return safePayload;
}

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
 * GET /api/checkin/search
 * Smart staff search across confirmation code, guest name, email, phone, and passport.
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query parameter is required' });
      return;
    }

    const parsedLimit = typeof limit === 'string' ? Number.parseInt(limit, 10) : 8;
    const results = await searchReservations(query, Number.isFinite(parsedLimit) ? parsedLimit : 8);
    res.json({ results });
  } catch (error) {
    console.error('[Checkin Route] Search error:', error);
    res.status(500).json({ error: 'Failed to search reservations' });
  }
});

/**
 * GET /api/checkin/profile/:reservationId
 * Staff profile view: reservation + guest + room + latest Stanford session/events.
 */
router.get('/profile/:reservationId', async (req: Request, res: Response) => {
  try {
    const reservationId = Array.isArray(req.params.reservationId)
      ? req.params.reservationId[0]
      : req.params.reservationId;
    const profile = await getReservationProfile(reservationId);
    if (!profile) {
      res.status(404).json({ error: 'Reservation profile not found' });
      return;
    }
    res.json(profile);
  } catch (error) {
    console.error('[Checkin Route] Profile error:', error);
    res.status(500).json({ error: 'Failed to load reservation profile' });
  }
});

/**
 * POST /api/checkin/stanford-event
 * Persist high-value guest/staff events from the Stanford showcase.
 */
router.post('/stanford-event', async (req: Request, res: Response) => {
  try {
    const { reservationId, sessionKey, eventType, eventPayload } = req.body ?? {};
    if (!eventType || typeof eventType !== 'string') {
      res.status(400).json({ success: false, error: 'eventType is required' });
      return;
    }

    const safePayload = sanitizeStanfordEventPayload(
      eventPayload && typeof eventPayload === 'object' ? eventPayload as Record<string, unknown> : {}
    );

    const result = await recordStanfordCheckinEvent({
      reservationId: typeof reservationId === 'string' ? reservationId : undefined,
      sessionKey: typeof sessionKey === 'string' ? sessionKey : undefined,
      eventType,
      eventPayload: safePayload,
    });

    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('[Checkin Route] Stanford event error:', error);
    res.status(500).json({ success: false, error: 'Failed to persist Stanford event' });
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
      const defaultScript = config.passportScannerEngine === 'easyocr'
        ? path.resolve(process.cwd(), 'scripts/scan_passport.py')
        : path.resolve(process.cwd(), 'scripts/scan_passport_poll.py');
      const scriptPath = config.passportScannerScript || defaultScript;
      const pythonBin = config.passportScannerPython;
      const timeout = config.passportScannerTimeout;

      const result = await new Promise<{ success: boolean; data?: Record<string, string>; error?: string }>((resolve) => {
        execFile(pythonBin, [scriptPath], { timeout, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }, (err, stdout, stderr) => {
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

// =============================================================================
// Async Passport Scanner (polling architecture)
// =============================================================================

/**
 * POST /api/checkin/start-passport-scan
 * Spawn the polling Python scanner as a background child process.
 * In mock mode, immediately resolves with simulated data after a delay.
 */
router.post('/start-passport-scan', async (_req: Request, res: Response) => {
  try {
    // If already scanning, stop the old process first
    if (scannerState.process) {
      resetScannerState();
    }

    if (config.passportScannerMode === 'mock') {
      console.log('[Passport Scanner] Starting scan (mock mode)');
      scannerState.status = 'scanning';
      scannerState.startedAt = Date.now();
      scannerState.attempts = 0;
      scannerState.process = null;
      esp32Request('guide/on');
      setTimeout(() => {
        if (scannerState.status === 'scanning') esp32Request('on');
      }, 3000);

      const delay = 20000;
      setTimeout(async () => {
        if (scannerState.status !== 'scanning') return;
        esp32Request('guide/off');
        esp32Request('off');

        const guest = await getGuestByPassport('E1234567A');
        scannerState.attempts = Math.floor(delay / 1000);
        scannerState.status = 'success';
        scannerState.data = {
          firstName: guest?.firstName || 'James',
          lastName: guest?.lastName || 'Chen',
          passportNumber: guest?.passportNumber || 'E1234567A',
          passportImageBase64: '',
        };
        console.log('[Passport Scanner] Mock scan complete:', scannerState.data.firstName, scannerState.data.lastName);
      }, delay);

      res.json({ status: 'scanning' });
      return;
    }

    // Live mode: reuse a persistent EasyOCR worker that was pre-warmed at backend startup.
    if (config.passportScannerEngine !== 'easyocr') {
      console.error(`[Passport Scanner] Unsupported passportScannerEngine='${config.passportScannerEngine}'. Only 'easyocr' is supported now.`);
      scannerState.status = 'failed';
      scannerState.error = 'Unsupported passport scanner engine (expected easyocr).';
      res.json({ status: 'failed', error: scannerState.error });
      return;
    }

    const timeout = Math.floor(config.passportScannerTimeout / 1000);

    const mySession = ++scanSession;
    console.log(`[Passport Scanner] Starting live scan (session ${mySession}) using warm worker (timeout ${timeout}s)`);

    scannerState.status = 'scanning';
    scannerState.startedAt = Date.now();
    scannerState.attempts = 0;
    scannerState.data = undefined;
    scannerState.error = undefined;
    scannerState.process = null;

    await passportScannerWorker.startScan(timeout, {
      onProgress: (progress) => {
        if (mySession !== scanSession) return;
        if (progress.attempt) {
          scannerState.attempts = progress.attempt;
          if (progress.error) {
            console.log(`[Passport Scanner] Attempt ${progress.attempt} ERROR: ${progress.error}`);
          } else if (progress.attempt % 5 === 1) {
            console.log(`[Passport Scanner] Attempt ${progress.attempt} (${progress.elapsed}s elapsed)`);
          }
        } else if (progress.no_mrz_frames && progress.no_mrz_frames % 5 === 1) {
          console.log(`[Passport Scanner] Waiting for passport (${progress.elapsed}s elapsed, ${progress.no_mrz_frames} frames without MRZ)`);
        }
      },
      onResult: (result) => {
        if (mySession !== scanSession) {
          console.log(`[Passport Scanner] Ignoring stale worker result for session ${mySession} (current: ${scanSession})`);
          return;
        }

        scannerState.process = null;
        if (result.success && result.data) {
          const nameParts = (result.data.guest_name || '').trim().split(/\s+/);
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || firstName;
          scannerState.status = 'success';
          scannerState.data = {
            firstName,
            lastName,
            passportNumber: result.data.passport_id || '',
            passportImageBase64: result.data.passport_image_base64 || '',
          };
          console.log(`[Passport Scanner] Success: ${firstName} ${lastName}, passport ${scannerState.data.passportNumber}`);
          return;
        }

        scannerState.status = 'failed';
        scannerState.error = result.error || 'Scanner failed';
        console.log(`[Passport Scanner] Failed: ${scannerState.error}`);
      },
    });

    res.json({ status: 'scanning' });
  } catch (error) {
    console.error('[Checkin Route] Start passport scan error:', error);
    scannerState.status = 'failed';
    scannerState.error = 'Failed to start scanner';
    res.json({ status: 'failed', error: 'Failed to start scanner' });
  }
});

/**
 * GET /api/checkin/passport-scan-status
 * Frontend polls this to check the state of the async passport scan.
 */
router.get('/passport-scan-status', (_req: Request, res: Response) => {
  const elapsed = scannerState.startedAt ? Date.now() - scannerState.startedAt : 0;

  if (scannerState.status === 'success' && scannerState.data) {
    res.json({
      status: 'success',
      data: scannerState.data,
      attempts: scannerState.attempts,
      elapsed,
    });
    return;
  }

  if (scannerState.status === 'failed') {
    res.json({
      status: 'failed',
      error: scannerState.error || 'Unknown error',
      attempts: scannerState.attempts,
      elapsed,
    });
    return;
  }

  res.json({
    status: scannerState.status, // 'idle' or 'scanning'
    attempts: scannerState.attempts,
    elapsed,
  });
});

/**
 * POST /api/checkin/passport-guide-on
 * Turn on the passport guide light before the full scanner starts.
 */
router.post('/passport-guide-on', async (_req: Request, res: Response) => {
  try {
    if (config.passportScannerMode === 'mock') {
      esp32Request('guide/on');
    } else {
      await passportScannerWorker.guideOn();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Passport Scanner] Guide on error:', error);
    res.status(500).json({ success: false, error: 'Failed to turn on passport guide light' });
  }
});

/**
 * POST /api/checkin/stop-passport-scan
 * Kill the running scanner process and reset state. Used for bypass/cancel.
 */
router.post('/stop-passport-scan', (_req: Request, res: Response) => {
  console.log(`[Passport Scanner] Stopping scan (was: ${scannerState.status})`);
  resetScannerState();
  esp32Request('guide/off');
  esp32Request('off');
  passportScannerWorker.guideOff();
  res.json({ success: true });
});

/**
 * POST /api/checkin/save-passport-data
 * Persist the scanned passport fields to the guest record.
 * Called by the frontend after a successful passport scan.
 */
router.post('/save-passport-data', async (req: Request, res: Response) => {
  try {
    const { guestId, passportName, passportNumber, passportImageBase64 } = req.body;
    if (!guestId) {
      res.status(400).json({ success: false, error: 'guestId is required' });
      return;
    }

    const saved = await updateGuestPassportData(guestId, {
      passportName: passportName || '',
      passportNumber: passportNumber || '',
      passportImageBase64: passportImageBase64 || undefined,
    });

    if (saved) {
      console.log(`[Checkin Route] Passport data saved for guest ${guestId}`);
    }

    res.json({ success: saved });
  } catch (error) {
    console.error('[Checkin Route] Save passport data error:', error);
    res.status(500).json({ success: false, error: 'Failed to save passport data' });
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
 * Serial mode: open USB serial port to listen for NFC UIDs from ESP32.
 * WiFi mode (legacy): send encrypted "ACTIVATE" command to ESP32 over WiFi.
 */
router.post('/activate-nfc', async (_req: Request, res: Response) => {
  try {
    if (config.nfcMode === 'serial') {
      const onUid = (uid: string) => {
        const last4 = config.nfcUidToLast4[uid] || '';
        console.log(`[NFC] Serial UID detected: ${uid}, card last4: ${last4 || 'unknown'}`);
        nfcUidStore.push({ uid, last4, receivedAt: Date.now() });
        while (nfcUidStore.length > 20) nfcUidStore.shift();
        // One tap is enough — stop listening to avoid log spam from repeated reads
        stopNfcSerialListener();
      };

      const ok = startNfcSerialListener(config.nfcSerialPort, config.nfcSerialBaud, onUid, {
        acceptAnyData: config.nfcSerialAcceptAny,
        protocol: config.nfcSerialProtocol,
      });
      if (!ok) {
        res.json({ success: false, error: `Failed to open serial port ${config.nfcSerialPort}` });
        return;
      }
      res.json({ success: true });
      return;
    }

    // Legacy WiFi mode
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
    console.error('[NFC] Failed to activate NFC reader:', error);
    res.json({ success: false, error: 'Failed to activate NFC reader' });
  }
});

/**
 * POST /api/checkin/nfc-uid
 * Accepts NFC UID in two formats:
 *   - JSON body with { uid: "09C9C802" } (plain text, used in serial mode)
 *   - text/plain body with AES-128-CBC ciphertext hex (legacy WiFi mode)
 */
router.post('/nfc-uid', async (req: Request, res: Response) => {
  try {
    let uid = '';

    // Try plain JSON body first (serial mode / direct POST)
    if (req.body && typeof req.body === 'object' && req.body.uid) {
      uid = normalizeUid(req.body.uid);
    }

    // Fall back to legacy encrypted path
    if (!uid) {
      let bodyText = '';
      if (typeof req.body === 'string') {
        bodyText = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        bodyText = req.body.toString('ascii');
      }
      bodyText = bodyText.trim();

      if (!bodyText) {
        res.status(400).json({ error: 'Empty body' });
        return;
      }

      // Try as plain hex UID first, then as encrypted ciphertext
      uid = normalizeUid(bodyText);
      if (!uid) {
        const plaintext = decryptFromHex(bodyText);
        if (plaintext) {
          uid = normalizeUid(plaintext);
        }
      }
    }

    if (!uid) {
      console.warn('[NFC] Could not extract valid UID from request');
      res.status(400).json({ error: 'Invalid UID' });
      return;
    }

    const last4 = config.nfcUidToLast4[uid] || '';
    console.log(`[NFC] Received UID: ${uid}, card last4: ${last4 || 'unknown'}`);

    nfcUidStore.push({ uid, last4, receivedAt: Date.now() });
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
 * Clears the NFC UID store (called by frontend to clear stale data).
 * Does NOT stop the serial listener — that auto-stops after the first UID.
 */
router.post('/nfc-clear', (_req: Request, res: Response) => {
  nfcUidStore.length = 0;
  res.json({ success: true });
});

/**
 * POST /api/checkin/key-card-hardware-action
 * Staff-only manual controls for the Stanford card encoder/dispenser.
 */
router.post('/key-card-hardware-action', async (req: Request, res: Response) => {
  try {
    const action = req.body?.action as KeyCardHardwareAction | undefined;

    if (
      !action ||
      !Object.prototype.hasOwnProperty.call(encoderHardwareActionPaths, action)
    ) {
      res.status(400).json({
        success: false,
        error: 'action must be one of: preload, dispense',
      });
      return;
    }

    const actionResponse = await fetch(
      `${config.stanfordEncoderUrl}${encoderHardwareActionPaths[action]}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(action === 'preload' ? 60_000 : 45_000),
      }
    );
    const payload = await actionResponse.json().catch(() => ({})) as EncoderIssueResponse;

    if (!actionResponse.ok || payload.ok === false) {
      res.status(actionResponse.status === 409 ? 409 : actionResponse.ok ? 502 : actionResponse.status).json({
        success: false,
        error: payload.message || `Encoder ${action} responded ${actionResponse.status}`,
      });
      return;
    }

    res.json({
      success: true,
      message: payload.message || `Key-card ${action} complete.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown encoder error';
    console.error('[Stanford Encoder] Failed manual key-card action:', message);
    res.status(502).json({
      success: false,
      error: `Card encoder unavailable: ${message}`,
    });
  }
});

/**
 * POST /api/checkin/issue-key-card
 * Proxies Stanford showcase key-card requests to the Python encoder/dispenser.
 */
router.post('/issue-key-card', async (req: Request, res: Response) => {
  try {
    const guestName = typeof req.body?.guestName === 'string' ? req.body.guestName.trim() : '';
    const roomNumber = typeof req.body?.roomNumber === 'string' ? req.body.roomNumber.trim() : '';
    const cardLabel = typeof req.body?.cardLabel === 'string' ? req.body.cardLabel.trim() : 'Primary';

    if (!guestName) {
      res.status(400).json({ success: false, error: 'guestName is required' });
      return;
    }

    const issueUrl = `${config.stanfordEncoderUrl}/api/issue_card`;
    const issueResponse = await fetch(issueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: guestName,
        room: roomNumber,
        cardLabel: cardLabel || 'Primary',
        preload: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (issueResponse.status === 404) {
      const preloadResponse = await fetch(`${config.stanfordEncoderUrl}/api/preload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });
      const preloadPayload = await preloadResponse.json().catch(() => ({})) as EncoderIssueResponse;

      if (!preloadResponse.ok || preloadPayload.ok === false) {
        res.status(502).json({
          success: false,
          error: preloadPayload.message || `Encoder preload responded ${preloadResponse.status}`,
        });
        return;
      }

      const legacyResponse = await fetch(`${config.stanfordEncoderUrl}/api/issue_primary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guestName }),
        signal: AbortSignal.timeout(90_000),
      });
      const legacyPayload = await legacyResponse.json().catch(() => ({})) as EncoderIssueResponse;

      if (!legacyResponse.ok || legacyPayload.ok === false) {
        res.status(502).json({
          success: false,
          error: legacyPayload.message || `Encoder issue_primary responded ${legacyResponse.status}`,
        });
        return;
      }

      res.json({
        success: true,
        message: legacyPayload.message || 'Key card issued.',
        guest: legacyPayload.guest,
      });
      return;
    }

    const payload = await issueResponse.json().catch(() => ({})) as EncoderIssueResponse;

    if (!issueResponse.ok || payload.ok === false) {
      res.status(issueResponse.ok ? 502 : issueResponse.status).json({
        success: false,
        error: payload.message || `Encoder service responded ${issueResponse.status}`,
      });
      return;
    }

    res.json({
      success: true,
      message: payload.message || 'Key card issued.',
      uid: payload.uid,
      code: payload.code,
      guest: payload.guest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown encoder error';
    console.error('[Stanford Encoder] Failed to issue key card:', message);
    res.status(502).json({
      success: false,
      error: `Card encoder unavailable: ${message}`,
    });
  }
});

export default router;
