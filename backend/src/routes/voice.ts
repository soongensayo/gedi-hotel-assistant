import { Router, Request, Response } from 'express';
import multer from 'multer';
import { textToSpeech } from '../services/ttsService';
import { speechToText } from '../services/sttService';

const router = Router();

// Multer for handling audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

/**
 * POST /api/voice/tts
 * Convert text to speech. Returns audio/mpeg.
 */
router.post('/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const audioBuffer = await textToSpeech(text, voice);

    if (audioBuffer.length === 0) {
      res.status(503).json({ error: 'TTS service not available' });
      return;
    }

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length.toString(),
    });
    res.send(audioBuffer);
  } catch (error) {
    console.error('[TTS Route] Error:', error);
    res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});

/**
 * POST /api/voice/stt
 * Transcribe audio to text. Expects multipart form with 'audio' field.
 */
router.post('/stt', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Audio file is required' });
      return;
    }

    const text = await speechToText(req.file.buffer, req.file.originalname);
    res.json({ text });
  } catch (error) {
    console.error('[STT Route] Error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

export default router;
