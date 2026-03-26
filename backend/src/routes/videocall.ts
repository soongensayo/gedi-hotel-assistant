import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import zlib from 'zlib';

const router = Router();

const APP_ID = process.env.AGORA_APP_ID || '43290892f6d14bebbccd6f05b2bdf9b9';
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '3baec61a186645c5a0ea5a11a1de829a';
const CHANNEL_NAME = process.env.AGORA_CHANNEL || 'frontdesk';
const TOKEN_EXPIRY_SECONDS = 3600;

// If set, this pre-generated token is used directly (bypasses inline generation).
// Generate one from: Agora Console → your project → "Generate Temp Token" → channel: hotel-front-desk
const TEMP_TOKEN = process.env.AGORA_TEMP_TOKEN || '';

// =============================================================================
// Agora AccessToken2 — inline implementation (no npm package required)
// Based on Agora's open-source token builder algorithm
// =============================================================================

const PRIVILEGE_JOIN_CHANNEL = 1;
const PRIVILEGE_PUBLISH_AUDIO = 2;
const PRIVILEGE_PUBLISH_VIDEO = 3;

function packUint16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function packUint32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function packString(s: string): Buffer {
  const str = Buffer.from(s, 'utf8');
  return Buffer.concat([packUint16(str.length), str]);
}

function packPrivileges(privileges: Map<number, number>): Buffer {
  let buf = packUint16(privileges.size);
  privileges.forEach((expTs, priv) => {
    buf = Buffer.concat([buf, packUint16(priv), packUint32(expTs)]);
  });
  return buf;
}

// CRC32 lookup table
const CRC32_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return ((crc ^ 0xffffffff) >>> 0);
}

function buildRtcToken(appId: string, appCert: string, channelName: string, uid: number, expireSeconds: number): string {
  const salt = (Math.random() * 0xffffffff) >>> 0;
  const ts = (Math.floor(Date.now() / 1000) + expireSeconds) >>> 0;
  const uidStr = uid === 0 ? '' : String(uid);

  const privileges = new Map<number, number>([
    [PRIVILEGE_JOIN_CHANNEL, ts],
    [PRIVILEGE_PUBLISH_AUDIO, ts],
    [PRIVILEGE_PUBLISH_VIDEO, ts],
  ]);

  // The signing message matches the Agora AccessToken v1 spec exactly
  const msgToSign = Buffer.concat([
    packString(appId),
    packUint32(salt),
    packUint32(ts),
    packPrivileges(privileges),
    packString(channelName),
    packString(uidStr),
  ]);

  const signature = crypto
    .createHmac('sha256', Buffer.from(appCert, 'utf8'))
    .update(msgToSign)
    .digest();

  // Build the raw content buffer
  const content = Buffer.concat([
    packUint32(crc32(Buffer.from(channelName, 'utf8'))),
    packUint32(crc32(Buffer.from(uidStr, 'utf8'))),
    packUint32(salt),
    packUint32(ts),
    packPrivileges(privileges),
    packUint16(signature.length),
    signature,
  ]);

  // Agora requires DEFLATE compression before base64 — this was the missing step
  const compressed = zlib.deflateRawSync(content);
  return `006${appId}${compressed.toString('base64')}`;
}

// -----------------------------------------------------------------------------
// POST /api/videocall/token
// Returns channel config for the front-desk video call.
//
// TOKEN MODE:
//   If AGORA_USE_TOKEN=true in your .env, a signed RTC token is generated and
//   returned (requires "App Certificate" to be enabled in the Agora console).
//
// TEST MODE (default for demos):
//   Returns token: null — works when "App Certificate" is disabled in the
//   Agora console (Project Settings → toggle off "Primary Certificate").
//   This is the recommended setup for a school project demo.
// -----------------------------------------------------------------------------
router.post('/token', (_req: Request, res: Response) => {
  const uid = 0;
  let token: string | null = null;

  if (TEMP_TOKEN) {
    // Fastest path for demos: use the pre-generated token from the Agora console.
    // Generate at: console.agora.io → your project → "Generate Temp Token" → channel: hotel-front-desk
    token = TEMP_TOKEN;
    console.log('[VideoCall] Using pre-generated temp token from AGORA_TEMP_TOKEN');
  } else if (process.env.AGORA_USE_TOKEN === 'true') {
    try {
      token = buildRtcToken(APP_ID, APP_CERTIFICATE, CHANNEL_NAME, uid, TOKEN_EXPIRY_SECONDS);
      console.log('[VideoCall] Generated RTC token via inline builder');
    } catch (err) {
      console.error('[VideoCall] Token generation failed:', err);
      return res.status(500).json({ error: 'Failed to generate call token' });
    }
  } else {
    // Test mode: null token — requires App Certificate to be disabled in Agora console
    console.log('[VideoCall] Using null token (test mode)');
  }

  res.json({
    token,
    appId: APP_ID,
    channel: CHANNEL_NAME,
    uid,
    expiresIn: TOKEN_EXPIRY_SECONDS,
  });
});

export default router;
