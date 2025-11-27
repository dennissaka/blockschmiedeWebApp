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

const showroomBaseUrl = 'https://blockschmiede.com/showroom.html';

const determinePreferredRecipient = (email, contactEmail, customerEmail) =>
  email ?? contactEmail ?? customerEmail ?? null;

const createShowroomEmailContent = (tokens) => {
  const subject = 'Blockschmiede Adventskalender – Dein Showroom-Zugang';
  const introText =
    'Mit diesem Zugang erhältst du exklusiven Zugriff auf den Blockschmiede Adventskalender Showroom. Dort findest du besondere Inhalte wie deine individuelle Kalendernummer für die Verlosungen sowie eine hochauflösende Grafik des Adventskalenders – perfekt geeignet für den Druck.';

  const tokensWithLinks = tokens.map((token) => ({
    token,
    link: `${showroomBaseUrl}?token=${encodeURIComponent(token)}`,
  }));

  const tokenLabel =
    tokens.length > 1 ? 'Deine persönlichen Zugangscodes' : 'Dein persönlicher Zugangscode';

  const tokensListText = tokensWithLinks
    .map(
      ({ token, link }, index) =>
        `${index + 1}. Token: ${token}\n   Link: ${link}`,
    )
    .join('\n\n');

  const tokensListHtml = tokensWithLinks
    .map(
      ({ token, link }, index) => `
        <li style="margin-bottom: 12px;">
          <strong>Token ${index + 1}:</strong><br/>
          <span
            style="display: inline-block; background: #f5f5f5; padding: 10px 16px; border-radius: 6px; font-family: monospace; font-size: 16px; color: #333; margin: 8px 0;"
          >
            ${token}
          </span>
          <div>
            <a
              href="${link}"
              target="_blank"
              rel="noopener"
              style="color: #b22222; font-weight: bold; text-decoration: none;"
            >
              👉 Direkt zum Showroom
            </a>
          </div>
        </li>
      `,
    )
    .join('');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.6;">
      <h1 style="color: #b22222;">🎁 ${subject}</h1>
      <p>${introText}</p>

      <p><strong>${tokenLabel}:</strong></p>
      <ol style="padding-left: 18px;">${tokensListHtml}</ol>

      <p style="margin-top: 20px;">
        Viel Freude beim Entdecken und viel Glück bei den Verlosungen!
      </p>

      <p style="text-align:center; margin-top: 30px; color:#666;">
        Dein <strong>Blockschmiede-Team</strong>
      </p>
    </div>
  `;

  const text = `${subject}\n\n${introText}\n\n${tokenLabel}:\n${tokensListText}\n\nViel Freude beim Entdecken und viel Glück bei den Verlosungen!\n\nDein Blockschmiede-Team`;

  return { subject, introText, html, text, tokensWithLinks };
};

const createSupporterEmailContent = () => {
  const subject = 'Einladung zum Blockschmiede YouTube-Livestream';

  const text = `An alle Supporter !

wir sind überglücklich wie sich die Weihnachtsaktion mit dem 1. Bitcoin Charity-Adventskalender entwickelt hat.
Wir stehen aktuell bei knapp 150 verkauften Kalendern.
Das ist irre und wäre ohne Dich überhaupt nicht möglich gewesen, dieser Support sucht seinesgleichen.
Der Kalender ist noch bis einschließlich 30.11.2025 über unseren Shop erhältlich, falls Du also noch einen passenden Adventskalender für deine Liebsten suchst ….. zuschlagen !
Jetzt geht es in die finale Phase, wir werden am kommenden Samstag, 29.11.2025 einen Live-Stream zum Kalender auf Youtube starten und dabei alles erklären.
Hintergrundinformationen zur Aktion, Vorstellung Ablaufplan, Klärung offener Fragen aus der Community.

Sehr gerne möchten wir Dich dazu recht herzlich einladen.
 
Samstag, 29.11.2025 ab 14 Uhr
 
Du findest uns auf Youtube unter: Blockschmiede21 oder du folgst einfach folgendem Link:

https://m.youtube.com/@blockschmiede21

Folge dem Kanal und aktiviere Benachrichtigungen, damit du diesen Stream und künftige Informationen nicht verpasst.


Vielen lieben Dank für diesen unvergleichlichen Support
 
Euer Blockschmiede-Team mit allen Sponsoren`;

  const paragraphs = text
    .split('\n\n')
    .map(
      (paragraph) =>
        `<p style="margin: 12px 0; line-height: 1.5;">${paragraph
          .replace(/\n/g, '<br/>')
          .replace('\n ', '<br/>')}</p>`,
    )
    .join('');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #222;">
      <h2 style="color: #b22222;">${subject}</h2>
      ${paragraphs}
    </div>
  `;

  return { subject, text, html };
};

const sendShowroomEmail = async ({ recipient, tokens }) => {
  if (!recipient || !Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Cannot send showroom email without recipient or tokens');
  }

  const { subject, text, html } = createShowroomEmailContent(tokens);

  await mailTransport.sendMail({
    from: config.mail.from,
    to: recipient,
    subject,
    text,
    html,
  });
};

const sendSupporterMail = async (recipient) => {
  if (!recipient) {
    throw new Error('Cannot send supporter mail without recipient');
  }

  const { subject, text, html } = createSupporterEmailContent();

  await mailTransport.sendMail({
    from: config.mail.from,
    to: recipient,
    subject,
    text,
    html,
  });
};

const targetProductId = config.shopify.targetProductId;

