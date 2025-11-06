import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import cors from 'cors';
import morgan from 'morgan';

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));

  app.use(cors({
    origin: false,
    methods: ['POST'],
    optionsSuccessStatus: 204,
  }));

  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.use(express.json({ limit: '10kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(hpp());

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return next();
  });

  const loggerFormat = ':method :url :status :res[content-length] - :response-time ms';
  app.use(morgan(loggerFormat, { stream: process.stdout }));

  app.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Unsupported Media Type' });
    }
    return next();
  });

  app.post('/api/orders', (req, res) => {
    const orderPayload = typeof req.body === 'object' && req.body !== null ? req.body : { raw: req.body };
    console.info('Received order payload:', JSON.stringify(orderPayload, null, 2));

    return res.status(201).json({ status: 'received' });
  });

  app.all('/api/orders', (_req, res) => {
    res.set('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  });

  app.use((req, res) => {
    return res.status(404).json({ error: 'Not Found' });
  });

  app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
};

export { createApp };
