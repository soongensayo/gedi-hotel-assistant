import { Router, Request, Response } from 'express';
import {
  chatWithStanfordAvatar,
  clearStanfordAvatarSession,
} from '../services/stanfordAvatarAiService';

const router = Router();

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, sessionId, context } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const sid = typeof sessionId === 'string' && sessionId
      ? sessionId
      : `stanford-avatar-${Date.now()}`;
    const result = await chatWithStanfordAvatar(
      message,
      sid,
      context && typeof context === 'object' ? context as Record<string, unknown> : undefined
    );

    res.json({ ...result, sessionId: sid });
  } catch (error) {
    console.error('[Stanford Avatar Route] Chat error:', error);
    res.status(500).json({ error: 'Failed to process Stanford avatar message' });
  }
});

router.delete('/chat/:sessionId', (req: Request, res: Response) => {
  const sessionId = Array.isArray(req.params.sessionId)
    ? req.params.sessionId[0]
    : req.params.sessionId;
  clearStanfordAvatarSession(sessionId);
  res.json({ success: true });
});

export default router;
