const config = require('./config');
const store = require('./db/store');
const crypto = require('./lib/crypto');
const { createIdleSessions } = require('./steam/idleSessions');
const { createConnectAccount } = require('./auth/connectAccount');
const { createLibrary } = require('./steam/library');
const { createApp } = require('./app');
const logger = require('./lib/logger');

// The composition root: the adapter choice is made once, here, and passed
// down through the app into every route factory.
const idleSessions = createIdleSessions();
const accounts = createConnectAccount({ idleSessions });
const library = createLibrary({ idle: idleSessions });
const app = createApp({ idleSessions, accounts, library });

let server = null;
let shuttingDown = false;

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', reason);
});

function loadIdlingSessions() {
  const sessions = [];

  for (const record of store.listActive()) {
    if (!Array.isArray(record.lastAppIds) || record.lastAppIds.length === 0) continue;

    try {
      const sessionId = record.sessionId;
      sessions.push({
        sessionId,
        steamId: record.steamId,
        refreshToken: crypto.decrypt(record.encryptedRefreshToken),
        lastAppIds: record.lastAppIds,
        idlePrefs: record.idlePrefs,
        stopAt: record.stopAt,
        onDisconnect: () => store.destroy(sessionId),
        onAutoStop: () => store.setLastIdle(sessionId, [], null),
        onExpired: () => store.setLastIdle(sessionId, [], null),
      });
    } catch (err) {
      logger.warn('could not decrypt stored session; skipping resume', {
        steamId: record.steamId,
        message: err.message,
      });
    }
  }

  return sessions;
}

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutting down', { signal });

  idleSessions.shutdownAll();
  await store.flush().catch((err) => {
    logger.error('could not flush store during shutdown', err);
  });

  if (!server) {
    process.exit(exitCode);
  }

  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

async function main() {
  store.init();

  const sessions = loadIdlingSessions();

  server = app.listen(config.port, config.host, () => {
    logger.info('steam-idler listening', {
      host: config.host,
      port: config.port,
      env: config.nodeEnv,
    });

    if (sessions.length > 0) {
      logger.info('resuming stored idle sessions', { count: sessions.length });

      // Do not block the HTTP server on Steam: a slow or unreachable Steam
      // connection must not delay the health check.
      idleSessions.resumeAll(sessions).catch((err) => {
        logger.warn('could not resume idle sessions', err.message);
      });
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;

  server.on('error', (err) => {
    logger.error('server error', err);
    process.exitCode = 1;
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', err);
    shutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  logger.error('failed to start', err);
  process.exit(1);
});
