import { config } from './config/index.js';
import { buildServer } from './app.js';
import { bootstrapAdmin } from './utils/bootstrapAdmin.js';

async function start() {
  try {
    const server = await buildServer();

    await server.listen({ port: config.port, host: config.host });
    server.log.info(`🚀 VOVPLAN backend running at http://${config.host}:${config.port}`);
    server.log.info(`   Environment: ${config.nodeEnv}`);

    await bootstrapAdmin(server.log);

    /*
     * Ненастроенная почта в продакшне — не повод не запускаться: уже
     * работающие проекты от неё не зависят. Но и молчать нельзя: подтверждение
     * адреса и восстановление пароля будут молча складывать письма в лог, и
     * узнается об этом от рассерженного пользователя.
     */
    if (!config.smtp.host && config.nodeEnv === 'production') {
      server.log.warn(
        'SMTP не настроен: письма подтверждения и восстановления пароля НЕ отправляются, ' +
          'а пишутся в этот лог. Задайте SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.',
      );
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
