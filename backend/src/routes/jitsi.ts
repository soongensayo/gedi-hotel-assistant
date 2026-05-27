import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const router = Router();

type JitsiTokenRequest = {
  roomName?: string;
  displayName?: string;
  role?: 'guest' | 'staff';
};

function base64url(value: Buffer | string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getPrivateKey() {
  if (config.jaasPrivateKey) return config.jaasPrivateKey;
  if (config.jaasPrivateKeyPath) {
    const candidates = [
      config.jaasPrivateKeyPath,
      path.resolve(process.cwd(), config.jaasPrivateKeyPath),
      path.resolve(process.cwd(), '..', config.jaasPrivateKeyPath),
      path.resolve(__dirname, '../../../', config.jaasPrivateKeyPath),
    ];
    const keyPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (keyPath) {
      return fs.readFileSync(keyPath, 'utf8');
    }
  }
  return '';
}

function roomClaim(roomName: string) {
  const appPrefix = `${config.jaasAppId}/`;
  return roomName.startsWith(appPrefix) ? roomName.slice(appPrefix.length) : roomName;
}

function signJaasJwt({
  roomName,
  displayName,
  role,
}: {
  roomName: string;
  displayName: string;
  role: 'guest' | 'staff';
}) {
  const privateKey = getPrivateKey();
  if (!config.jaasAppId || !config.jaasKid || !privateKey) {
    const missing = [
      !config.jaasAppId && 'JAAS_APP_ID',
      !config.jaasKid && 'JAAS_KID',
      !privateKey && 'JAAS_PRIVATE_KEY or readable JAAS_PRIVATE_KEY_PATH',
    ].filter(Boolean);
    throw new Error(`JaaS is not configured. Missing: ${missing.join(', ')}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const room = roomClaim(roomName);
  const header = {
    alg: 'RS256',
    kid: config.jaasKid,
    typ: 'JWT',
  };
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: config.jaasAppId,
    room,
    nbf: now - 10,
    exp: now + config.jaasTokenTtlSeconds,
    context: {
      user: {
        id: `${role}-${crypto.randomUUID()}`,
        name: displayName,
        moderator: role === 'staff' ? 'true' : 'false',
      },
      features: {
        livestreaming: false,
        'outbound-call': false,
        recording: false,
        transcription: false,
      },
      room: {
        regex: false,
      },
    },
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

router.post('/token', (req: Request<unknown, unknown, JitsiTokenRequest>, res: Response) => {
  const roomName = String(req.body.roomName || '').trim();
  const displayName = String(req.body.displayName || 'LuxeDrive').trim();
  const role = req.body.role === 'staff' ? 'staff' : 'guest';

  if (!roomName) {
    return res.status(400).json({ error: 'roomName is required' });
  }

  try {
    const token = signJaasJwt({ roomName, displayName, role });
    res.json({
      token,
      expiresIn: config.jaasTokenTtlSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sign JaaS token';
    console.error('[Jitsi] Token generation failed:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
