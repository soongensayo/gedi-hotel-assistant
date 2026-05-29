import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.warn(`[Config] Failed to load .env from ${envPath}: ${result.error.message}`);
  } else {
    console.log(`[Config] Loaded .env from ${envPath}`);
  }
} else {
  console.warn(`[Config] No .env file found. Checked: ${envCandidates.join(', ')}`);
}

export const config = {
  // Server
  port: parseInt(process.env.BACKEND_PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Avatar
  simliApiKey: process.env.SIMLI_API_KEY || '',
  simliFaceId: process.env.SIMLI_FACE_ID || '',
  didApiKey: process.env.DID_API_KEY || '',
  avatarProvider: (process.env.AVATAR_PROVIDER || 'simli') as 'simli' | 'did',

  // AI
  aiProvider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'gemini',

  // TTS
  ttsVoice: process.env.TTS_VOICE || 'nova',

  // Hardware
  hardwareMode: (process.env.HARDWARE_MODE || 'mock') as 'mock' | 'jetson',

  // ESP32 Flash Light
  esp32FlashIp: (process.env.ESP32_FLASH_IP || process.env.ESP32_IP || '').trim(),

  // Passport Scanner
  passportScannerMode: (process.env.PASSPORT_SCANNER_MODE || 'mock') as 'mock' | 'live',
  passportScannerEngine: (process.env.PASSPORT_SCANNER_ENGINE || 'tesseract') as 'tesseract' | 'easyocr',
  passportScannerPython: process.env.PASSPORT_SCANNER_PYTHON || 'python3',
  passportScannerScript: process.env.PASSPORT_SCANNER_SCRIPT || '',
  passportScannerTimeout: parseInt(process.env.PASSPORT_SCANNER_TIMEOUT || '120000', 10),

  // NFC Card Reader
  nfcMode: (process.env.NFC_MODE || 'serial') as 'serial' | 'wifi',
  nfcSerialPort: process.env.NFC_SERIAL_PORT || '/dev/ttyUSB0',
  nfcSerialBaud: parseInt(process.env.NFC_SERIAL_BAUD || '115200', 10),
  nfcSerialAcceptAny: (process.env.NFC_SERIAL_ACCEPT_ANY || '').toLowerCase() === 'true',
  nfcSerialProtocol: (process.env.NFC_SERIAL_PROTOCOL || 'line') as 'line' | 'pn532_uart',
  // Legacy WiFi mode settings (only used when NFC_MODE=wifi)
  nfcSharedSecretKey: process.env.NFC_SHARED_SECRET_KEY || '',
  esp32WifiStartUrl: process.env.ESP32_WIFI_START_URL || '',
  nfcUidToLast4: (() => {
    try {
      return JSON.parse(process.env.NFC_UID_TO_LAST4 || '{"09C9C802":"5264"}');
    } catch {
      return { '09C9C802': '5264' };
    }
  })() as Record<string, string>,

  // Stanford showcase card encoder/dispenser service
  stanfordEncoderUrl: (process.env.STANFORD_ENCODER_URL || 'http://localhost:5000').replace(/\/$/, ''),

  // Jitsi as a Service (JaaS)
  jaasAppId: process.env.JAAS_APP_ID || process.env.VITE_JITSI_APP_ID || '',
  jaasKid: process.env.JAAS_KID || '',
  jaasPrivateKey: (process.env.JAAS_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  jaasPrivateKeyPath: process.env.JAAS_PRIVATE_KEY_PATH || '',
  jaasTokenTtlSeconds: parseInt(process.env.JAAS_TOKEN_TTL_SECONDS || '7200', 10),

  // Sesto Robot
  sestoApiUrl: process.env.SESTO_API_URL || '',

  // Hotel
  hotelName: process.env.HOTEL_NAME || 'The Grand Azure Hotel',

  // Apple Wallet
  applePassTypeId: process.env.APPLE_PASS_TYPE_ID || '',
  appleTeamId: process.env.APPLE_TEAM_ID || '',
  applePassP12Path: process.env.APPLE_PASS_P12_PATH || '',
  applePassP12Password: process.env.APPLE_PASS_P12_PASSWORD || '',
  appleWwdrCertPath: process.env.APPLE_WWDR_CERT_PATH || '',

  // Email (SMTP)
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || `"The Grand Azure Hotel" <${process.env.SMTP_USER || 'noreply@hotel.com'}>`,
};

/** Validate that critical API keys are set */
export function validateConfig(): string[] {
  const warnings: string[] = [];

  if (!config.openaiApiKey) {
    warnings.push('OPENAI_API_KEY is not set. AI chat, TTS, and STT will not work.');
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    warnings.push('Supabase credentials not set. Using mock hotel data from memory.');
  }
  if (!config.simliApiKey && !config.didApiKey) {
    warnings.push('No avatar API key set. Avatar features will be disabled.');
  }
  if (!config.applePassTypeId || !config.appleTeamId || !config.applePassP12Path) {
    warnings.push('Apple Wallet not configured. Digital key card passes will be disabled.');
  }
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    warnings.push('SMTP not configured. Check-in confirmation emails will be disabled.');
  }

  return warnings;
}