const collectUniqueEmails = async (connection) => {
  const [entries] = await connection.execute(
    'SELECT email, contact_email, customer_email FROM shopify_order_emails',
  );

  const uniqueEmails = new Map();

  entries.forEach((entry) => {
    ['email', 'contact_email', 'customer_email'].forEach((key) => {
      const rawEmail = entry?.[key];
      if (typeof rawEmail !== 'string') return;

      const trimmed = rawEmail.trim();
      if (!trimmed) return;

      const normalized = trimmed.toLowerCase();
      if (!uniqueEmails.has(normalized)) {
        uniqueEmails.set(normalized, trimmed);
      }
    });
  });

  return Array.from(uniqueEmails.values());
};

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
      const matchingLineItems = lineItems.filter(
        (item) => String(item?.product_id ?? '') === targetProductId,
      );

      const totalTargetQuantity = matchingLineItems.reduce((sum, item) => {
        const rawQuantity = item?.quantity ?? 1;
        const parsedQuantity = Number.parseInt(rawQuantity, 10);
        if (Number.isInteger(parsedQuantity) && parsedQuantity > 0) {
          return sum + parsedQuantity;
        }
        return sum + 1;
      }, 0);

      if (totalTargetQuantity <= 0) {
        console.log(`Order ${orderId} ignored: product mismatch`);
        return res.status(202).json({ status: 'ignored', reason: 'product_mismatch' });
      }

      const financialStatus = orderPayload.financial_status?.toLowerCase?.();
      const cancelledAt = orderPayload.cancelled_at ?? orderPayload.cancelledAt ?? null;
      const isSuccessful = financialStatus === 'paid' && (cancelledAt === null || cancelledAt === undefined);

      if (!isSuccessful) {
         console.log(`Order ${orderId} ignored: unsuccessful order (status: ${financialStatus}, cancelled: ${cancelledAt})`);
         return res.status(202).json({ status: 'ignored', reason: 'unsuccessful_order' });
      }

      const recipient = determinePreferredRecipient(
        orderPayload.email,
        orderPayload.contact_email ?? orderPayload.contactEmail,
        orderPayload?.customer?.email,
      );

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
      const createdTokens = [];
      let tokensForOrder = [];

      try {
        const [existingOrders] = await connection.execute(
          'SELECT token FROM shopify_order_emails WHERE order_id = ? ORDER BY id ASC',
          [orderId],
        );

        tokensForOrder = Array.isArray(existingOrders)
          ? existingOrders.map((row) => row.token).filter((token) => typeof token === 'string')
          : [];

        const insertsNeeded = Math.max(totalTargetQuantity - tokensForOrder.length, 0);

        if (insertsNeeded === 0) {
          return res.status(200).json({
            status: 'already_processed',
            tokens: tokensForOrder,
          });
        }

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

        let orderNumber = orderPayload.order_number ?? null;
        if (orderNumber !== null) {
          const numericOrderNumber = String(orderNumber).replace(/[^0-9]/g, '');
          if (numericOrderNumber && !Number.isNaN(Number(numericOrderNumber))) {
            orderNumber = Number(numericOrderNumber);
          }
        }

        for (let i = 0; i < insertsNeeded; i += 1) {
          const token = crypto.randomBytes(48).toString('hex');
          tokensForOrder.push(token);
          createdTokens.push(token);

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
        }
      } finally {
        connection.release();
      }

      await sendShowroomEmail({ recipient, tokens: tokensForOrder });

      return res.status(201).json({
        status: 'stored',
        createdTokens,
        totalTokens: tokensForOrder.length,
      });
    } catch (error) {
      console.error('Failed to process order payload', error);
      return next(error);
    }
  });

  app.all('/api/orders', (_req, res) => {
    res.set('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  });

  app.post('/api/showroom-mails/:email/send', async (req, res) => {
    const { email } = req.params;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Invalid email parameter' });
    }

    const decodedEmail = decodeURIComponent(email);

    const connection = await pool.getConnection();

    try {
      const [entries] = await connection.execute(
        `SELECT id, order_id, email, contact_email, customer_email, token
         FROM shopify_order_emails
         WHERE email = ? OR contact_email = ? OR customer_email = ?
         ORDER BY id ASC`,
        [decodedEmail, decodedEmail, decodedEmail],
      );

      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(404).json({ error: 'No entries found for this email' });
      }

      const recipient = determinePreferredRecipient(
        entries[0].email,
        entries[0].contact_email,
        entries[0].customer_email,
      );

      if (!recipient) {
        return res.status(409).json({ error: 'No recipient email stored for these entries' });
      }

      const tokens = entries
        .map((entry) => entry.token)
        .filter((token) => typeof token === 'string');

      if (tokens.length === 0) {
        return res.status(409).json({ error: 'No tokens available for this email' });
      }

      await sendShowroomEmail({ recipient, tokens });

      return res.status(200).json({
        status: 'sent',
        tokensCount: tokens.length,
      });
    } catch (error) {
      console.error('Manual showroom mail error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      connection.release();
    }
  });

  app.post('/api/supporter-mails/send', async (_req, res) => {
    const connection = await pool.getConnection();

    try {
      const recipients = await collectUniqueEmails(connection);

      if (recipients.length === 0) {
        return res.status(404).json({ error: 'No email addresses available' });
      }

      let sentCount = 0;

      for (const recipient of recipients) {
        await sendSupporterMail(recipient);
        sentCount += 1;
      }

      return res.status(200).json({
        status: 'sent',
        recipients: sentCount,
      });
    } catch (error) {
      console.error('Supporter mail broadcast error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      connection.release();
    }
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
