import { createServer } from 'http';
import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();
const server = createServer(app);

server.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

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
