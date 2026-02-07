import { Router, Request, Response } from 'express';
import { generateDIDTalk, getDIDTalkResult, initSimliSession } from '../services/avatarService';
import { config } from '../config';

const router = Router();

/**
 * POST /api/avatar/speak
 * Trigger the avatar to speak the given text.
 * Depending on the provider, returns a video URL or session token.
 */
router.post('/speak', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    if (config.avatarProvider === 'simli') {
      const session = await initSimliSession();
      if (!session) {
        res.status(503).json({ error: 'Simli avatar service not available' });
        return;
      }
      res.json({
        provider: 'simli',
        sessionToken: session.sessionToken,
        streamUrl: session.streamUrl,
      });
    } else if (config.avatarProvider === 'did') {
      const talk = await generateDIDTalk(text);
      if (!talk) {
        res.status(503).json({ error: 'D-ID avatar service not available' });
        return;
      }
      res.json({
        provider: 'did',
        talkId: talk.id,
        status: talk.status,
      });
    } else {
      res.status(400).json({ error: 'Unknown avatar provider' });
    }
  } catch (error) {
    console.error('[Avatar Route] Error:', error);
    res.status(500).json({ error: 'Failed to trigger avatar' });
  }
});

/**
 * GET /api/avatar/status/:talkId
 * Check the status of a D-ID talk generation.
 */
router.get('/status/:talkId', async (req: Request, res: Response) => {
  try {
    const talkId = req.params.talkId as string;
    const result = await getDIDTalkResult(talkId);
    if (!result) {
      res.status(404).json({ error: 'Talk not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    console.error('[Avatar Route] Status error:', error);
    res.status(500).json({ error: 'Failed to get avatar status' });
  }
});

export default router;
