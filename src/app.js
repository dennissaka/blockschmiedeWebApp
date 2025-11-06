import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import cors from 'cors';
import morgan from 'morgan';
import nodemailer from 'nodemailer';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { config } from './config.js';

const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const mailTransport = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.secure,
  auth: config.mail.auth,
});

const targetProductId = config.shopify.targetProductId;

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

  app.use(express.json({ limit: '10mb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));
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

  app.post('/api/orders', async (req, res, next) => {
    try {
      const orderPayload = typeof req.body === 'object' && req.body !== null ? req.body : null;

      if (!orderPayload) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      const rawOrderId = orderPayload.id;

      let orderId;
      if (typeof rawOrderId === 'string' && rawOrderId.trim() !== '') {
        if (!/^\d+$/.test(rawOrderId)) {
          return res.status(400).json({ error: 'Order id must be a numeric string' });
        }
        orderId = rawOrderId;
      } else if (typeof rawOrderId === 'number' && Number.isSafeInteger(rawOrderId) && rawOrderId > 0) {
        orderId = String(rawOrderId);
      } else if (typeof rawOrderId === 'bigint') {
        orderId = rawOrderId.toString();
      } else {
        return res.status(400).json({ error: 'Missing order id' });
      }

      const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items : [];
      const containsTargetProduct = lineItems.some((item) => String(item?.product_id ?? '') === targetProductId);

      if (!containsTargetProduct) {
        return res.status(202).json({ status: 'ignored', reason: 'product_mismatch' });
      }

      const financialStatus = orderPayload.financial_status?.toLowerCase?.();
      const cancelledAt = orderPayload.cancelled_at ?? orderPayload.cancelledAt ?? null;
      const isSuccessful = financialStatus === 'paid' && (cancelledAt === null || cancelledAt === undefined);

      if (!isSuccessful) {
        return res.status(202).json({ status: 'ignored', reason: 'unsuccessful_order' });
      }

      const recipient = orderPayload.email ?? orderPayload.contact_email ?? orderPayload.contactEmail ?? orderPayload?.customer?.email;

      if (!recipient) {
        return res.status(400).json({ error: 'No recipient email available for order' });
      }

      const createdAt = new Date(orderPayload.created_at ?? orderPayload.createdAt ?? Date.now());
      if (Number.isNaN(createdAt.getTime())) {
        return res.status(400).json({ error: 'Invalid created_at timestamp' });
      }

      const processedAtValue = orderPayload.processed_at ?? orderPayload.processedAt ?? null;
      const processedAt = processedAtValue ? new Date(processedAtValue) : null;
      const cancelledAtDate = cancelledAt ? new Date(cancelledAt) : null;

      const connection = await pool.getConnection();
      let token;

      try {
        const [existingOrders] = await connection.execute(
          'SELECT token FROM shopify_order_emails WHERE order_id = ? LIMIT 1',
          [orderId],
        );

        if (Array.isArray(existingOrders) && existingOrders.length > 0) {
          return res.status(200).json({ status: 'already_processed' });
        }

        token = crypto.randomBytes(48).toString('hex');

        const insertQuery = `
          INSERT INTO shopify_order_emails (
            order_id,
            order_number,
            order_name,
            email,
            contact_email,
            customer_email,
            token,
            customer_first_name,
            customer_last_name,
            billing_name,
            shipping_name,
            created_at,
            processed_at,
            cancelled_at,
            financial_status,
            test
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
          orderId,
          orderPayload.order_number ?? null,
          orderPayload.name ?? null,
          orderPayload.email ?? null,
          orderPayload.contact_email ?? orderPayload.contactEmail ?? null,
          orderPayload?.customer?.email ?? null,
          token,
          orderPayload?.customer?.first_name ?? orderPayload?.customer?.firstName ?? null,
          orderPayload?.customer?.last_name ?? orderPayload?.customer?.lastName ?? null,
          orderPayload?.billing_address?.name ?? null,
          orderPayload?.shipping_address?.name ?? null,
          createdAt,
          processedAt && !Number.isNaN(processedAt.getTime()) ? processedAt : null,
          cancelledAtDate && !Number.isNaN(cancelledAtDate.getTime()) ? cancelledAtDate : null,
          orderPayload.financial_status ?? null,
          Boolean(orderPayload.test),
        ];

        await connection.execute(insertQuery, values);
      } finally {
        connection.release();
      }

      const showroomLink = `https://blockschmiede.com/showroom.html?token=${encodeURIComponent(token)}`;

      const subject = 'Blockschmiede Adventskalender - Showroom Zugang';
      const introText =
        'Mit dieser erhältst du Zugriff auf den Blockschmiede Adventskalender Showroom und damit auf exklusive Inhalte wie z.B. die Kalendernummer für die Auslosungen oder eine Grafik des Adventkalenders in hochauflösung perfekt für den Druck.';

      await mailTransport.sendMail({
        from: config.mail.from,
        to: recipient,
        subject,
        text: `${subject}\n\n${introText}\n\nDein persönlicher Zugangscode: ${token}\n\nZum Showroom: ${showroomLink}`,
        html: `
          <h1>${subject}</h1>
          <p>${introText}</p>
          <p><strong>Dein persönlicher Zugangscode:</strong> ${token}</p>
          <p><a href="${showroomLink}" target="_blank" rel="noopener">Zum Showroom</a></p>
        `,
      });

      return res.status(201).json({ status: 'stored', token });
    } catch (error) {
      console.error('Failed to process order payload', error);
      return next(error);
    }
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
