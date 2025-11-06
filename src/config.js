import 'dotenv/config';

const portValue = process.env.PORT;

if (portValue === undefined) {
  throw new Error('Missing required environment variable: PORT');
}

const parsedPort = Number.parseInt(portValue, 10);

if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  throw new Error('PORT must be a positive integer');
}

export const config = Object.freeze({
  port: parsedPort,
  nodeEnv: process.env.NODE_ENV ?? 'development',
});
