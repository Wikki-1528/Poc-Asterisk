import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../logger';

const router = Router();

router.post('/call/outbound', (req: Request, res: Response) => {
  const { phoneNumber, systemPrompt, languageHint, voice, templateContext } = req.body as {
    phoneNumber?: string;
    systemPrompt?: string;
    languageHint?: string;
    voice?: string;
    templateContext?: Record<string, string>;
  };

  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' });
    return;
  }

  const callId = crypto.randomUUID();

  logger.info({ callId, phoneNumber, systemPrompt, languageHint, voice, templateContext }, 'Outbound call queued');

  res.status(200).json({ success: true, message: 'Outbound call queued', callId });
});

export default router;
