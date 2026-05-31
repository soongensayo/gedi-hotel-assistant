import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config, validateConfig } from './config';
import { errorHandler } from './middleware/errorHandler';
import { setupSocketIO } from './socket';
import { passportScannerWorker } from './services/passportScannerWorker';

// Clear stale debug images from previous sessions on every startup.
const debugDir = path.resolve(__dirname, '../../../camera-and-nfc/Identification-and-payment-app/debug');
if (fs.existsSync(debugDir)) {
  fs.readdirSync(debugDir, { recursive: true, withFileTypes: true })
    .filter(f => f.isFile() && /\.(png|jpg|jpeg)$/i.test(f.name))
    .forEach(f => {
      try { fs.unlinkSync(path.join(f.parentPath ?? (f as any).path, f.name)); } catch { /* ignore */ }
    });
  console.log('[Startup] Cleared debug images from previous session.');
}

// Routes
import chatRoutes from './routes/chat';
import voiceRoutes from './routes/voice';
import avatarRoutes from './routes/avatar';
import hotelRoutes from './routes/hotel';
import checkinRoutes from './routes/checkin';
import videocallRoutes from './routes/videocall';
import jitsiRoutes from './routes/jitsi';
import stanfordAvatarRoutes from './routes/stanfordAvatar';

const app = express();
const server = http.createServer(app);

// --- Middleware ---
const isDev = config.nodeEnv !== 'production';
app.use(cors({
  origin: isDev
    ? true
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- API Routes ---
app.use('/api/chat', chatRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/avatar', avatarRoutes);
app.use('/api/hotel', hotelRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/videocall', videocallRoutes);
app.use('/api/jitsi', jitsiRoutes);
app.use('/api/stanford-avatar', stanfordAvatarRoutes);

// --- Health check ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hardwareMode: config.hardwareMode,
    aiProvider: config.aiProvider,
    avatarProvider: config.avatarProvider,
  });
});

// --- Error handler ---
app.use(errorHandler);

// --- Socket.IO ---
setupSocketIO(server);

// --- Start server ---
server.listen(config.port, () => {
  console.log('');
  console.log('==========================================================');
  console.log(`  🏨 AI Hotel Check-in Kiosk — Backend`);
  console.log(`  🌐 Server running on http://localhost:${config.port}`);
  console.log(`  🔧 Hardware mode: ${config.hardwareMode}`);
  console.log(`  🤖 AI provider: ${config.aiProvider}`);
  console.log(`  🎭 Avatar provider: ${config.avatarProvider}`);
  console.log(`  📷 Passport scanner: ${config.passportScannerMode}`);
  console.log(`  💳 NFC reader: ${config.nfcMode} mode${config.nfcMode === 'serial' ? ` (${config.nfcSerialPort})` : config.nfcSharedSecretKey ? ' (key set)' : ' (not configured)'}`);
  console.log('==========================================================');

  // Validate configuration and print warnings
  const warnings = validateConfig();
  if (warnings.length > 0) {
    console.log('');
    console.log('⚠️  Configuration warnings:');
    warnings.forEach((w) => console.log(`   - ${w}`));
    console.log('');
    console.log('   The server will use mock/fallback data where needed.');
    console.log('   Set the appropriate keys in .env to enable full features.');
  }

  if (config.passportScannerMode === 'live' && config.passportScannerEngine === 'easyocr') {
    console.log('[Startup] Pre-warming EasyOCR passport worker...');
    void passportScannerWorker.prewarm()
      .then((result) => {
        console.log(`[Startup] Passport worker ready (${result.cached ? 'cached' : `${result.warmup_seconds ?? 0}s warmup`}).`);
      })
      .catch((err) => {
        console.error('[Startup] Passport worker warmup failed:', err instanceof Error ? err.message : String(err));
      });
  }

  console.log('');
});

export default app;
