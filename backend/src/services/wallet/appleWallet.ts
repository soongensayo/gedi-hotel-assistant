import { PKPass } from 'passkit-generator';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../../config';
import type { WalletProvider, PassData, GeneratedPass } from './types';

const PASS_ASSETS_DIR = path.resolve(__dirname, 'pass-assets');

// Minimal 1x1 transparent PNG used when no custom images are provided
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==',
  'base64',
);

function loadAsset(filename: string): Buffer {
  const filePath = path.join(PASS_ASSETS_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }
  return PLACEHOLDER_PNG;
}

interface CertificateData {
  signerCert: string;
  signerKey: string;
  wwdr: Buffer;
  signerKeyPassphrase?: string;
}

let cachedCerts: CertificateData | null = null;

function loadCertificates(): CertificateData {
  if (cachedCerts) return cachedCerts;

  const { applePassP12Path, applePassP12Password, appleWwdrCertPath } = config;

  if (!applePassP12Path || !appleWwdrCertPath) {
    throw new Error(
      'Apple Wallet certificates not configured. Set APPLE_PASS_P12_PATH and APPLE_WWDR_CERT_PATH in .env',
    );
  }

  const resolvedP12 = path.resolve(applePassP12Path);
  const resolvedWwdr = path.resolve(appleWwdrCertPath);

  if (!fs.existsSync(resolvedP12)) {
    throw new Error(`P12 certificate not found at: ${resolvedP12}`);
  }
  if (!fs.existsSync(resolvedWwdr)) {
    throw new Error(`WWDR certificate not found at: ${resolvedWwdr}`);
  }

  const password = applePassP12Password || '';
  const envWithPass = { ...process.env, __P12_PASS: password };

  let signerCert: string;
  let signerKey: string;

  // OpenSSL 3.x requires -legacy for older PKCS12 files; try without first, then with
  for (const legacy of ['', ' -legacy']) {
    try {
      signerCert = execSync(
        `openssl pkcs12 -in "${resolvedP12}" -clcerts -nokeys -passin env:__P12_PASS${legacy}`,
        { env: envWithPass, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();

      signerKey = execSync(
        `openssl pkcs12 -in "${resolvedP12}" -nocerts -nodes -passin env:__P12_PASS${legacy}`,
        { env: envWithPass, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString();

      const wwdr = fs.readFileSync(resolvedWwdr);
      cachedCerts = { signerCert, signerKey, wwdr };
      console.log(`[Apple Wallet] Certificates loaded successfully${legacy ? ' (with -legacy flag)' : ''}`);
      return cachedCerts;
    } catch (err) {
      if (legacy) {
        throw new Error(
          `Failed to extract certificates from P12. Check your password and file. OpenSSL error: ${(err as Error).message}`,
        );
      }
      console.log('[Apple Wallet] Retrying with -legacy flag for OpenSSL 3.x...');
    }
  }

  throw new Error('Failed to load certificates');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeRoom(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export const appleWalletProvider: WalletProvider = {
  async generatePass(data: PassData): Promise<GeneratedPass> {
    const certs = loadCertificates();

    const pass = new PKPass(
      {
        'icon.png': loadAsset('icon.png'),
        'icon@2x.png': loadAsset('icon@2x.png'),
        'logo.png': loadAsset('logo.png'),
        'logo@2x.png': loadAsset('logo@2x.png'),
      },
      {
        wwdr: certs.wwdr,
        signerCert: certs.signerCert,
        signerKey: certs.signerKey,
        signerKeyPassphrase: certs.signerKeyPassphrase,
      },
      {
        passTypeIdentifier: config.applePassTypeId,
        teamIdentifier: config.appleTeamId,
        organizationName: data.hotelName,
        description: `${data.hotelName} - Room Key`,
        serialNumber: `${data.keyCardNumber}-${Date.now()}`,
        foregroundColor: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(15, 23, 42)',
        labelColor: 'rgb(196, 162, 101)',
      },
    );

    pass.type = 'generic';

    pass.headerFields.push({
      key: 'room',
      label: 'ROOM',
      value: data.roomNumber,
    });

    pass.primaryFields.push({
      key: 'welcome',
      label: data.hotelName.toUpperCase(),
      value: `Room ${data.roomNumber}`,
    });

    pass.secondaryFields.push(
      {
        key: 'guest',
        label: 'GUEST',
        value: data.guestName,
      },
      {
        key: 'roomType',
        label: 'ROOM TYPE',
        value: `${capitalizeRoom(data.roomType)} · Floor ${data.floor}`,
      },
    );

    pass.auxiliaryFields.push(
      {
        key: 'checkin',
        label: 'CHECK-IN',
        value: formatDate(data.checkInDate),
      },
      {
        key: 'checkout',
        label: 'CHECK-OUT',
        value: formatDate(data.checkOutDate),
      },
      {
        key: 'confirmation',
        label: 'CONFIRMATION',
        value: data.confirmationCode,
      },
    );

    pass.backFields.push(
      {
        key: 'hotelName',
        label: 'Hotel',
        value: data.hotelName,
      },
      {
        key: 'keyCardId',
        label: 'Digital Key ID',
        value: data.keyCardNumber,
      },
      {
        key: 'instructions',
        label: 'How to Use',
        value: 'Present this pass at your room door or show it to hotel staff for access.',
      },
    );

    pass.setBarcodes({
      message: data.keyCardNumber,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText: data.keyCardNumber,
    });

    pass.setRelevantDate(new Date(data.checkInDate));

    const buffer = pass.getAsBuffer();

    return {
      buffer,
      filename: `${data.hotelName.replace(/\s+/g, '-')}-Room-${data.roomNumber}.pkpass`,
      mimeType: 'application/vnd.apple.pkpass',
    };
  },
};
