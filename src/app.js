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

const allowedOrigins = new Set([
  'https://blockschmiede.com',
  'https://www.blockschmiede.com',
]);


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

export async function testDbConnection(poolToUse = pool) {
  try {
    const [rows] = await poolToUse.query(
      'SELECT NOW() AS now'
    );
    console.log('✅ DB connection OK', rows[0]);
  } catch (err) {
    console.error('❌ DB connection FAILED:', err);
    throw err; // wichtig: nach außen geben, damit server.js abbrechen kann
  }
}

export async function testMailConnection(transportToUse = mailTransport) {
  try {
    console.log('Testing mail connection...');
    console.log({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.auth,
    });
    await transportToUse.verify();
    console.log('✅ Mail connection OK');
  } catch (err) {
    console.error('❌ Mail connection FAILED:', err);
    throw err;
  }
}

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // 2) CORS-Options
  const corsOptions = {
    origin(origin, cb) {
      // Ohne Origin (z.B. curl/Postman) keine CORS-Header — ok für Browser-Schutz.
      if (!origin) return cb(null, false);
      return cb(null, allowedOrigins.has(origin) ? origin : false);
    },
    // Falls du Cookies/Session brauchst → auf true stellen und Client mit credentials: 'include' aufrufen.
    credentials: false,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // Preflight cachen
    optionsSuccessStatus: 204,
  };

  // 3) CORS Middlewares: globale Header + Preflight beantworten
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions)); // beantwortet OPTIONS vor deinen Routen

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
        console.log('Invalid JSON payload');
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      const rawOrderId = orderPayload.id;

      let orderId;
      orderId = String(rawOrderId);

      const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items : [];
      const containsTargetProduct = lineItems.some((item) => String(item?.product_id ?? '') === targetProductId);

      if (!containsTargetProduct) {
        console.log(`Order ${orderId} ignored: product mismatch`);
        return res.status(202).json({ status: 'ignored', reason: 'product_mismatch' });
      }

      const financialStatus = orderPayload.financial_status?.toLowerCase?.();
      const cancelledAt = orderPayload.cancelled_at ?? orderPayload.cancelledAt ?? null;
      const isSuccessful = financialStatus === 'paid' && (cancelledAt === null || cancelledAt === undefined);

      // if (!isSuccessful) {
      //   console.log(`Order ${orderId} ignored: unsuccessful order (status: ${financialStatus}, cancelled: ${cancelledAt})`);
      //   return res.status(202).json({ status: 'ignored', reason: 'unsuccessful_order' });
      // }

      const recipient = orderPayload.email ?? orderPayload.contact_email ?? orderPayload.contactEmail ?? orderPayload?.customer?.email;

      if (!recipient) {
        console.log(`Order ${orderId}: No recipient email available`);
        return res.status(400).json({ error: 'No recipient email available for order' });
      }

      const createdAt = new Date(orderPayload.created_at ?? orderPayload.createdAt ?? Date.now());
      // if (Number.isNaN(createdAt.getTime())) {
      //   console.log(`Order ${orderId}: Invalid created_at timestamp`);
      //   return res.status(400).json({ error: 'Invalid created_at timestamp' });
      // }

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

        var orderNumber = orderPayload.order_number ?? null;
        if (orderNumber !== null) {
          const numericOrderNumber = String(orderNumber).replace(/[^0-9]/g, '');
          if (numericOrderNumber && !Number.isNaN(Number(numericOrderNumber))) {
            orderNumber = Number(numericOrderNumber);
          }
        }

        const values = [
          orderId,
          orderNumber,
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

      const subject = 'Blockschmiede Adventskalender – Dein Showroom-Zugang';
      const introText =
        'Mit diesem Zugang erhältst du exklusiven Zugriff auf den Blockschmiede Adventskalender Showroom. Dort findest du besondere Inhalte wie deine individuelle Kalendernummer für die Verlosungen sowie eine hochauflösende Grafik des Adventskalenders – perfekt geeignet für den Druck.';

      await mailTransport.sendMail({
        from: config.mail.from,
        to: recipient,
        subject,
        text: `${subject}\n\n${introText}\n\nDein persönlicher Zugangscode: ${token}\n\nZum Showroom: ${showroomLink}`,
        html: `
    <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.6;">
      <h1 style="color: #b22222;">🎁 ${subject}</h1>
      <p>${introText}</p>

      <p style="margin: 20px 0;">
        <strong>Dein persönlicher Zugangscode:</strong><br/>
        <span style="display: inline-block; background: #f5f5f5; padding: 10px 16px; border-radius: 6px; font-family: monospace; font-size: 16px; color: #333;">
          ${token}
        </span>
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${showroomLink}" target="_blank" rel="noopener"
          style="
            background: linear-gradient(135deg, #b22222, #ff4d4d);
            color: #fff;
            padding: 14px 28px;
            border-radius: 40px;
            text-decoration: none;
            font-weight: bold;
            font-size: 16px;
            box-shadow: 0 4px 10px rgba(178, 34, 34, 0.3);
            transition: background 0.3s ease;
            display: inline-block;
          ">
          🎄 Zum Advents-Showroom
        </a>
      </div>

      <p style="text-align:center; margin-top: 30px; color:#666;">
        Dein <strong>Blockschmiede-Team</strong>
      </p>
    </div>
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

  app.post('/api/login', async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      const connection = await pool.getConnection();

      try {
        const [rows] = await connection.execute(
          'SELECT id, order_id, order_number, email, customer_first_name, customer_last_name FROM shopify_order_emails WHERE token = ? LIMIT 1',
          [token]
        );

        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        const orderData = rows[0];

        // Generate calendar number based on order_id


        return res.status(200).json({
          kalendernummer: orderData.id,
          orderNumber: orderData.order_number,
          email: orderData.email,
          firstName: orderData.customer_first_name,
          lastName: orderData.customer_last_name
        });

      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.all('/api/login', (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
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
