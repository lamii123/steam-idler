const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const config = require('../config');
const crypto = require('../lib/crypto');
const logger = require('../lib/logger');
const { TtlCache } = require('../lib/cache');
const sanitizers = require('./storeSanitizers');
const { validateAppIds: sharedValidateAppIds } = require('../lib/validateAppIds');

const SESSIONS_FILE = path.join(config.dataDir, 'sessions.json');
const MACHINE_TOKENS_FILE = path.join(config.dataDir, 'machineTokens.json');
const WRITE_DEBOUNCE_MS = 100;
const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

let sessions = Object.create(null);
let machineTokens = Object.create(null);

let sessionsDirty = false;
let machineTokensDirty = false;
let writeTimer = null;
let writeChain = Promise.resolve();

// Profiles are large and private; keep them in memory instead of writing the
// full game library into sessions.json on every request.
const profileCache = new TtlCache({
  ttlMs: PROFILE_CACHE_TTL_MS,
  maxEntries: 250,
});

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}

function loadJson(file) {
  if (!fs.existsSync(file)) return Object.create(null);

  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return Object.create(null);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is unreadable or corrupt: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object`);
  }

  return sanitizers.sanitizeObject(parsed);
}

async function atomicWrite(file, payload) {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await fsp.writeFile(tmp, payload, { mode: 0o600 });
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function schedulePersist({ sessionData = false, tokenData = false } = {}) {
  if (sessionData) sessionsDirty = true;
  if (tokenData) machineTokensDirty = true;

  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush().catch(() => {});
  }, WRITE_DEBOUNCE_MS);

  if (typeof writeTimer.unref === 'function') writeTimer.unref();
}

/**
 * Flushes pending writes. Writes are coalesced and serialized so a burst of
 * requests produces at most one atomic file replacement per data file.
 */
function flush() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }

  if (!sessionsDirty && !machineTokensDirty) return writeChain;

  const sessionPayload = sessionsDirty ? JSON.stringify(sessions, null, 2) : null;
  const tokenPayload = machineTokensDirty ? JSON.stringify(machineTokens, null, 2) : null;

  sessionsDirty = false;
  machineTokensDirty = false;

  const write = writeChain.then(async () => {
    if (sessionPayload !== null) await atomicWrite(SESSIONS_FILE, sessionPayload);
    if (tokenPayload !== null) await atomicWrite(MACHINE_TOKENS_FILE, tokenPayload);
  });

  writeChain = write.catch((err) => {
    logger.error('failed to persist store', err);
    if (sessionPayload !== null) sessionsDirty = true;
    if (tokenPayload !== null) machineTokensDirty = true;
  });

  return writeChain;
}

// A session and its cached profile are forgotten together; keeping the pair in
// one place stops the cache from outliving the record it describes.
function dropSession(sessionId) {
  delete sessions[sessionId];
  profileCache.delete(sessionId);
}

function pruneExpired() {
  const now = Date.now();
  let changed = false;

  for (const [id, record] of Object.entries(sessions)) {
    if (!record || typeof record !== 'object' || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      dropSession(id);
      changed = true;
    }
  }

  if (changed) schedulePersist({ sessionData: true });
  return changed;
}

function pruneDuplicateSteamIds() {
  const bySteamId = new Map();
  let changed = false;

  for (const [id, record] of Object.entries(sessions)) {
    if (!record || typeof record !== 'object' || !record.steamId) {
      dropSession(id);
      changed = true;
      continue;
    }

    const createdAt = Number(record.createdAt) || 0;
    const existing = bySteamId.get(record.steamId);

    if (!existing || createdAt > existing.createdAt) {
      if (existing) {
        dropSession(existing.id);
        changed = true;
      }
      bySteamId.set(record.steamId, { id, createdAt });
    } else if (existing.id !== id) {
      dropSession(id);
      changed = true;
    }
  }

  if (changed) schedulePersist({ sessionData: true });
  return changed;
}

function enforceSessionLimit() {
  const ids = Object.keys(sessions);
  if (ids.length <= config.maxStoredSessions) return false;

  ids.sort((a, b) => (Number(sessions[a].createdAt) || 0) - (Number(sessions[b].createdAt) || 0));
  const removeCount = ids.length - config.maxStoredSessions;

  for (const id of ids.slice(0, removeCount)) {
    dropSession(id);
  }

  return true;
}

function init() {
  ensureDataDir();

  sessions = sanitizers.sanitizeObject(loadJson(SESSIONS_FILE));
  machineTokens = Object.create(null);

  for (const [accountName, token] of Object.entries(loadJson(MACHINE_TOKENS_FILE))) {
    if (typeof token === 'string' && token) {
      machineTokens[sanitizers.normalizeAccountName(accountName)] = token;
    }
  }

  profileCache.clear();
  pruneExpired();
  pruneDuplicateSteamIds();

  if (enforceSessionLimit()) schedulePersist({ sessionData: true });
}

function create(steamId, encryptedRefreshToken, sessionId, accountName, type) {
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('sessionId must be a non-empty string');
  }
  if (typeof steamId !== 'string' || !steamId) {
    throw new Error('steamId must be a non-empty string');
  }
  if (typeof encryptedRefreshToken !== 'string' || !encryptedRefreshToken) {
    throw new Error('encryptedRefreshToken must be a non-empty string');
  }

  const now = Date.now();
  sessions[sessionId] = {
    steamId,
    encryptedRefreshToken,
    accountName: sanitizers.sanitizeAccountName(accountName) || undefined,
    type: type === 'qr' ? 'qr' : 'password',
    createdAt: now,
    expiresAt: now + config.sessionLifetimeMs,
  };

  profileCache.delete(sessionId);
  enforceSessionLimit();
  schedulePersist({ sessionData: true });
  return sessions[sessionId];
}

function get(sessionId) {
  const record = sessions[sessionId];
  if (!record) return null;

  if (!Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    dropSession(sessionId);
    schedulePersist({ sessionData: true });
    return null;
  }

  return record;
}

function setLastIdle(sessionId, appIds, stopAt) {
  const record = sessions[sessionId];
  if (!record) return;

  record.lastAppIds = sanitizers.sanitizeAppIds(appIds);
  record.stopAt = Number.isFinite(Number(stopAt)) && Number(stopAt) > 0 ? Number(stopAt) : null;
  schedulePersist({ sessionData: true });
}

function setIdlePrefs(sessionId, prefs) {
  const record = sessions[sessionId];
  if (!record) return;

  record.idlePrefs = { ...getIdlePrefs(sessionId), ...sanitizers.selectPrefs(prefs) };
  schedulePersist({ sessionData: true });
}

function getIdlePrefs(sessionId) {
  const record = sessions[sessionId];
  if (!record) return null;
  return { ...sanitizers.DEFAULT_IDLE_PREFS, ...sanitizers.selectPrefs(record.idlePrefs) };
}

function destroy(sessionId) {
  if (!sessions[sessionId]) return;
  dropSession(sessionId);
  schedulePersist({ sessionData: true });
}

function destroyBySteamId(steamId) {
  let changed = false;

  for (const [id, record] of Object.entries(sessions)) {
    if (record.steamId === steamId) {
      dropSession(id);
      changed = true;
    }
  }

  if (changed) schedulePersist({ sessionData: true });
}

function listActive() {
  pruneExpired();
  pruneDuplicateSteamIds();
  return Object.entries(sessions).map(([sessionId, record]) => ({ sessionId, ...record }));
}

function setMachineToken(accountName, token) {
  const key = sanitizers.normalizeAccountName(accountName);
  if (!key || typeof token !== 'string' || !token) return;

  machineTokens[key] = crypto.encrypt(token);
  schedulePersist({ tokenData: true });
}

function getMachineToken(accountName) {
  const key = sanitizers.normalizeAccountName(accountName);
  const blob = machineTokens[key];

  if (!blob) return null;

  try {
    return crypto.decrypt(blob);
  } catch {
    // Legacy plaintext or a token encrypted with an old key: treat as stale so
    // the next login stores a fresh encrypted machine token.
    return null;
  }
}

function setCachedProfile(sessionId, data) {
  if (!sessions[sessionId]) return;
  profileCache.set(sessionId, { ...data, cachedAt: Date.now() });
}

function getCachedProfile(sessionId) {
  return profileCache.get(sessionId) || null;
}

function clearCachedProfile(sessionId) {
  profileCache.delete(sessionId);
}

module.exports = {
  init,
  flush,
  create,
  get,
  destroy,
  destroyBySteamId,
  listActive,
  setLastIdle,
  setMachineToken,
  getMachineToken,
  setIdlePrefs,
  getIdlePrefs,
  DEFAULT_IDLE_PREFS: sanitizers.DEFAULT_IDLE_PREFS,
  setCachedProfile,
  getCachedProfile,
  clearCachedProfile,
};
