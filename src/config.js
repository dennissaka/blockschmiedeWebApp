import 'dotenv/config';

const requireEnv = (key) => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalEnv = (key, defaultValue) => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value;
};

const parseInteger = (value, key) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${key} must be an integer`);
  }
  return parsed;
};

const parseBoolean = (value) => {
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const portValue = requireEnv('PORT');
const parsedPort = parseInteger(portValue, 'PORT');

if (parsedPort <= 0) {
  throw new Error('PORT must be a positive integer');
}

const dbPort = optionalEnv('DB_PORT', '3306');
const smtpPort = optionalEnv('SMTP_PORT', '587');

export const config = Object.freeze({
  port: parsedPort,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    host: requireEnv('DB_HOST'),
    port: parseInteger(dbPort, 'DB_PORT'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    name: requireEnv('DB_NAME'),
  },
  mail: {
    host: requireEnv('SMTP_HOST'),
    port: parseInteger(smtpPort, 'SMTP_PORT'),
    secure: parseBoolean(optionalEnv('SMTP_SECURE', 'false')),
    auth: {
      user: requireEnv('SMTP_USER'),
      pass: requireEnv('SMTP_PASSWORD'),
    },
    from: requireEnv('MAIL_FROM'),
  },
  shopify: {
    targetProductId: optionalEnv('SHOPIFY_TARGET_PRODUCT_ID', '10351253356877'),
  },
});
