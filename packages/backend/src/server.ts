import { config } from './config/index.js';
import { buildServer } from './app.js';

async function start() {
  try {
    const server = await buildServer();

    await server.listen({ port: config.port, host: config.host });
    server.log.info(`🚀 VOVPLAN backend running at http://${config.host}:${config.port}`);
    server.log.info(`   Environment: ${config.nodeEnv}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
