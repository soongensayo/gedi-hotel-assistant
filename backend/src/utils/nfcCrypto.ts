import crypto from 'crypto';
import { config } from '../config';

const BLOCK_SIZE = 16;
const FIXED_IV = Buffer.alloc(BLOCK_SIZE, 0);

function getKeyBytes(): Buffer | null {
  const key = config.nfcSharedSecretKey;
  if (!key || key.length !== 16) {
    return null;
  }
  return Buffer.from(key, 'utf-8');
}

function pkcs7Pad(data: Buffer): Buffer {
  const padLen = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  return Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
}

function pkcs7Unpad(data: Buffer): Buffer | null {
  if (data.length === 0) return null;
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > BLOCK_SIZE) return null;
  if (data.length < padLen) return null;
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) return null;
  }
  return data.subarray(0, data.length - padLen);
}

export function encryptToHex(plaintext: string): string | null {
  const key = getKeyBytes();
  if (!key) return null;
  const padded = pkcs7Pad(Buffer.from(plaintext, 'utf-8'));
  const cipher = crypto.createCipheriv('aes-128-cbc', key, FIXED_IV);
  cipher.setAutoPadding(false);
  const ct = Buffer.concat([cipher.update(padded), cipher.final()]);
  return ct.toString('hex');
}

export function decryptFromHex(hexCiphertext: string): string | null {
  const key = getKeyBytes();
  if (!key) return null;
  const trimmed = hexCiphertext.trim();
  let ct: Buffer;
  try {
    ct = Buffer.from(trimmed, 'hex');
  } catch {
    return null;
  }
  if (ct.length === 0 || ct.length % BLOCK_SIZE !== 0) return null;
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, FIXED_IV);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(ct), decipher.final()]);
  const raw = pkcs7Unpad(padded);
  if (!raw) return null;
  try {
    return raw.toString('utf-8');
  } catch {
    return null;
  }
}

export function normalizeUid(raw: string): string {
  const cleaned = (raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!cleaned) return '';
  try {
    BigInt('0x' + cleaned);
    return cleaned;
  } catch {
    return '';
  }
}

export function isNfcConfigured(): boolean {
  return !!getKeyBytes();
}
