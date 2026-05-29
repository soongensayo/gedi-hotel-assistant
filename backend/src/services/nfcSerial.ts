import { SerialPort, ReadlineParser } from 'serialport';
import { normalizeUid } from '../utils/nfcCrypto';

type UidCallback = (uid: string) => void;

interface NfcSerialOptions {
  acceptAnyData?: boolean;
  protocol?: 'line' | 'pn532_uart';
}

let activePort: SerialPort | null = null;
let activeParser: ReadlineParser | null = null;
let activePollTimer: ReturnType<typeof setInterval> | null = null;
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

  if (options.protocol === 'pn532_uart') {
    startPn532UartPolling(activePort, (uid) => dispatchUid(uid, 'PN532 UART poll'));
  }

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
        (options.protocol === 'pn532_uart'
          ? ' (PN532 UART polling mode)'
          : options.acceptAnyData
            ? ' (accept-any-data demo mode)'
            : ''),
    );
  });

  return true;
}

/** Close the serial port if open. */
export function stopNfcSerialListener(): void {
  if (activePollTimer) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }
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

function startPn532UartPolling(port: SerialPort, onUid: UidCallback): void {
  let buffer = Buffer.alloc(0);
  let configured = false;
  let lastCommandAt = 0;

  const writeFrame = (payload: number[]) => {
    if (!port.isOpen) return;
    port.write(buildPn532Frame(payload), (err) => {
      if (err) console.error('[NFC Serial] PN532 write error:', err.message);
    });
  };

  const wakeAndConfigure = () => {
    if (!port.isOpen) return;
    port.write(Buffer.from([0x55, 0x55, 0x00, 0x00, 0x00]));
    setTimeout(() => writeFrame([0xd4, 0x14, 0x01, 0x14, 0x01]), 80);
    configured = true;
  };

  const pollForCard = () => {
    if (!port.isOpen || Date.now() - lastCommandAt < 250) return;
    if (!configured) wakeAndConfigure();
    writeFrame([0xd4, 0x4a, 0x01, 0x00]);
    lastCommandAt = Date.now();
  };

  port.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 512) buffer = buffer.subarray(buffer.length - 512);

    const uid = extractPn532Uid(buffer);
    if (uid) {
      onUid(uid);
    }
  });

  activePollTimer = setInterval(pollForCard, 650);
}

function buildPn532Frame(payload: number[]): Buffer {
  const len = payload.length & 0xff;
  const lcs = (0x100 - len) & 0xff;
  const dcs = (0x100 - (payload.reduce((sum, value) => sum + value, 0) & 0xff)) & 0xff;
  return Buffer.from([0x00, 0x00, 0xff, len, lcs, ...payload, dcs, 0x00]);
}

function extractPn532Uid(buffer: Buffer): string {
  for (let i = 0; i <= buffer.length - 12; i += 1) {
    if (buffer[i] !== 0x00 || buffer[i + 1] !== 0x00 || buffer[i + 2] !== 0xff) continue;

    const len = buffer[i + 3];
    const lcs = buffer[i + 4];
    if (((len + lcs) & 0xff) !== 0) continue;

    const dataStart = i + 5;
    const dataEnd = dataStart + len;
    if (dataEnd + 2 > buffer.length) continue;

    const data = buffer.subarray(dataStart, dataEnd);
    if (data.length < 8 || data[0] !== 0xd5 || data[1] !== 0x4b || data[2] < 1) continue;

    const uidLength = data[7];
    if (uidLength < 4 || uidLength > 10 || data.length < 8 + uidLength) continue;

    const uid = data.subarray(8, 8 + uidLength).toString('hex').toUpperCase();
    if (normalizeUid(uid)) return uid;
  }

  return '';
}
