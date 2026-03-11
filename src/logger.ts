import pino from 'pino';

const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

const logger = pino(
  isDev
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: 'info',
      }
);

export default logger;
