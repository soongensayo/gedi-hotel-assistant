import { Router, Request, Response } from 'express';
import { chat, clearSession } from '../services/aiService';

const router = Router();

/**
 * POST /api/chat
 * Send a message to the AI concierge and get a response.
 * Returns { reply, actions, sessionId } where actions are UI commands.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const sid = sessionId || `anonymous-${Date.now()}`;
    const { reply, actions } = await chat(message, sid, context);

    res.json({ reply, actions, sessionId: sid });
  } catch (error) {
    console.error('[Chat Route] Error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * DELETE /api/chat/:sessionId
 * Clear conversation history for a session.
 */
router.delete('/:sessionId', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  clearSession(sessionId);
  res.json({ success: true });
});

export default router;
