import { SerialPort, ReadlineParser } from 'serialport';
import { normalizeUid } from '../utils/nfcCrypto';

type UidCallback = (uid: string) => void;

interface NfcSerialOptions {
  acceptAnyData?: boolean;
}

let activePort: SerialPort | null = null;
let activeParser: ReadlineParser | null = null;
let opening = false;

/**
 * Open the serial port and listen for NFC UIDs printed by the ESP32.
 * Each line is expected to be an uppercase hex UID (e.g. "09C9C802").
 * Returns true if the port was opened (or is already open/opening), false on error.
 */
export function startNfcSerialListener(
  portPath: string,
  baudRate: number,
  onUid: UidCallback,
  options: NfcSerialOptions = {},
): boolean {
  if (activePort?.isOpen || opening) {
    console.log('[NFC Serial] Already listening or opening — skipping duplicate start');
    return true;
  }

  opening = true;

  try {
    activePort = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  } catch (err) {
    console.error(`[NFC Serial] Failed to create port ${portPath}:`, err);
    opening = false;
    return false;
  }

  const openedAt = Date.now();
  let dispatched = false;

  const dispatchUid = (uid: string, source: string) => {
    if (dispatched) return;
    dispatched = true;
    console.log(`[NFC Serial] UID detected from ${source}: ${uid}`);
    onUid(uid);
  };

  const maybeDispatchRawChunk = (chunk: Buffer) => {
    if (!options.acceptAnyData || dispatched) return;
    if (Date.now() - openedAt < 800) return;

    const text = chunk.toString('utf8').trim();
    const normalized = normalizeUid(text);
    const uid = normalized || chunk.toString('hex').toUpperCase() || '532';
    dispatchUid(uid, 'raw serial data');
  };

  activePort.on('data', maybeDispatchRawChunk);

  activeParser = activePort.pipe(new ReadlineParser({ delimiter: '\n' }));

  activeParser.on('data', (line: string) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;

    const uid = normalizeUid(trimmed);
    if (!uid) return;

    dispatchUid(uid, 'serial line');
  });

  activePort.on('error', (err) => {
    console.error('[NFC Serial] Port error:', err.message);
  });

  activePort.on('close', () => {
    console.log('[NFC Serial] Port closed');
    activePort = null;
    activeParser = null;
    opening = false;
  });

  activePort.open((err) => {
    opening = false;
    if (err) {
      console.error(`[NFC Serial] Failed to open ${portPath}:`, err.message);
      activePort = null;
      activeParser = null;
      return;
    }
    console.log(
      `[NFC Serial] Listening on ${portPath} @ ${baudRate} baud` +
        (options.acceptAnyData ? ' (accept-any-data demo mode)' : ''),
    );
  });

  return true;
}

/** Close the serial port if open. */
export function stopNfcSerialListener(): void {
  if (activePort?.isOpen) {
    console.log(`[NFC Serial] Closing ${activePort.path}`);
    activePort.close();
  }
  activePort = null;
  activeParser = null;
  opening = false;
}

/** Check whether the serial listener is currently active. */
export function isNfcSerialActive(): boolean {
  return !!activePort?.isOpen || opening;
}
