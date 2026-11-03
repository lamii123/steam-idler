// Environment validation and deployment-mode regression checks.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');
const BASE_ENV = {
  SESSION_ENC_KEY: 'a'.repeat(64),
  COOKIE_SECRET: 'b'.repeat(32),
  LOG_LEVEL: 'error',
  NODE_ENV: 'development',
  // Some shells export PORT=0; config.js requires a real port, so neutralise it.
  PORT: '3000',
};

function loadConfig(overrides = {}) {
  const result = spawnSync(
    process.execPath,
    ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(CONFIG_PATH)})))`],
    {
      env: { ...process.env, ...BASE_ENV, ...overrides },
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    return { error: result.stderr };
  }

  return { config: JSON.parse(result.stdout) };
}

test('config: NODE_ENV is normalised and unknown values are rejected', () => {
  const production = loadConfig({ NODE_ENV: 'Production' });
  assert.equal(production.config.nodeEnv, 'production');
  assert.equal(production.config.isProduction, true);

  const invalid = loadConfig({ NODE_ENV: 'staging' });
  assert.match(invalid.error, /NODE_ENV must be one of/);
});

test('config: secure cookies and CSP upgrades default on in production', () => {
  const { config } = loadConfig({ NODE_ENV: 'production' });

  assert.equal(config.cookieSecure, true);
  assert.equal(config.upgradeInsecureRequests, true);
});

test('config: plain-HTTP LAN can disable secure cookies and CSP upgrades', () => {
  const { config } = loadConfig({
    NODE_ENV: 'production',
    COOKIE_SECURE: 'false',
  });

  assert.equal(config.cookieSecure, false);
  assert.equal(config.upgradeInsecureRequests, false);
});

test('config: upgrade-insecure-requests can be controlled independently', () => {
  const { config } = loadConfig({
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    UPGRADE_INSECURE_REQUESTS: 'off',
  });

  assert.equal(config.cookieSecure, true);
  assert.equal(config.upgradeInsecureRequests, false);
});

test('config: invalid booleans fail loudly', () => {
  const invalid = loadConfig({ COOKIE_SECURE: 'maybe' });
  assert.match(invalid.error, /COOKIE_SECURE must be a boolean/);
});
