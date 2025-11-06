import { createServer } from 'http';
import { config } from './config.js';
import { createApp } from './app.js';

// Früh ein paar Startinfos loggen
console.log(`[boot] Starting server in ${config.nodeEnv} mode on port ${config.port}...`);

const app = createApp();
const server = createServer(app);

// Startmeldung bei Erfolg
server.listen(config.port, () => {
  console.log(`✅ Server listening on port ${config.port}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.info(`Received ${signal}. Shutting down gracefully.`);
  server.close((err) => {
    if (err) {
      console.error('Error shutting down server', err);
      process.exitCode = 1;
    }
    process.exit();
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 🧩 Ganz wichtig: globale Fehler sichtbar machen
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
