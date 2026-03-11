import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import logger from './logger';
import healthRouter from './routes/health';
import outboundRouter from './routes/outbound';
import { initBridge } from './bridge/index';

const app = express();

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip ?? '';
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  if (!isLocalhost && config.ALLOWED_IPS.length > 0 && !config.ALLOWED_IPS.includes(ip)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
});

app.use('/', healthRouter);
app.use('/', outboundRouter);

const server = http.createServer(app);

initBridge(server);

server.listen(config.PORT, () => {
  logger.info(`callmetrik-bridge listening on port ${config.PORT}`);
});

export { app, server };
