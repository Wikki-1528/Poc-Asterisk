import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'callmetrik-bridge',
    timestamp: new Date(),
  });
});

export default router;
