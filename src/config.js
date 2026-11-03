const path = require('path');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function readString(name, { required = false, trim = true } = {}) {
  const raw = process.env[name];
  const value = trim && typeof raw === 'string' ? raw.trim() : raw;

  if (!value) {
    if (required) {
      throw new Error(
        `Missing required environment variable "${name}". ` +
          'Copy .env.example to .env and fill it in.'
      );
    }
    return '';
  }

  return value;
}

function readInt(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}").`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;

  throw new Error(`${name} must be a boolean (true/false, 1/0, yes/no, on/off).`);
}

const nodeEnv = (readString('NODE_ENV') || 'development').toLowerCase();
if (!['development', 'production', 'test'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be one of: development, production, test.');
}
const isProduction = nodeEnv === 'production';

const sessionEncryptionKey = readString('SESSION_ENC_KEY', { required: true });
if (!/^[0-9a-f]{64}$/i.test(sessionEncryptionKey)) {
  throw new Error(
    'SESSION_ENC_KEY must be 32 bytes encoded as 64 hex characters. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const cookieSecret = readString('COOKIE_SECRET', { required: true });
if (isProduction && cookieSecret.length < 32) {
  throw new Error('COOKIE_SECRET must be at least 32 characters in production.');
}

const cookieSecure = readBoolean('COOKIE_SECURE', isProduction);
const upgradeInsecureRequests = readBoolean(
  'UPGRADE_INSECURE_REQUESTS',
  isProduction && cookieSecure
);

const logLevel = readString('LOG_LEVEL') || (isProduction ? 'info' : 'debug');
if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) {
  throw new Error('LOG_LEVEL must be one of: error, warn, info, debug.');
}

const config = {
  nodeEnv,
  isProduction,

  host: readString('HOST') || '0.0.0.0',
  port: readInt('PORT', 3000, { min: 1, max: 65535 }),

  // Number of reverse-proxy hops in front of the app. Defaults to 0 so that
  // X-Forwarded-For is ignored unless the deployment explicitly opts in; a
  // wrong value lets clients spoof their IP and bypass rate limits.
  trustProxy: readInt('TRUST_PROXY', 0, { min: 0, max: 10 }),

  sessionEncryptionKey: sessionEncryptionKey.toLowerCase(),
  cookieSecret,
  cookieSecure,
  upgradeInsecureRequests,

  sessionLifetimeMs: SEVEN_DAYS_MS,
  maxAppIdsPerSession: 32,
  maxStoredSessions: 1000,

  qrLoginTtlMs: 3 * 60 * 1000,
  maxPendingLogins: 100,

  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),

  steamApiKey: readString('STEAM_API_KEY') || null,
  steamApiTimeoutMs: readInt('STEAM_API_TIMEOUT_MS', 10_000, { min: 1000, max: 60_000 }),

  // Keep in sync with the duration presets in public/index.html.
  idleDurations: Object.freeze([
    0,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000,
    8 * 60 * 60 * 1000,
  ]),

  logLevel,
};

module.exports = Object.freeze(config);
