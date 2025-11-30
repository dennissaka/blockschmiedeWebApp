import { createServer } from 'http';
import { config } from './config.js';
import { createApp, sendSupporterBroadcast } from './app.js';
import { testDbConnection, testMailConnection } from './app.js';

// Frühe Startinfos
console.log(`[boot] Starting server in ${config.nodeEnv} mode on port ${config.port}...`);
console.log('[boot] DB config (safe):', {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  database: config.database.name,
});

(async () => {
  try {
    await testDbConnection();
    await testMailConnection();

    const app = createApp();
    const server = createServer(app);

    server.listen(config.port, () => {
      console.log(`✅ Server listening on port ${config.port} - no send support!!`);
    });

    // try {
    //   const { sent } = await sendSupporterBroadcast();
    //   console.log(`[boot] Supporter mail broadcast sent to ${sent} recipients`);
    // } catch (err) {
    //   console.error('[boot] Supporter mail broadcast failed:', err);
    // }

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

    // Globale Fehler sichtbar machen
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled Rejection:', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      process.exit(1);
    });
  } catch (err) {
    // Falls DB-Check scheitert, nicht lauschen – sauber beenden
    console.error('❌ Boot aborted due to DB error.');
    process.exit(1);
  }
})();
